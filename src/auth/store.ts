/**
 * People, sessions and the record of who did what.
 *
 * Three tables in the same SQLite file as everything else:
 *
 *   users     one row per person allowed in. Roles: owner, agent, landlord.
 *   sessions  one row per signed-in browser. The cookie holds a random token;
 *             only its SHA-256 is stored, so a copy of the database cannot be
 *             used to sign in.
 *   events    the audit trail. Every change that matters records who made it, on
 *             which pack, and when — which is the thing a shared password could
 *             never tell you.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashPassword, verifyPassword } from './passwords.ts';

export type Role = 'owner' | 'agent' | 'landlord';

export const ROLES: readonly Role[] = ['owner', 'agent', 'landlord'];

/** How a role is described to a person choosing one. */
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner — everything, including people and settings',
  agent: 'Agent — every tenancy pack and record, no settings or people',
  landlord: 'Landlord — read-only access to their own properties and packs',
};

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  landlordId: string | null;
  createdAt: string;
  disabledAt: string | null;
  lastLoginAt: string | null;
};

export type Session = {
  id: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string;
  userAgent: string;
};

export type AuditEvent = {
  id: string;
  packId: string | null;
  actorId: string | null;
  actorName: string;
  kind: string;
  detail: string;
  at: string;
};

/** A signed-in browser is good for twelve hours, and at most a week. */
const SESSION_HOURS = 12;
const SESSION_MAX_DAYS = 7;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'agent',
  password_hash TEXT NOT NULL,
  landlord_id   TEXT,
  created_at    TEXT NOT NULL,
  disabled_at   TEXT,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  ip           TEXT NOT NULL DEFAULT '',
  user_agent   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  pack_id    TEXT,
  actor_id   TEXT,
  actor_name TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_pack ON events(pack_id);
