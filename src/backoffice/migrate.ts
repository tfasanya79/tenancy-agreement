/**
 * Turning the packs that already exist into back-office records.
 *
 * There is real data in `data/` — two tenancies at least — and it must not be lost
 * or quietly merged. So this proposes a plan, shows it, and only writes when told
 * to. Nothing is deleted: a pack keeps its details and simply gains links.
 */

import type { Pack, Store } from '../db.ts';
import type { BackOffice } from './entities.ts';

export type ProposedLandlord = {
  key: string;
  name: string;
  address: string;
  email: string;
  phone: string;
  /** Packs that would point at it, for the preview. */
  fromReferences: string[];
};

export type ProposedProperty = {
  key: string;
  landlordKey: string | null;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postcode: string;
  council: string;
  epcRating: string;
  epcReference: string;
  propertyType: string;
  furnishedStatus: string;
  fromReferences: string[];
};

export type ProposedRoom = {
  key: string;
  propertyKey: string;
  roomNumber: string;
  rentAmount: number | null;
  rentFrequency: string;
  depositAmount: number | null;
  fromReferences: string[];
};

export type ProposedTenant = {
  key: string;
  fullName: string;
  email: string;
  phone: string;
  fromReferences: string[];
};

export type ProposedLink = {
  packId: string;
  reference: string;
  landlordKey: string | null;
  propertyKey: string | null;
  roomKey: string | null;
  tenantKey: string | null;
};

export type MigrationPlan = {
  landlords: ProposedLandlord[];
  properties: ProposedProperty[];
  rooms: ProposedRoom[];
  tenants: ProposedTenant[];
  links: ProposedLink[];
  /** Packs that already point at records, so nothing to do. */
  alreadyLinked: number;
  warnings: string[];
};

