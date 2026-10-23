/**
 * Feedback: what people asked for, and what happened to it.
 *
 * Two tables, in the same file as everything else. A feedback row is the record the
 * operator works; `feedback_messages` holds the conversation verbatim, because a
 * summary is a digest and the original words are where the detail lives.
 *
 * Two rules live in this file rather than in the interface, because they are promises
 * made to the person who typed:
 *
 *   - feedback is never returned for an organisation, only for its author or the
 *     operator — a landlord's words are not their agency's business;
 *   - anything that looks like someone else's personal data, or like a promise, is
 *     flagged for a human rather than quietly filed.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const FEEDBACK_KINDS = ['improvement', 'new_feature', 'bug', 'confusion', 'praise'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_AREAS = [
  'assistant',
  'details',
  'documents',
  'checks',
  'back_office',
  'sign_in',
  'other',
] as const;
export type FeedbackArea = (typeof FEEDBACK_AREAS)[number];

export const FEEDBACK_STATUSES = ['new', 'triaged', 'planned', 'done', 'declined'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** What a tester sees, in words they would use themselves. */
export const STATUS_WORDS: Record<FeedbackStatus, string> = {
  new: 'Sent',
  triaged: 'Being looked at',
  planned: 'On the list',
  done: 'Done',
  declined: 'Not doing it',
};

export type FeedbackMessage = { id: string; role: 'tester' | 'agent'; text: string; at: string };

export type Feedback = {
  id: string;
  userId: string;
  userName: string;
  role: string;
  kind: FeedbackKind;
  title: string;
  summary: string;
  area: FeedbackArea;
  sentiment: string;
  screen: string;
  packReference: string;
  status: FeedbackStatus;
  clusterId: string | null;
  clusterCount: number;
  /** How many times this same ask has already been dealt with and removed. */
  previousAsks: number;
  needsReview: string[];
  operatorNote: string;
  publicNote: string;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  messages: FeedbackMessage[];
};

type FeedbackRow = {
  id: string;
  user_id: string;
  user_name: string;
  role: string;
  kind: string;
  title: string;
  summary: string;
  area: string;
  sentiment: string;
  screen: string;
  pack_reference: string;
  status: string;
  cluster_id: string | null;
  needs_review: string;
  operator_note: string;
  public_note: string;
  created_at: string;
  updated_at: string;
  done_at: string | null;
};

