/**
 * Turns a pack's details into finished files on disk.
 *
 * For each document we write three things:
 *   .docx  the one you send, sign and archive
 *   .html  the one you open to print or save as a PDF
 *   .md    the expanded source, so a document can be checked word by word
 */

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { renderDocx } from './toDocx.ts';
import { renderHtml } from './toHtml.ts';
import { renderTemplate, type TemplateRegistry } from './registry.ts';
import type { Store, StoredDocument } from '../db.ts';

export type GenerateOptions = {
  store: Store;
  registry: TemplateRegistry;
  packId: string;
  fields: Record<string, unknown>;
  templateIds?: string[];
  /** Agency details used when the pack itself does not carry them. */
  fallbackFields?: Record<string, unknown>;
  today?: Date;
};

export type GeneratedDocument = StoredDocument & { missing: string[] };

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function generateDocuments(options: GenerateOptions): Promise<GeneratedDocument[]> {
  const { store, registry, packId, fields } = options;
  const today = options.today ?? new Date();

  const pack = store.getPack(packId);
  const templateIds = options.templateIds ?? registry.suggestSelection(fields);

  const dir = store.documentDir(packId);
  const outputs: Array<Omit<StoredDocument, 'id' | 'packId'>> = [];
  const missingById = new Map<string, string[]>();

  for (const templateId of templateIds) {
    const template = registry.get(templateId);
    const rendered = renderTemplate(template, {
      fields,
      today,
      fallbackFields: options.fallbackFields,
    });

    const base = slugify(template.id);
    const subtitle = `Reference ${pack.reference} · ${template.title}`;
    const footerText = options.fallbackFields?.['agent.company_name'];
    const meta = {
      title: template.title,
      subtitle,
      footerText: typeof footerText === 'string' ? footerText : undefined,
    };

    const docx = await renderDocx(rendered.blocks, meta);
    const html = renderHtml(rendered.blocks, { ...meta, embedded: false });

    const docxName = `${base}.docx`;
    const htmlName = `${base}.html`;
    const mdName = `${base}.md`;

    await writeFile(join(dir, docxName), docx);
    await writeFile(join(dir, htmlName), html, 'utf8');
    await writeFile(join(dir, mdName), rendered.markdown, 'utf8');

    outputs.push({
      templateId: template.id,
      title: template.title,
      docxPath: join('documents', packId, docxName).replace(/\\/g, '/'),
      htmlPath: join('documents', packId, htmlName).replace(/\\/g, '/'),
      mdPath: join('documents', packId, mdName).replace(/\\/g, '/'),
      checksum: createHash('sha256').update(docx).digest('hex').slice(0, 16),
      byteSize: docx.byteLength,
      generatedAt: new Date().toISOString(),
    });
    missingById.set(template.id, rendered.missing);
  }

  const saved = store.addDocuments(packId, outputs);
  store.updatePack(packId, { status: pack.status === 'sent' ? 'sent' : 'generated' });

  return saved.map((doc) => ({ ...doc, missing: missingById.get(doc.templateId) ?? [] }));
}
