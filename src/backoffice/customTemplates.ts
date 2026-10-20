/**
 * The agency's own documents.
 *
 * A `.docx` they upload is kept exactly as supplied, together with the links that
 * say which of its text is which detail. Nothing is ever rewritten in place: filling
 * makes a new copy from the original every time.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { AuditReport } from '../docs/templateAudit.ts';
import type { ProposedLink } from '../docs/linkProposal.ts';

export type FillMode = 'values' | 'blanks';

/** One link between text in the document and a detail the app holds. */
export type TemplateLink = {
  sample: string;
  /** Empty until a human decides which detail it is. */
  field: string;
  hint?: string;
  kind?: ProposedLink['kind'];
  confidence?: ProposedLink['confidence'];
};

export type CustomTemplate = {
  id: string;
  /** What the agency calls it. */
  name: string;
  fileName: string;
  fillMode: FillMode;
  /** For blank forms: the field keys, in the order the blanks appear. */
  blankFields: string[];
  /** For filled documents: the text to find and the detail to put there. */
  links: TemplateLink[];
  audit: AuditReport;
  wordCount: number;
  checksum: string;
  byteSize: number;
  createdAt: string;
  updatedAt: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS custom_templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  file_name    TEXT NOT NULL DEFAULT '',
  fill_mode    TEXT NOT NULL DEFAULT 'values',
  blank_fields TEXT NOT NULL DEFAULT '[]',
  links_json   TEXT NOT NULL DEFAULT '[]',
  audit_json   TEXT NOT NULL DEFAULT '{}',
  word_count   INTEGER NOT NULL DEFAULT 0,
  checksum     TEXT NOT NULL DEFAULT '',
  byte_size    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
`;

type Row = Record<string, unknown>;

const str = (row: Row, key: string): string => (typeof row[key] === 'string' ? (row[key] as string) : '');

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const EMPTY_AUDIT: AuditReport = { findings: [], counts: { error: 0, warning: 0, info: 0 }, ok: true, wordCount: 0 };

function mapRow(row: Row): CustomTemplate {
  return {
    id: str(row, 'id'),
    name: str(row, 'name'),
    fileName: str(row, 'file_name'),
    fillMode: str(row, 'fill_mode') === 'blanks' ? 'blanks' : 'values',
    blankFields: parse<string[]>(str(row, 'blank_fields'), []),
    links: parse<TemplateLink[]>(str(row, 'links_json'), []),
    audit: parse<AuditReport>(str(row, 'audit_json'), EMPTY_AUDIT),
    wordCount: typeof row['word_count'] === 'number' ? (row['word_count'] as number) : 0,
    checksum: str(row, 'checksum'),
    byteSize: typeof row['byte_size'] === 'number' ? (row['byte_size'] as number) : 0,
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  };
}

export class CustomTemplateStore {
  readonly db: DatabaseSync;
  readonly uploadDir: string;

  constructor(db: DatabaseSync, dataDir: string) {
    this.db = db;
    this.uploadDir = join(dataDir, 'uploads');
    mkdirSync(this.uploadDir, { recursive: true });
    this.db.exec(SCHEMA);
  }

  list(): CustomTemplate[] {
    const rows = this.db
      .prepare('SELECT * FROM custom_templates ORDER BY created_at DESC')
      .all() as unknown as Row[];
    return rows.map(mapRow);
  }

  get(id: string): CustomTemplate | null {
    const row = this.db.prepare('SELECT * FROM custom_templates WHERE id = ?').get(id) as unknown as Row | undefined;
    return row === undefined ? null : mapRow(row);
  }

  /** Where the untouched original lives. */
  filePath(id: string): string {
    return join(this.uploadDir, `${id}.docx`);
  }

  async originalFile(template: CustomTemplate): Promise<Buffer> {
    return readFile(this.filePath(template.id));
  }

  async create(input: {
    name: string;
    fileName: string;
    bytes: Buffer;
    fillMode: FillMode;
    blankFields: string[];
    links: TemplateLink[];
    audit: AuditReport;
    wordCount: number;
  }): Promise<CustomTemplate> {
    const id = randomUUID();
    const stamp = new Date().toISOString();
    await writeFile(this.filePath(id), input.bytes);

    this.db
      .prepare(
        `INSERT INTO custom_templates
           (id, name, file_name, fill_mode, blank_fields, links_json, audit_json, word_count, checksum, byte_size, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.fileName,
        input.fillMode,
        JSON.stringify(input.blankFields),
        JSON.stringify(input.links),
        JSON.stringify(input.audit),
        input.wordCount,
        createHash('sha256').update(input.bytes).digest('hex').slice(0, 16),
        input.bytes.byteLength,
        stamp,
        stamp,
      );

    return this.get(id) as CustomTemplate;
  }

  update(
    id: string,
    patch: { name?: string; fillMode?: FillMode; blankFields?: string[]; links?: TemplateLink[] },
  ): CustomTemplate {
    const current = this.get(id);
    if (current === null) throw new Error('That document no longer exists.');

    const next = {
      name: patch.name ?? current.name,
      fillMode: patch.fillMode ?? current.fillMode,
      blankFields: patch.blankFields ?? current.blankFields,
      links: patch.links ?? current.links,
    };

    this.db
      .prepare(
        `UPDATE custom_templates SET name = ?, fill_mode = ?, blank_fields = ?, links_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.name,
        next.fillMode,
        JSON.stringify(next.blankFields),
        JSON.stringify(next.links),
        new Date().toISOString(),
        id,
      );

    return this.get(id) as CustomTemplate;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM custom_templates WHERE id = ?').run(id);
  }
}
