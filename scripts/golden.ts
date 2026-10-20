/**
 * `pnpm golden` — record the rendered text of every shipped template.
 *
 * A wording change in a template quietly changes every future agreement. These
 * hashes make that visible: `tests/golden.test.ts` fails when a template's output
 * differs from what was recorded, so a change is a deliberate act rather than a
 * surprise.
 *
 * The hash is over the *rendered text*, not the `.docx`, so a change to styling or
 * to Word metadata does not trip it — only a change to the words does.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { TemplateRegistry, renderTemplate } from '../src/docs/registry.ts';
import { blocksToPlainText } from '../src/docs/markdown.ts';
import { completeFields } from '../tests/helpers.ts';

export const GOLDEN_PATH = join('tests', 'golden', 'templates.json');

export type GoldenEntry = { words: number; sha: string };
export type GoldenFile = { note: string; generatedWith: string; templates: Record<string, GoldenEntry> };

/** Hash one template's rendered text. */
export function fingerprint(doc: Parameters<typeof renderTemplate>[0], fields: Record<string, unknown>): GoldenEntry {
  const rendered = renderTemplate(doc, { fields, today: new Date(2026, 9, 19) });
  const text = blocksToPlainText(rendered.blocks);
  return {
    words: text.split(/\s+/).filter(Boolean).length,
    sha: createHash('sha256').update(text).digest('hex').slice(0, 16),
  };
}

export async function buildGolden(templatesDir = './templates'): Promise<GoldenFile> {
  const registry = await TemplateRegistry.load(templatesDir);
  const fields = completeFields();
  const templates: Record<string, GoldenEntry> = {};

  for (const summary of registry.list()) {
    templates[summary.id] = fingerprint(registry.get(summary.id), fields);
  }

  return {
    note: 'Rendered-text fingerprints of the shipped templates. Regenerate with `pnpm golden` after reviewing a wording change.',
    generatedWith: 'pnpm golden',
    templates,
  };
}

const { fileURLToPath } = await import('node:url');
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const golden = await buildGolden();
  await mkdir(join('tests', 'golden'), { recursive: true });
  await writeFile(GOLDEN_PATH, `${JSON.stringify(golden, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${GOLDEN_PATH} — ${Object.keys(golden.templates).length} templates.`);
}