CREATE INDEX IF NOT EXISTS idx_events_at ON events(at);
`;

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  password_hash: string;
  landlord_id: string | null;
  created_at: string;
  disabled_at: string | null;
  last_login_at: string | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  ip: string;
  user_agent: string;
};

type EventRow = {
  id: string;
  pack_id: string | null;
  actor_id: string | null;
  actor_name: string;
  kind: string;
  detail: string;
  at: string;
};

const nowIso = (): string => new Date().toISOString();

const isoAfter = (from: Date, hours: number): string =>
  new Date(from.getTime() + hours * 60 * 60 * 1000).toISOString();

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: (row.role as Role | undefined) ?? 'agent',
    landlordId: row.landlord_id ?? null,
    createdAt: row.created_at,
    disabledAt: row.disabled_at ?? null,
    lastLoginAt: row.last_login_at ?? null,
  };
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    ip: row.ip,
    userAgent: row.user_agent,
  };
}

function mapEvent(row: EventRow): AuditEvent {
  return {
    id: row.id,
    packId: row.pack_id ?? null,
    actorId: row.actor_id ?? null,
    actorName: row.actor_name,
    kind: row.kind,
    detail: row.detail,
    at: row.at,
  };
}

export type NewUser = {
  email: string;
  name: string;
  role: Role;
  password: string;
  landlordId?: string | null;
};

export class AuthStore {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#db.exec(SCHEMA);
  }

  // --- people -------------------------------------------------------------

  /** True while nobody can sign in: the first-run screen is the only way in. */
  needsSetup(): boolean {
    const row = this.#db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    return row.count === 0;
  }

  countUsers(): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    return row.count;
  }

  listUsers(): User[] {
    const rows = this.#db
      .prepare('SELECT * FROM users ORDER BY created_at ASC')
      .all() as unknown as UserRow[];
    return rows.map(mapUser);
  }

  getUser(id: string): User | null {
    const row = this.#db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;
    return row === undefined ? null : mapUser(row);
  }

  findUserByEmail(email: string): User | null {
    const row = this.#db.prepare('SELECT * FROM users WHERE email = ?').get(normaliseEmail(email)) as unknown as
      | UserRow
      | undefined;
    return row === undefined ? null : mapUser(row);
  }

  async createUser(input: NewUser): Promise<User> {
    const email = normaliseEmail(input.email);
    if (email === '' || !email.includes('@')) throw new Error('That does not look like an email address.');
    if (this.findUserByEmail(email) !== null) {
      throw new Error('Somebody already signs in with that email address.');
    }

    const id = randomUUID();
    const passwordHash = await hashPassword(input.password);
    this.#db
      .prepare(
        `INSERT INTO users (id, email, name, role, password_hash, landlord_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, email, input.name.trim(), input.role, passwordHash, input.landlordId ?? null, nowIso());

    const created = this.getUser(id);
    if (created === null) throw new Error('The account could not be created.');
    return created;
  }

  /** The password, if it is right, and the account is neither disabled nor gone. */
  async authenticate(email: string, password: string): Promise<User | null> {
    const row = this.#db.prepare('SELECT * FROM users WHERE email = ?').get(normaliseEmail(email)) as unknown as
      | UserRow
      | undefined;
    if (row === undefined) return null;
    if (row.disabled_at !== null) return null;

    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) return null;

    this.#db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), row.id);
    return this.getUser(row.id);
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    this.#db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
  }

  setDisabled(userId: string, disabled: boolean): void {
    this.#db
      .prepare('UPDATE users SET disabled_at = ? WHERE id = ?')
      .run(disabled ? nowIso() : null, userId);
    if (disabled) this.revokeAllSessions(userId);
  }

  updateUser(userId: string, patch: { name?: string; role?: Role; landlordId?: string | null }): User | null {
    const user = this.getUser(userId);
    if (user === null) return null;
    this.#db
      .prepare('UPDATE users SET name = ?, role = ?, landlord_id = ? WHERE id = ?')
      .run(
        patch.name === undefined ? user.name : patch.name.trim(),
        patch.role === undefined ? user.role : patch.role,
        patch.landlordId === undefined ? user.landlordId : patch.landlordId,
        userId,
      );
    return this.getUser(userId);
  }

  // --- sessions -----------------------------------------------------------

  /** A new token, and the row that recognises it. The raw token is not stored. */
  createSession(userId: string, details: { ip: string; userAgent: string }): { token: string; session: Session } {
    const token = randomBytes(32).toString('base64url');
    const id = hashToken(token);
    const now = new Date();
    this.#db
      .prepare(
        `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        now.toISOString(),
        now.toISOString(),
        isoAfter(now, SESSION_HOURS),
        details.ip,
        details.userAgent.slice(0, 200),
      );

    const row = this.#db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as SessionRow;
    return { token, session: mapSession(row) };
  }

  /**
   * Who this token belongs to, sliding the session forward as it is used — but
   * never past a week from when it was first created.
   */
  sessionUser(token: string): { user: User; session: Session } | null {
    if (token === '') return null;
    const id = hashToken(token);
    const row = this.#db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as
      | SessionRow
      | undefined;
    if (row === undefined) return null;

    const now = new Date();
    if (new Date(row.expires_at).getTime() <= now.getTime()) {
      this.#db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      return null;
    }

    const user = this.getUser(row.user_id);
    if (user === null || user.disabledAt !== null) {
      this.#db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      return null;
    }

    const hardStop = new Date(new Date(row.created_at).getTime() + SESSION_MAX_DAYS * 24 * 60 * 60 * 1000);
    const slid = new Date(
      Math.min(now.getTime() + SESSION_HOURS * 60 * 60 * 1000, hardStop.getTime()),
    );
    this.#db
      .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(now.toISOString(), slid.toISOString(), id);

    return {
      user,
      session: { ...mapSession(row), lastSeenAt: now.toISOString(), expiresAt: slid.toISOString() },
    };
  }

  revokeSession(token: string): void {
    if (token === '') return;
    this.#db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
  }

  revokeAllSessions(userId: string): void {
    this.#db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  /** Sign out everything except the browser making the request. */
  signOutOthers(userId: string, keepToken: string): void {
    this.#db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, hashToken(keepToken));
  }

  /** The row id for a cookie token, so the interface can mark "this device". */
  sessionIdFor(token: string): string {
    return hashToken(token);
  }

  /** Signed-in browsers for one person, for the "sign out everywhere" button. */
  listSessions(userId: string): Session[] {
    const rows = this.#db
      .prepare('SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC')
      .all(userId, nowIso()) as unknown as SessionRow[];
    return rows.map(mapSession);
  }

  purgeExpiredSessions(): void {
    this.#db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
  }

  // --- the record of what happened ----------------------------------------

  record(event: {
    packId?: string | null;
    actor?: Pick<User, 'id' | 'name'> | null;
    kind: string;
    detail?: string;
  }): AuditEvent {
    const row: AuditEvent = {
      id: randomUUID(),
      packId: event.packId ?? null,
      actorId: event.actor?.id ?? null,
      actorName: event.actor?.name ?? 'System',
      kind: event.kind,
      detail: event.detail ?? '',
      at: nowIso(),
    };
    this.#db
      .prepare('INSERT INTO events (id, pack_id, actor_id, actor_name, kind, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.packId, row.actorId, row.actorName, row.kind, row.detail, row.at);
    return row;
  }

  /** Events for one pack, newest first — what the History tab shows. */
  eventsForPack(packId: string, limit = 100): AuditEvent[] {
    const rows = this.#db
      .prepare('SELECT * FROM events WHERE pack_id = ? ORDER BY at DESC LIMIT ?')
      .all(packId, limit) as unknown as EventRow[];
    return rows.map(mapEvent);
  }

  /** Events that are about the agency rather than a tenancy: people, settings. */
  recentEvents(limit = 50): AuditEvent[] {
    const rows = this.#db
      .prepare('SELECT * FROM events ORDER BY at DESC LIMIT ?')
      .all(limit) as unknown as EventRow[];
    return rows.map(mapEvent);
  }

  /** Who created a pack — the first event, not the latest. */
  packCreator(packId: string): AuditEvent | null {
    const row = this.#db
      .prepare("SELECT * FROM events WHERE pack_id = ? AND kind = 'pack.created' ORDER BY at ASC LIMIT 1")
      .get(packId) as unknown as EventRow | undefined;
    return row === undefined ? null : mapEvent(row);
  }
}