type MessageRow = { id: string; feedback_id: string; role: string; text: string; at: string };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS feedback (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL DEFAULT '',
  user_name      TEXT NOT NULL DEFAULT '',
  role           TEXT NOT NULL DEFAULT '',
  kind           TEXT NOT NULL DEFAULT 'improvement',
  title          TEXT NOT NULL DEFAULT '',
  summary        TEXT NOT NULL DEFAULT '',
  area           TEXT NOT NULL DEFAULT 'other',
  sentiment      TEXT NOT NULL DEFAULT 'neutral',
  screen         TEXT NOT NULL DEFAULT '',
  pack_reference TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'new',
  cluster_id     TEXT,
  needs_review   TEXT NOT NULL DEFAULT '',
  operator_note  TEXT NOT NULL DEFAULT '',
  public_note    TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  done_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_cluster ON feedback(cluster_id);

CREATE TABLE IF NOT EXISTS feedback_messages (
  id          TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  text        TEXT NOT NULL,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_messages ON feedback_messages(feedback_id);

-- One anonymous line per pattern that has been dealt with. No person, no words, no
-- conversation: deleting a record must not destroy the fact that the same thing keeps
-- being asked for, which is the only evidence for what to build next.
CREATE TABLE IF NOT EXISTS feedback_done (
  id       TEXT PRIMARY KEY,
  kind     TEXT NOT NULL,
  title    TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 1,
  first_at TEXT NOT NULL,
  last_at  TEXT NOT NULL
);
`;

const nowIso = (): string => new Date().toISOString();

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE = /\b(?:0\d{3,4}[\s-]?\d{3}[\s-]?\d{3}|\+44[\s\d-]{9,})\b/;
const POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i;
const PROMISE =
  /\b(?:we(?:'| a)re going to|we will|we'll|i will|i'll|next (?:release|version|week|sprint)|will be (?:fixed|done|added)|by (?:friday|monday|next week|the end))\b/i;

/** Things a human should read properly before the record is worked. */
export function reviewFlags(text: string, fromAgent: boolean): string[] {
  const flags: string[] = [];
  if (EMAIL.test(text)) flags.push('looks like it contains an email address');
  if (PHONE.test(text)) flags.push('looks like it contains a phone number');
  if (POSTCODE.test(text)) flags.push('looks like it contains a postcode');
  if (PROMISE.test(text)) {
    flags.push(fromAgent ? 'the assistant appeared to promise something' : 'the wording promises something');
  }
  return flags;
}

/** The words that make a complaint comparable to another one. */
function tokens(text: string): Set<string> {
  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'for', 'with',
    'it', 'this', 'that', 'i', 'we', 'you', 'my', 'our', 'your', 'be', 'been', 'would', 'should', 'could',
    'can', 'cannot', 'just', 'like', 'when', 'what', 'how', 'not', 'no', 'so', 'if', 'then', 'than', 'as',
    'at', 'by', 'from', 'have', 'has', 'had', 'do', 'does', 'did', 'there', 'their', 'them', 'they', 'me',
  ]);
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stop.has(word)),
  );
}

/** How alike two pieces of feedback are, 0 to 1. Deliberately cheap: no model call. */
export function similarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

export type NewFeedback = {
  userId: string;
  userName: string;
  role: string;
  kind: FeedbackKind;
  title: string;
  summary: string;
  area: FeedbackArea;
  sentiment?: string;
  screen?: string;
  packReference?: string;
  messages: Array<{ role: 'tester' | 'agent'; text: string }>;
};

export class FeedbackStore {
  readonly #db: DatabaseSync;
  /** Above this, two pieces of feedback are treated as the same ask. */
  static readonly SIMILAR = 0.62;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#db.exec(SCHEMA);
  }

  #map(row: FeedbackRow): Feedback {
    const messages = this.#db
      .prepare('SELECT * FROM feedback_messages WHERE feedback_id = ? ORDER BY at ASC')
      .all(row.id) as unknown as MessageRow[];
    const cluster = row.cluster_id ?? row.id;
    const count = (
      this.#db.prepare('SELECT COUNT(*) AS count FROM feedback WHERE COALESCE(cluster_id, id) = ?').get(cluster) as {
        count: number;
      }
    ).count;

    return {
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      role: row.role,
      kind: (row.kind as FeedbackKind | undefined) ?? 'improvement',
      title: row.title,
      summary: row.summary,
      area: (row.area as FeedbackArea | undefined) ?? 'other',
      sentiment: row.sentiment,
      screen: row.screen,
      packReference: row.pack_reference,
      status: (row.status as FeedbackStatus | undefined) ?? 'new',
      clusterId: row.cluster_id,
      clusterCount: count,
      previousAsks: this.#previousAsks(row.kind, `${row.title} ${row.summary}`),
      needsReview: row.needs_review === '' ? [] : row.needs_review.split('|'),
      operatorNote: row.operator_note,
      publicNote: row.public_note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      doneAt: row.done_at,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role === 'agent' ? 'agent' : 'tester',
        text: message.text,
        at: message.at,
      })),
    };
  }

  /**
   * The existing ask this one duplicates, if any — same kind, similar words, still
   * open. Returns the canonical row's id.
   */
  #findCluster(input: NewFeedback): string | null {
    const candidates = this.#db
      .prepare(
        `SELECT * FROM feedback
          WHERE kind = ? AND status != 'declined'
          ORDER BY created_at DESC LIMIT 200`,
      )
      .all(input.kind) as unknown as FeedbackRow[];

    const mine = `${input.title} ${input.summary}`;
    let best: { id: string; score: number } | null = null;
    for (const row of candidates) {
      const score = similarity(mine, `${row.title} ${row.summary}`);
      if (score >= FeedbackStore.SIMILAR && (best === null || score > best.score)) {
        best = { id: row.cluster_id ?? row.id, score };
      }
    }
    return best?.id ?? null;
  }

  add(input: NewFeedback): Feedback {
    const id = randomUUID();
    const at = nowIso();
    const clusterId = this.#findCluster(input);

    const flags = [
      ...reviewFlags(`${input.title} ${input.summary}`, false),
      ...input.messages.filter((message) => message.role === 'agent').flatMap((message) => reviewFlags(message.text, true)),
    ];
    const unique = [...new Set(flags)];

    this.#db
      .prepare(
        `INSERT INTO feedback (id, user_id, user_name, role, kind, title, summary, area, sentiment, screen,
                               pack_reference, status, cluster_id, needs_review, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.userName,
        input.role,
        input.kind,
        input.title,
        input.summary,
        input.area,
        input.sentiment ?? 'neutral',
        input.screen ?? '',
        input.packReference ?? '',
        clusterId,
        unique.join('|'),
        at,
        at,
      );

    const insertMessage = this.#db.prepare(
      'INSERT INTO feedback_messages (id, feedback_id, role, text, at) VALUES (?, ?, ?, ?, ?)',
    );
    input.messages.forEach((message, index) => {
      insertMessage.run(`${id}-${index}`, id, message.role, message.text, at);
    });

    return this.get(id) as Feedback;
  }

  /** How often this pattern has been closed out before, from the anonymous tally. */
  #previousAsks(kind: string, text: string): number {
    const rows = this.#db
      .prepare('SELECT kind, title, count FROM feedback_done')
      .all() as unknown as Array<{ kind: string; title: string; count: number }>;
    let total = 0;
    for (const row of rows) {
      if (row.kind !== kind) continue;
      if (similarity(text, row.title) >= FeedbackStore.SIMILAR) total += row.count;
    }
    return total;
  }

  /** Record the pattern, and nothing else, so the next identical ask is not blind. */
  #remember(item: Feedback): void {
    const rows = this.#db
      .prepare('SELECT * FROM feedback_done')
      .all() as unknown as Array<{ id: string; kind: string; title: string; count: number }>;
    const text = `${item.title} ${item.summary}`;
    const match = rows.find((row) => row.kind === item.kind && similarity(text, row.title) >= FeedbackStore.SIMILAR);

    const at = nowIso();
    if (match !== undefined) {
      this.#db
        .prepare('UPDATE feedback_done SET count = count + 1, last_at = ? WHERE id = ?')
        .run(at, match.id);
      return;
    }
    this.#db
      .prepare('INSERT INTO feedback_done (id, kind, title, count, first_at, last_at) VALUES (?, ?, ?, 1, ?, ?)')
      .run(randomUUID(), item.kind, item.title, at, at);
  }

  /**
   * Done: the record is removed, at once — the row, its conversation and who sent it.
   *
   * What survives is one anonymous line counting the pattern, because "we have been
   * asked for this four times" is the thing that decides what to build, and it is not
   * personal data. Nothing that identifies the person or repeats their words is kept.
   */
  complete(id: string): { removed: boolean; title: string; previousAsks: number } {
    const item = this.get(id);
    if (item === null) return { removed: false, title: '', previousAsks: 0 };
    this.#remember(item);
    this.#db.prepare('DELETE FROM feedback_messages WHERE feedback_id = ?').run(id);
    this.#db.prepare('DELETE FROM feedback WHERE id = ?').run(id);
    return { removed: true, title: item.title, previousAsks: item.previousAsks + 1 };
  }

  get(id: string): Feedback | null {
    const row = this.#db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as unknown as
      | FeedbackRow
      | undefined;
    return row === undefined ? null : this.#map(row);
  }

  /** One person's own feedback. This is the only way a non-operator sees a row. */
  forUser(userId: string, limit = 50): Feedback[] {
    const rows = this.#db
      .prepare('SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit) as unknown as FeedbackRow[];
    return rows.map((row) => this.#map(row));
  }

  /** The queue: operator only, and enforced in the route, not here. */
  queue(filter: { status?: string; kind?: string } = {}, limit = 200): Feedback[] {
    const where: string[] = [];
    const values: string[] = [];
    if (filter.status !== undefined && filter.status !== '') {
      where.push('status = ?');
      values.push(filter.status);
    }
    if (filter.kind !== undefined && filter.kind !== '') {
      where.push('kind = ?');
      values.push(filter.kind);
    }
    const sql = `SELECT * FROM feedback ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY created_at DESC LIMIT ?`;
    const rows = this.#db.prepare(sql).all(...values, limit) as unknown as FeedbackRow[];
    return rows.map((row) => this.#map(row));
  }

  counts(): Record<string, number> {
    const rows = this.#db
      .prepare('SELECT status, COUNT(*) AS count FROM feedback GROUP BY status')
      .all() as unknown as Array<{ status: string; count: number }>;
    const out: Record<string, number> = {};
    for (const row of rows) out[row.status] = row.count;
    return out;
  }

  update(
    id: string,
    patch: { status?: FeedbackStatus; operatorNote?: string; publicNote?: string },
  ): Feedback | null {
    const row = this.#db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as unknown as
      | FeedbackRow
      | undefined;
    if (row === undefined) return null;

    const status = patch.status ?? (row.status as FeedbackStatus);
    const doneAt = status === 'done' || status === 'declined' ? (row.done_at ?? nowIso()) : null;

    this.#db
      .prepare(
        `UPDATE feedback SET status = ?, operator_note = ?, public_note = ?, done_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        status,
        patch.operatorNote === undefined ? row.operator_note : patch.operatorNote,
        patch.publicNote === undefined ? row.public_note : patch.publicNote,
        doneAt,
        nowIso(),
        id,
      );

    return this.get(id);
  }

  /** How many submissions one person has made recently, for the rate limit. */
  countSince(userId: string, sinceIso: string): number {
    const row = this.#db
      .prepare('SELECT COUNT(*) AS count FROM feedback WHERE user_id = ? AND created_at >= ?')
      .get(userId, sinceIso) as { count: number };
    return row.count;
  }

  /** Markdown for a file or a tracker; private notes stay private unless asked for. */
  toMarkdown(includeOperatorNotes: boolean): string {
    const items = this.queue({}, 500);
    const lines: string[] = [`# Feedback — ${items.length} record${items.length === 1 ? '' : 's'}`, ''];
    for (const item of items) {
      lines.push(`## ${item.title}`);
      lines.push(
        `*${item.kind}* · ${item.status} · from ${item.userName} (${item.role})${item.screen === '' ? '' : ` · ${item.screen}`}${item.clusterCount > 1 ? ` · asked ${item.clusterCount} times` : ''}`,
      );
      lines.push('');
      lines.push(item.summary);
      lines.push('');
      if (item.needsReview.length > 0) lines.push(`> Needs a look: ${item.needsReview.join('; ')}`);
      if (item.publicNote !== '') lines.push(`> Said to the tester: ${item.publicNote}`);
      if (includeOperatorNotes && item.operatorNote !== '') lines.push(`> Note: ${item.operatorNote}`);
      lines.push('');
    }
    return lines.join('\n');
  }
}
