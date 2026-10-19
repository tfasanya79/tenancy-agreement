/**
 * Loads the template pack from disk.
 *
 * Templates are plain Markdown files in `templates/`. A letting agent can copy
 * one, edit the wording in Word or any text editor, and the app picks it up on
 * the next start — no code changes and no rebuild.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { FIELDS, hasValue, labelFor } from './fields.ts';
import { expand, parseFrontMatter, placeholdersIn, splitFrontMatter } from './template.ts';
import { parseMarkdown, type Block } from './markdown.ts';
import { runComplianceChecks, type ComplianceReport } from './compliance.ts';

export type TemplateDoc = {
  id: string;
  title: string;
  category: string;
  jurisdiction: string;
  version: string;
  updated: string;
  description: string;
  required: string[];
  /** Every placeholder path the body references. */
  placeholders: string[];
  /** Placeholders that are not in the field catalogue — usually a typo. */
  unknownPlaceholders: string[];
  sourcePath: string;
  body: string;
};

export type TemplateSummary = Omit<TemplateDoc, 'body'> & {
  /** Which of this document's required fields are still empty. */
  missing: string[];
};

const KNOWN_BUILTINS = new Set(['today']);

export class TemplateRegistry {
  readonly #docs: Map<string, TemplateDoc>;
  readonly #dir: string;
  readonly #warnings: string[];

  private constructor(dir: string, docs: Map<string, TemplateDoc>, warnings: string[]) {
    this.#dir = dir;
    this.#docs = docs;
    this.#warnings = warnings;
  }

  static async load(dir: string): Promise<TemplateRegistry> {
    const docs = new Map<string, TemplateDoc>();
    const warnings: string[] = [];

    let entries: string[];
    try {
      entries = (await readdir(dir)).filter((name) => name.endsWith('.md'));
    } catch {
      throw new Error(
        `No templates found. Expected a "templates" folder at ${dir}. If you moved the project, run it from the project root.`,
      );
    }

    const known = new Set(FIELDS.map((field) => field.key));

    for (const entry of entries.sort()) {
      const sourcePath = join(dir, entry);
      const raw = await readFile(sourcePath, 'utf8');
      const { meta, body } = splitFrontMatter(raw);
      const front = parseFrontMatter(meta);

      const id = typeof front['id'] === 'string' ? front['id'] : '';
      if (id === '') {
        warnings.push(`${entry}: no "id" in front matter — skipped.`);
        continue;
      }
      if (docs.has(id)) {
        warnings.push(`${entry}: duplicate id "${id}" — skipped.`);
        continue;
      }

      const placeholders = placeholdersIn(body);
      const unknownPlaceholders = placeholders.filter(
        (key) => !known.has(key) && !KNOWN_BUILTINS.has(key),
      );
      if (unknownPlaceholders.length > 0) {
        warnings.push(`${entry}: unknown placeholders ${unknownPlaceholders.join(', ')}`);
      }

      const required = Array.isArray(front['required'])
        ? (front['required'] as string[])
        : typeof front['required'] === 'string' && front['required'] !== ''
          ? [front['required'] as string]
          : [];
      for (const key of required) {
        if (!placeholders.includes(key)) {
          warnings.push(`${entry}: required field "${key}" is not used in the body.`);
        }
      }

      docs.set(id, {
        id,
        title: typeof front['title'] === 'string' ? front['title'] : id,
        category: typeof front['category'] === 'string' ? front['category'] : 'other',
        jurisdiction: typeof front['jurisdiction'] === 'string' ? front['jurisdiction'] : 'england-wales',
        version: typeof front['version'] === 'string' ? front['version'] : '1.0',
        updated: typeof front['updated'] === 'string' ? front['updated'] : '',
        description: typeof front['description'] === 'string' ? front['description'] : '',
        required,
        placeholders,
        unknownPlaceholders,
        sourcePath: relative(dir, sourcePath).replace(/\\/g, '/'),
        body,
      });
    }

    if (docs.size === 0) {
      throw new Error(`No usable templates in ${dir}. Each file needs a front-matter block with an "id".`);
    }

    return new TemplateRegistry(dir, docs, warnings);
  }

  get directory(): string {
    return this.#dir;
  }

  get warnings(): readonly string[] {
    return this.#warnings;
  }

  get size(): number {
    return this.#docs.size;
  }

  list(fields: Record<string, unknown> = {}): TemplateSummary[] {
    return [...this.#docs.values()].map((doc) => {
      const { body: _body, ...rest } = doc;
      return {
        ...rest,
        missing: doc.required.filter((key) => {
          if (key === 'tenants') {
            const tenants = fields['tenants'];
            return !Array.isArray(tenants) || !tenants.some((person) => hasValue((person as Record<string, unknown>)['full_name']));
          }
          return !hasValue(fields[key]);
        }),
      };
    });
  }

  get(id: string): TemplateDoc {
    const doc = this.#docs.get(id);
    if (doc === undefined) {
      const available = [...this.#docs.keys()].join(', ');
      throw new Error(`Unknown document "${id}". Available: ${available}`);
    }
    return doc;
  }

  has(id: string): boolean {
    return this.#docs.has(id);
  }

  /**
   * The documents a letting agent normally needs for a new tenant on move-in
   * day, in the order they should be given out.
   */
  suggestSelection(fields: Record<string, unknown>): string[] {
    const order = ['tenancy', 'deposit', 'inventory', 'compliance', 'welcome', 'guarantee'];
    const hasGuarantor = hasValue(fields['guarantor.full_name']);

    return [...this.#docs.values()]
      .filter((doc) => {
        if (doc.category === 'guarantee' && !hasGuarantor) return false;
        return order.includes(doc.category);
      })
      .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
      .map((doc) => doc.id);
  }
}

export type RenderedDoc = {
  id: string;
  title: string;
  markdown: string;
  blocks: Block[];
  missing: string[];
};

export type RenderContext = {
  fields: Record<string, unknown>;
  /** Used for `{{today}}` and as the default issue date. */
  today?: Date;
  /** Agency details applied where the pack has none. */
  fallbackFields?: Record<string, unknown>;
};

function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Expand a template's placeholders and parse the result into blocks. */
export function renderTemplate(doc: TemplateDoc, context: RenderContext): RenderedDoc {
  const today = context.today ?? new Date();
  const missing = new Set<string>();

  const values: Record<string, unknown> = {
    ...context.fallbackFields,
    ...context.fields,
    today: toIso(today),
  };

  if (!hasValue(values['doc.issue_date'])) values['doc.issue_date'] = toIso(today);

  const markdown = expand(doc.body, values, {
    onMissing: (key) => {
      // Only report fields this document actually needs.
      if (doc.required.includes(key)) missing.add(key);
    },
  });

  return {
    id: doc.id,
    title: doc.title,
    markdown,
    blocks: parseMarkdown(markdown),
    missing: [...missing],
  };
}

export type PackReadiness = {
  ready: boolean;
  missingCore: string[];
  missingLabels: string[];
  compliance: ComplianceReport;
};

/** Is this pack complete enough to generate documents? */
export function assessPack(fields: Record<string, unknown>, today?: Date): PackReadiness {
  const compliance = runComplianceChecks(fields, today === undefined ? {} : { today });
  const missingCore = compliance.findings
    .filter((finding) => finding.id.startsWith('missing-'))
    .flatMap((finding) => finding.fields ?? []);

  return {
    ready: missingCore.length === 0,
    missingCore,
    missingLabels: missingCore.map(labelFor),
    compliance,
  };
}