const str = (fields: Record<string, unknown>, key: string): string => {
  const value = fields[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
};

const num = (fields: Record<string, unknown>, key: string): number | null => {
  const value = fields[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/[£,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalise = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();

function firstTenant(fields: Record<string, unknown>): Record<string, unknown> | null {
  const list = fields['tenants'];
  if (!Array.isArray(list) || list.length === 0) return null;
  const first = list[0];
  return typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : null;
}

/** Work out what would be created, without writing anything. */
export function previewMigration(packs: readonly Pack[]): MigrationPlan {
  const landlords = new Map<string, ProposedLandlord>();
  const properties = new Map<string, ProposedProperty>();
  const rooms = new Map<string, ProposedRoom>();
  const tenants = new Map<string, ProposedTenant>();
  const links: ProposedLink[] = [];
  const warnings: string[] = [];
  let alreadyLinked = 0;

  for (const pack of packs) {
    const fields = pack.fields;

    // Links live on the pack's own columns, not inside its fields.
    if (pack.propertyId !== null) {
      alreadyLinked += 1;
      continue;
    }

    // --- landlord ---------------------------------------------------------
    const landlordName = str(fields, 'landlord.full_name');
    let landlordKey: string | null = null;
    if (landlordName !== '') {
      landlordKey = normalise(landlordName);
      const existing = landlords.get(landlordKey);
      if (existing === undefined) {
        landlords.set(landlordKey, {
          key: landlordKey,
          name: landlordName,
          address: str(fields, 'landlord.address'),
          email: str(fields, 'landlord.email'),
          phone: str(fields, 'landlord.phone'),
          fromReferences: [pack.reference],
        });
      } else {
        existing.fromReferences.push(pack.reference);
        // Fill blanks from a later pack rather than overwriting what we have.
        if (existing.address === '') existing.address = str(fields, 'landlord.address');
        if (existing.email === '') existing.email = str(fields, 'landlord.email');
        if (existing.phone === '') existing.phone = str(fields, 'landlord.phone');
      }
    }

    // --- property ---------------------------------------------------------
    const line1 = str(fields, 'property.address_line1');
    const postcode = str(fields, 'property.postcode');
    let propertyKey: string | null = null;

    if (line1 === '' && postcode === '') {
      warnings.push(`${pack.reference} has no property address, so it will not be linked to a property.`);
    } else {
      propertyKey = `${normalise(line1)}|${normalise(postcode)}`;
      const existing = properties.get(propertyKey);
      if (existing === undefined) {
        properties.set(propertyKey, {
          key: propertyKey,
          landlordKey,
          addressLine1: line1,
          addressLine2: str(fields, 'property.address_line2'),
          city: str(fields, 'property.city'),
          postcode,
          council: str(fields, 'property.council_name'),
          epcRating: str(fields, 'property.epc_rating'),
          epcReference: str(fields, 'property.epc_reference'),
          propertyType: str(fields, 'property.property_type'),
          furnishedStatus: str(fields, 'property.furnished_status'),
          fromReferences: [pack.reference],
        });
      } else {
        existing.fromReferences.push(pack.reference);
        if (existing.landlordKey === null) existing.landlordKey = landlordKey;
        else if (landlordKey !== null && existing.landlordKey !== landlordKey) {
          warnings.push(
            `${existing.addressLine1} appears with two different landlords (${existing.landlordKey} and ${landlordKey}). Check before confirming.`,
          );
        }
        if (existing.city === '') existing.city = str(fields, 'property.city');
        if (existing.epcRating === '') existing.epcRating = str(fields, 'property.epc_rating');
      }
    }

    // --- room -------------------------------------------------------------
    const roomNumber = str(fields, 'property.room_number');
    let roomKey: string | null = null;
    if (propertyKey !== null && roomNumber !== '') {
      roomKey = `${propertyKey}#${normalise(roomNumber)}`;
      if (!rooms.has(roomKey)) {
        rooms.set(roomKey, {
          key: roomKey,
          propertyKey,
          roomNumber,
          rentAmount: num(fields, 'tenancy.rent_amount'),
          rentFrequency: str(fields, 'tenancy.rent_frequency') === '' ? 'Monthly' : str(fields, 'tenancy.rent_frequency'),
          depositAmount: num(fields, 'tenancy.deposit_amount'),
          fromReferences: [pack.reference],
        });
      } else {
        rooms.get(roomKey)?.fromReferences.push(pack.reference);
      }
    }

    // --- tenant -----------------------------------------------------------
    const person = firstTenant(fields);
    const fullName = person === null ? '' : String(person['full_name'] ?? '').trim();
    const email = person === null ? '' : String(person['email'] ?? '').trim();
    let tenantKey: string | null = null;
    if (fullName !== '') {
      tenantKey = `${normalise(fullName)}|${normalise(email)}`;
      if (!tenants.has(tenantKey)) {
        tenants.set(tenantKey, {
          key: tenantKey,
          fullName,
          email,
          phone: person === null ? '' : String(person['phone'] ?? '').trim(),
          fromReferences: [pack.reference],
        });
      } else {
        tenants.get(tenantKey)?.fromReferences.push(pack.reference);
      }
    }

    links.push({ packId: pack.id, reference: pack.reference, landlordKey, propertyKey, roomKey, tenantKey });
  }

  return {
    landlords: [...landlords.values()],
    properties: [...properties.values()],
    rooms: [...rooms.values()],
    tenants: [...tenants.values()],
    links,
    alreadyLinked,
    warnings,
  };
}

export type MigrationResult = {
  landlords: number;
  properties: number;
  rooms: number;
  tenants: number;
  linked: number;
};

/** Write the plan: create the records, then point each pack at them. */
export function applyMigration(plan: MigrationPlan, backOffice: BackOffice, store: Store): MigrationResult {
  const landlordIds = new Map<string, string>();
  for (const landlord of plan.landlords) {
    const created = backOffice.createLandlord({
      name: landlord.name,
      address: landlord.address,
      email: landlord.email,
      phone: landlord.phone,
    });
    landlordIds.set(landlord.key, created.id);
  }

  const propertyIds = new Map<string, string>();
  for (const property of plan.properties) {
    const created = backOffice.createProperty({
      landlordId: property.landlordKey === null ? null : (landlordIds.get(property.landlordKey) ?? null),
      addressLine1: property.addressLine1,
      addressLine2: property.addressLine2,
      city: property.city,
      postcode: property.postcode,
      council: property.council,
      epcRating: property.epcRating,
      epcReference: property.epcReference,
      propertyType: property.propertyType,
      furnishedStatus: property.furnishedStatus,
    });
    propertyIds.set(property.key, created.id);
  }

  const roomIds = new Map<string, string>();
  for (const room of plan.rooms) {
    const propertyId = propertyIds.get(room.propertyKey);
    if (propertyId === undefined) continue;
    const created = backOffice.createRoom({
      propertyId,
      roomNumber: room.roomNumber,
      rentAmount: room.rentAmount,
      rentFrequency: room.rentFrequency,
      depositAmount: room.depositAmount,
      status: 'let',
    });
    roomIds.set(room.key, created.id);
  }

  const tenantIds = new Map<string, string>();
  for (const tenant of plan.tenants) {
    const created = backOffice.createTenant({
      fullName: tenant.fullName,
      email: tenant.email,
      phone: tenant.phone,
    });
    tenantIds.set(tenant.key, created.id);
  }

  let linked = 0;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  for (const link of plan.links) {
    const pack = store.findPack(link.packId);
    if (pack === null) continue;

    const start = pack.fields['tenancy.start_date'];
    const lifecycle = typeof start === 'string' && start > todayIso ? 'upcoming' : 'active';

    store.linkPack(pack.id, {
      landlordId: link.landlordKey === null ? null : (landlordIds.get(link.landlordKey) ?? null),
      propertyId: link.propertyKey === null ? null : (propertyIds.get(link.propertyKey) ?? null),
      roomId: link.roomKey === null ? null : (roomIds.get(link.roomKey) ?? null),
      tenantId: link.tenantKey === null ? null : (tenantIds.get(link.tenantKey) ?? null),
      lifecycle,
    });
    linked += 1;
  }

  return {
    landlords: plan.landlords.length,
    properties: plan.properties.length,
    rooms: plan.rooms.length,
    tenants: plan.tenants.length,
    linked,
  };
}
