/**
 * The back office: the records a tenancy is built from.
 *
 * Until now a pack was an island holding a flat dictionary, so the address, the
 * landlord, the room and the rent were retyped for every tenant. These tables
 * are the things that stay the same, so a new tenancy only has to say what is
 * different.
 *
 * The tenancy itself stays in `packs` — it simply gains links to these records.
 * Nothing is moved, so nothing can be lost.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { ReviewMode } from '../docs/gate.ts';

export type Lifecycle = 'upcoming' | 'active' | 'ending' | 'ended';

export const LIFECYCLES: readonly Lifecycle[] = ['upcoming', 'active', 'ending', 'ended'];

export type Landlord = {
  id: string;
  name: string;
  address: string;
  email: string;
  phone: string;
};

export type PropertyRecord = {
  id: string;
  landlordId: string | null;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postcode: string;
  council: string;
  epcRating: string;
  epcReference: string;
  propertyType: string;
  furnishedStatus: string;
};

export type RoomRecord = {
  id: string;
  propertyId: string;
  roomNumber: string;
  rentAmount: number | null;
  rentFrequency: string;
  depositAmount: number | null;
  /** `let` or `available` — the void list depends on this. */
  status: string;
};

export type TenantRecord = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  dob: string;
  currentAddress: string;
  idType: string;
  idReference: string;
};

export type AgencySettings = {
  name: string;
  address: string;
  phone: string;
  email: string;
  clientMoneyScheme: string;
  redressScheme: string;
  negotiator: string;
  rentAccount: string;
  /** How insistently the app behaves about outstanding findings. */
  reviewMode: ReviewMode;
};

