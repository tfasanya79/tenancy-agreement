/**
 * Storage.
 *
 * One SQLite file, using the `node:sqlite` module built into Node — so there is
 * nothing to install, no database server to run, and no native module to
 * compile. Back it up by copying `data/tenancydesk.db`.
 *
 * A "pack" is everything about one tenant's paperwork: the details you entered,
 * the documents generated from them, the compliance notes, and a log of what
 * the AI assistant did.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type PackStatus = 'draft' | 'ready' | 'generated' | 'sent';

export type Note = { id: string; text: string; createdAt: string };

export type CoverMessage = { email?: string; whatsapp?: string; createdAt: string };

export type Pack = {
  id: string;
  reference: string;
  tenantName: string;
  propertyAddress: string;
  status: PackStatus;
  fields: Record<string, unknown>;
  notes: Note[];
  coverMessage: CoverMessage | null;
  createdAt: string;
  updatedAt: string;
};

export type StoredDocument = {
  id: string;
  packId: string;
  templateId: string;
  title: string;
  docxPath: string | null;
  htmlPath: string | null;
  mdPath: string | null;
  checksum: string | null;
  byteSize: number;
  generatedAt: string;
};

export type AgentRun = {
  id: string;
  packId: string;
  kind: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  steps: unknown[];
  summary: string;
  createdAt: string;
};

type PackRow = {
  id: string;
  reference: string;
  tenant_name: string;
  property_address: string;
  status: string;
  fields_json: string;
  notes_json: string;
  cover_message_json: string;
  created_at: string;
  updated_at: string;
};

type DocumentRow = {
  id: string;
  pack_id: string;
  template_id: string;
  title: string;
  docx_path: string | null;
  html_path: string | null;
  md_path: string | null;
  checksum: string | null;
  byte_size: number;
  generated_at: string;
};

type RunRow = {
  id: string;
  pack_id: string;
  kind: string;
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  steps_json: string;
  summary: string;
  created_at: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS packs (
  id                 TEXT PRIMARY KEY,
  reference          TEXT NOT NULL UNIQUE,
  tenant_name        TEXT NOT NULL DEFAULT '',
  property_address   TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'draft',
  fields_json        TEXT NOT NULL DEFAULT '{}',
  notes_json         TEXT NOT NULL DEFAULT '[]',
  cover_message_json TEXT NOT NULL DEFAULT 'null',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  pack_id      TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  template_id  TEXT NOT NULL,
  title        TEXT NOT NULL,
  docx_path    TEXT,
  html_path    TEXT,
  md_path      TEXT,
  checksum     TEXT,
  byte_size    INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_pack ON documents(pack_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id                TEXT PRIMARY KEY,
  pack_id           TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,
  model             TEXT NOT NULL,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  steps_json        TEXT NOT NULL DEFAULT '[]',
  summary           TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_pack ON agent_runs(pack_id);
`;

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapPack(row: PackRow): Pack {
  return {
    id: row.id,
    reference: row.reference,
    tenantName: row.tenant_name,
    propertyAddress: row.property_address,
    status: row.status as PackStatus,
    fields: parseJson<Record<string, unknown>>(row.fields_json, {}),
    notes: parseJson<Note[]>(row.notes_json, []),
    coverMessage: parseJson<CoverMessage | null>(row.cover_message_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDocument(row: DocumentRow): StoredDocument {
  return {
    id: row.id,
    packId: row.pack_id,
    templateId: row.template_id,
    title: row.title,
    docxPath: row.docx_path,
    htmlPath: row.html_path,
    mdPath: row.md_path,
    checksum: row.checksum,
    byteSize: row.byte_size,
    generatedAt: row.generated_at,
  };
}

function mapRun(row: RunRow): AgentRun {
  return {
    id: row.id,
    packId: row.pack_id,
    kind: row.kind,
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    steps: parseJson<unknown[]>(row.steps_json, []),
    summary: row.summary,
    createdAt: row.created_at,
  };
}

export class Store {
  readonly #db: DatabaseSync;
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    const file = join(dataDir, 'tenancydesk.db');
    mkdirSync(dirname(file), { recursive: true });
    this.#db = new DatabaseSync(file);
    this.#db.exec('PRAGMA journal_mode = WAL;');
    this.#db.exec('PRAGMA foreign_keys = ON;');
    this.#db.exec(SCHEMA);
  }

  close(): void {
    this.#db.close();
  }

  /** Where generated files for a pack live, relative to the data directory. */
  documentDir(packId: string): string {
    const dir = join(this.dataDir, 'documents', packId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  #nextReference(): string {
    const year = new Date().getFullYear();
    const row = this.#db
      .prepare('SELECT COUNT(*) AS count FROM packs WHERE reference LIKE ?')
      .get(`TD-${year}-%`) as { count: number } | undefined;
    const next = (row?.count ?? 0) + 1;
    return `TD-${year}-${String(next).padStart(4, '0')}`;
  }

  createPack(fields: Record<string, unknown> = {}): Pack {
    const id = randomUUID();
    const timestamp = nowIso();
    const tenantName = tenantNameFrom(fields);
    const propertyAddress = propertyAddressFrom(fields);

    this.#db
      .prepare(
        `INSERT INTO packs (id, reference, tenant_name, property_address, status, fields_json, notes_json, cover_message_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, '[]', 'null', ?, ?)`,
      )
      .run(id, this.#nextReference(), tenantName, propertyAddress, JSON.stringify(fields), timestamp, timestamp);

    return this.getPack(id);
  }

  listPacks(): Pack[] {
    const rows = this.#db
      .prepare('SELECT * FROM packs ORDER BY updated_at DESC')
      .all() as unknown as PackRow[];
    return rows.map(mapPack);
  }

  getPack(id: string): Pack {
    const row = this.#db.prepare('SELECT * FROM packs WHERE id = ?').get(id) as unknown as PackRow | undefined;
    if (row === undefined) throw new Error(`Pack ${id} not found`);
    return mapPack(row);
  }

  findPack(id: string): Pack | null {
    const row = this.#db.prepare('SELECT * FROM packs WHERE id = ?').get(id) as unknown as PackRow | undefined;
    return row === undefined ? null : mapPack(row);
  }

  updatePack(
    id: string,
    patch: {
      fields?: Record<string, unknown>;
      status?: PackStatus;
      notes?: Note[];
      coverMessage?: CoverMessage | null;
    },
  ): Pack {
    const pack = this.getPack(id);
    const fields = patch.fields ?? pack.fields;
    const notes = patch.notes ?? pack.notes;
    const coverMessage = patch.coverMessage === undefined ? pack.coverMessage : patch.coverMessage;
    const status = patch.status ?? pack.status;

    this.#db
      .prepare(
        `UPDATE packs
            SET fields_json = ?, notes_json = ?, cover_message_json = ?, status = ?,
                tenant_name = ?, property_address = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        JSON.stringify(fields),
        JSON.stringify(notes),
        JSON.stringify(coverMessage),
        status,
        tenantNameFrom(fields),
        propertyAddressFrom(fields),
        nowIso(),
        id,
      );

    return this.getPack(id);
  }

  deletePack(id: string): void {
    this.#db.prepare('DELETE FROM packs WHERE id = ?').run(id);
  }

  addDocuments(packId: string, documents: Array<Omit<StoredDocument, 'id' | 'packId'>>): StoredDocument[] {
    const insert = this.#db.prepare(
      `INSERT INTO documents (id, pack_id, template_id, title, docx_path, html_path, md_path, checksum, byte_size, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    // A regenerated document replaces the previous one for that template.
    const remove = this.#db.prepare('DELETE FROM documents WHERE pack_id = ? AND template_id = ?');

    const created: StoredDocument[] = [];
    for (const doc of documents) {
      remove.run(packId, doc.templateId);
      const id = randomUUID();
      insert.run(
        id,
        packId,
        doc.templateId,
        doc.title,
        doc.docxPath,
        doc.htmlPath,
        doc.mdPath,
        doc.checksum,
        doc.byteSize,
        doc.generatedAt,
      );
      created.push({ ...doc, id, packId });
    }
    return created;
  }

  listDocuments(packId: string): StoredDocument[] {
    const rows = this.#db
      .prepare('SELECT * FROM documents WHERE pack_id = ? ORDER BY generated_at DESC')
      .all(packId) as unknown as DocumentRow[];
    return rows.map(mapDocument);
  }

  getDocument(id: string): StoredDocument | null {
    const row = this.#db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as unknown as
      | DocumentRow
      | undefined;
    return row === undefined ? null : mapDocument(row);
  }

  saveRun(run: Omit<AgentRun, 'id' | 'createdAt'>): AgentRun {
    const id = randomUUID();
    const createdAt = nowIso();
    this.#db
      .prepare(
        `INSERT INTO agent_runs (id, pack_id, kind, model, prompt_tokens, completion_tokens, steps_json, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        run.packId,
        run.kind,
        run.model,
        run.promptTokens,
        run.completionTokens,
        JSON.stringify(run.steps),
        run.summary,
        createdAt,
      );
    return { ...run, id, createdAt };
  }

  listRuns(packId: string, limit = 20): AgentRun[] {
    const rows = this.#db
      .prepare('SELECT * FROM agent_runs WHERE pack_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(packId, limit) as unknown as RunRow[];
    return rows.map(mapRun);
  }

  /** Quick counts for the health endpoint. */
  stats(): { packs: number; documents: number; runs: number } {
    const one = (sql: string) => (this.#db.prepare(sql).get() as { count: number }).count;
    return {
      packs: one('SELECT COUNT(*) AS count FROM packs'),
      documents: one('SELECT COUNT(*) AS count FROM documents'),
      runs: one('SELECT COUNT(*) AS count FROM agent_runs'),
    };
  }
}

export function tenantNameFrom(fields: Record<string, unknown>): string {
  const tenants = fields['tenants'];
  if (!Array.isArray(tenants)) return '';
  return tenants
    .map((person) =>
      typeof person === 'object' && person !== null
        ? String((person as Record<string, unknown>)['full_name'] ?? '').trim()
        : '',
    )
    .filter((name) => name !== '')
    .join(' & ');
}

export function propertyAddressFrom(fields: Record<string, unknown>): string {
  const parts = ['property.address_line1', 'property.address_line2', 'property.city', 'property.postcode']
    .map((key) => fields[key])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim());
  return parts.join(', ');
}