export const EMPTY_AGENCY: AgencySettings = {
  name: '',
  address: '',
  phone: '',
  email: '',
  clientMoneyScheme: '',
  redressScheme: '',
  negotiator: '',
  rentAccount: '',
  reviewMode: 'relaxed',
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS landlords (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS properties (
  id               TEXT PRIMARY KEY,
  landlord_id      TEXT REFERENCES landlords(id) ON DELETE SET NULL,
  address_line1    TEXT NOT NULL DEFAULT '',
  address_line2    TEXT NOT NULL DEFAULT '',
  city             TEXT NOT NULL DEFAULT '',
  postcode         TEXT NOT NULL DEFAULT '',
  council          TEXT NOT NULL DEFAULT '',
  epc_rating       TEXT NOT NULL DEFAULT '',
  epc_reference    TEXT NOT NULL DEFAULT '',
  property_type    TEXT NOT NULL DEFAULT '',
  furnished_status TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id             TEXT PRIMARY KEY,
  property_id    TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room_number    TEXT NOT NULL DEFAULT '',
  rent_amount    REAL,
  rent_frequency TEXT NOT NULL DEFAULT 'Monthly',
  deposit_amount REAL,
  status         TEXT NOT NULL DEFAULT 'available',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rooms_property ON rooms(property_id);

CREATE TABLE IF NOT EXISTS tenants (
  id              TEXT PRIMARY KEY,
  full_name       TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  dob             TEXT NOT NULL DEFAULT '',
  current_address TEXT NOT NULL DEFAULT '',
  id_type         TEXT NOT NULL DEFAULT '',
  id_reference    TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agency_settings (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  name                TEXT NOT NULL DEFAULT '',
  address             TEXT NOT NULL DEFAULT '',
  phone               TEXT NOT NULL DEFAULT '',
  email               TEXT NOT NULL DEFAULT '',
  client_money_scheme TEXT NOT NULL DEFAULT '',
  redress_scheme      TEXT NOT NULL DEFAULT '',
  negotiator          TEXT NOT NULL DEFAULT '',
  rent_account        TEXT NOT NULL DEFAULT '',
  review_mode         TEXT NOT NULL DEFAULT 'relaxed'
);
`;

/** Columns added to `packs` so a tenancy can point at the records above. */
const PACK_COLUMNS: Record<string, string> = {
  landlord_id: 'TEXT',
  property_id: 'TEXT',
  room_id: 'TEXT',
  tenant_id: 'TEXT',
  lifecycle: "TEXT NOT NULL DEFAULT 'upcoming'",
};

function nowIso(): string {
  return new Date().toISOString();
}

function addMissingColumns(db: DatabaseSync, table: string, columns: Record<string, string>): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const existing = new Set(rows.map((row) => row.name));
  for (const [name, declaration] of Object.entries(columns)) {
    if (existing.has(name)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
  }
}

type Row = Record<string, unknown>;

const text = (row: Row, key: string): string => (typeof row[key] === 'string' ? (row[key] as string) : '');
const maybeNumber = (row: Row, key: string): number | null =>
  typeof row[key] === 'number' ? (row[key] as number) : null;

export class BackOffice {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(SCHEMA);
    addMissingColumns(this.db, 'packs', PACK_COLUMNS);
    addMissingColumns(this.db, 'agency_settings', { review_mode: "TEXT NOT NULL DEFAULT 'relaxed'" });
  }

  /* --- agency settings --------------------------------------------------- */

  getSettings(): AgencySettings {
    const row = this.db.prepare('SELECT * FROM agency_settings WHERE id = 1').get() as Row | undefined;
    if (row === undefined) return { ...EMPTY_AGENCY };
    return {
      name: text(row, 'name'),
      address: text(row, 'address'),
      phone: text(row, 'phone'),
      email: text(row, 'email'),
      clientMoneyScheme: text(row, 'client_money_scheme'),
      redressScheme: text(row, 'redress_scheme'),
      negotiator: text(row, 'negotiator'),
      rentAccount: text(row, 'rent_account'),
      reviewMode: text(row, 'review_mode') === 'strict' ? 'strict' : 'relaxed',
    };
  }

  saveSettings(patch: Partial<AgencySettings>): AgencySettings {
    const current = this.getSettings();
    const next: AgencySettings = { ...current, ...patch };
    this.db
      .prepare(
        `INSERT INTO agency_settings (id, name, address, phone, email, client_money_scheme, redress_scheme, negotiator, rent_account, review_mode)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, address = excluded.address, phone = excluded.phone, email = excluded.email,
           client_money_scheme = excluded.client_money_scheme, redress_scheme = excluded.redress_scheme,
           negotiator = excluded.negotiator, rent_account = excluded.rent_account, review_mode = excluded.review_mode`,
      )
      .run(
        next.name,
        next.address,
        next.phone,
        next.email,
        next.clientMoneyScheme,
        next.redressScheme,
        next.negotiator,
        next.rentAccount,
        next.reviewMode,
      );
    return next;
  }

  /* --- landlords --------------------------------------------------------- */

  listLandlords(): Landlord[] {
    const rows = this.db.prepare('SELECT * FROM landlords ORDER BY name COLLATE NOCASE').all() as Row[];
    return rows.map((row) => ({
      id: text(row, 'id'),
      name: text(row, 'name'),
      address: text(row, 'address'),
      email: text(row, 'email'),
      phone: text(row, 'phone'),
    }));
  }

  getLandlord(id: string): Landlord | null {
    return this.listLandlords().find((landlord) => landlord.id === id) ?? null;
  }

  createLandlord(input: Partial<Landlord>): Landlord {
    const id = randomUUID();
    const stamp = nowIso();
    this.db
      .prepare('INSERT INTO landlords (id, name, address, email, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.name ?? '', input.address ?? '', input.email ?? '', input.phone ?? '', stamp, stamp);
    return this.getLandlord(id) as Landlord;
  }

  updateLandlord(id: string, patch: Partial<Landlord>): Landlord {
    const current = this.getLandlord(id);
    if (current === null) throw new Error('That landlord no longer exists.');
    const next = { ...current, ...patch };
    this.db
      .prepare('UPDATE landlords SET name = ?, address = ?, email = ?, phone = ?, updated_at = ? WHERE id = ?')
      .run(next.name, next.address, next.email, next.phone, nowIso(), id);
    return this.getLandlord(id) as Landlord;
  }

  deleteLandlord(id: string): void {
    this.db.prepare('DELETE FROM landlords WHERE id = ?').run(id);
  }

  /* --- properties -------------------------------------------------------- */

  listProperties(): PropertyRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM properties ORDER BY address_line1 COLLATE NOCASE, postcode')
      .all() as Row[];
    return rows.map((row) => ({
      id: text(row, 'id'),
      landlordId: row['landlord_id'] === null ? null : text(row, 'landlord_id'),
      addressLine1: text(row, 'address_line1'),
      addressLine2: text(row, 'address_line2'),
      city: text(row, 'city'),
      postcode: text(row, 'postcode'),
      council: text(row, 'council'),
      epcRating: text(row, 'epc_rating'),
      epcReference: text(row, 'epc_reference'),
      propertyType: text(row, 'property_type'),
      furnishedStatus: text(row, 'furnished_status'),
    }));
  }

  getProperty(id: string): PropertyRecord | null {
    return this.listProperties().find((property) => property.id === id) ?? null;
  }

  createProperty(input: Partial<PropertyRecord>): PropertyRecord {
    const id = randomUUID();
    const stamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO properties (id, landlord_id, address_line1, address_line2, city, postcode, council,
           epc_rating, epc_reference, property_type, furnished_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.landlordId ?? null,
        input.addressLine1 ?? '',
        input.addressLine2 ?? '',
        input.city ?? '',
        input.postcode ?? '',
        input.council ?? '',
        input.epcRating ?? '',
        input.epcReference ?? '',
        input.propertyType ?? '',
        input.furnishedStatus ?? '',
        stamp,
        stamp,
      );
    return this.getProperty(id) as PropertyRecord;
  }

  updateProperty(id: string, patch: Partial<PropertyRecord>): PropertyRecord {
    const current = this.getProperty(id);
    if (current === null) throw new Error('That property no longer exists.');
    const next = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE properties SET landlord_id = ?, address_line1 = ?, address_line2 = ?, city = ?, postcode = ?,
           council = ?, epc_rating = ?, epc_reference = ?, property_type = ?, furnished_status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.landlordId,
        next.addressLine1,
        next.addressLine2,
        next.city,
        next.postcode,
        next.council,
        next.epcRating,
        next.epcReference,
        next.propertyType,
        next.furnishedStatus,
        nowIso(),
        id,
      );
    return this.getProperty(id) as PropertyRecord;
  }

  deleteProperty(id: string): void {
    this.db.prepare('DELETE FROM properties WHERE id = ?').run(id);
  }

  /* --- rooms ------------------------------------------------------------- */

  listRooms(propertyId?: string): RoomRecord[] {
    const rows = (propertyId === undefined
      ? this.db.prepare('SELECT * FROM rooms ORDER BY room_number COLLATE NOCASE').all()
      : this.db.prepare('SELECT * FROM rooms WHERE property_id = ? ORDER BY room_number COLLATE NOCASE').all(propertyId)) as Row[];
    return rows.map((row) => ({
      id: text(row, 'id'),
      propertyId: text(row, 'property_id'),
      roomNumber: text(row, 'room_number'),
      rentAmount: maybeNumber(row, 'rent_amount'),
      rentFrequency: text(row, 'rent_frequency'),
      depositAmount: maybeNumber(row, 'deposit_amount'),
      status: text(row, 'status'),
    }));
  }

  getRoom(id: string): RoomRecord | null {
    return this.listRooms().find((room) => room.id === id) ?? null;
  }

  createRoom(input: Partial<RoomRecord> & { propertyId: string }): RoomRecord {
    const id = randomUUID();
    const stamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO rooms (id, property_id, room_number, rent_amount, rent_frequency, deposit_amount, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.propertyId,
        input.roomNumber ?? '',
        input.rentAmount ?? null,
        input.rentFrequency ?? 'Monthly',
        input.depositAmount ?? null,
        input.status ?? 'available',
        stamp,
        stamp,
      );
    return this.getRoom(id) as RoomRecord;
  }

  updateRoom(id: string, patch: Partial<RoomRecord>): RoomRecord {
    const current = this.getRoom(id);
    if (current === null) throw new Error('That room no longer exists.');
    const next = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE rooms SET room_number = ?, rent_amount = ?, rent_frequency = ?, deposit_amount = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.roomNumber,
        next.rentAmount,
        next.rentFrequency,
        next.depositAmount,
        next.status,
        nowIso(),
        id,
      );
    return this.getRoom(id) as RoomRecord;
  }

  deleteRoom(id: string): void {
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
  }

  /* --- tenants ----------------------------------------------------------- */

  listTenants(): TenantRecord[] {
    const rows = this.db.prepare('SELECT * FROM tenants ORDER BY full_name COLLATE NOCASE').all() as Row[];
    return rows.map((row) => ({
      id: text(row, 'id'),
      fullName: text(row, 'full_name'),
      email: text(row, 'email'),
      phone: text(row, 'phone'),
      dob: text(row, 'dob'),
      currentAddress: text(row, 'current_address'),
      idType: text(row, 'id_type'),
      idReference: text(row, 'id_reference'),
    }));
  }

  getTenant(id: string): TenantRecord | null {
    return this.listTenants().find((tenant) => tenant.id === id) ?? null;
  }

  createTenant(input: Partial<TenantRecord>): TenantRecord {
    const id = randomUUID();
    const stamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO tenants (id, full_name, email, phone, dob, current_address, id_type, id_reference, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.fullName ?? '',
        input.email ?? '',
        input.phone ?? '',
        input.dob ?? '',
        input.currentAddress ?? '',
        input.idType ?? '',
        input.idReference ?? '',
        stamp,
        stamp,
      );
    return this.getTenant(id) as TenantRecord;
  }

  updateTenant(id: string, patch: Partial<TenantRecord>): TenantRecord {
    const current = this.getTenant(id);
    if (current === null) throw new Error('That tenant no longer exists.');
    const next = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE tenants SET full_name = ?, email = ?, phone = ?, dob = ?, current_address = ?, id_type = ?, id_reference = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.fullName,
        next.email,
        next.phone,
        next.dob,
        next.currentAddress,
        next.idType,
        next.idReference,
        nowIso(),
        id,
      );
    return this.getTenant(id) as TenantRecord;
  }

  deleteTenant(id: string): void {
    this.db.prepare('DELETE FROM tenants WHERE id = ?').run(id);
  }

  /* --- links ------------------------------------------------------------- */

  /** How many live tenancies depend on this record — asked before a shared change. */
  countTenanciesUsing(column: 'landlord_id' | 'property_id' | 'room_id' | 'tenant_id', id: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM packs WHERE ${column} = ? AND lifecycle != 'ended'`)
      .get(id) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** Rooms, with the property they belong to and how many tenancies use them. */
  roomSummary(): Array<RoomRecord & { propertyAddress: string; tenancyCount: number }> {
    const properties = new Map(this.listProperties().map((property) => [property.id, property]));
    return this.listRooms().map((room) => {
      const property = properties.get(room.propertyId);
      return {
        ...room,
        propertyAddress: property === undefined ? '' : `${property.addressLine1}${property.postcode === '' ? '' : `, ${property.postcode}`}`,
        tenancyCount: this.countTenanciesUsing('room_id', room.id),
      };
    });
  }

  stats(): { landlords: number; properties: number; rooms: number; tenants: number } {
    const one = (sql: string) => (this.db.prepare(sql).get() as { count: number }).count;
    return {
      landlords: one('SELECT COUNT(*) AS count FROM landlords'),
      properties: one('SELECT COUNT(*) AS count FROM properties'),
      rooms: one('SELECT COUNT(*) AS count FROM rooms'),
      tenants: one('SELECT COUNT(*) AS count FROM tenants'),
    };
  }
}
