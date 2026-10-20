/**
 * Working out what a tenancy's details actually are.
 *
 * A detail is looked up in layers, and the first layer that has a value wins:
 *
 *   agency  →  landlord  →  property  →  room  →  the tenancy itself
 *
 * A tenancy stores only what is *different* from what it inherits, so the form is
 * short and the same address is never typed twice. The resolver returns both the
 * merged values and where each one came from, because an inherited value that
 * cannot be traced is an inherited error nobody notices.
 */

import { paymentDateFor, missingCoreFields } from '../docs/fields.ts';
import type { AgencySettings, Landlord, PropertyRecord, RoomRecord, TenantRecord } from './entities.ts';

export type FieldSource = 'tenancy' | 'room' | 'property' | 'landlord' | 'agency' | 'derived';

export type ResolvedFields = {
  /** Everything a document might need, merged. */
  values: Record<string, unknown>;
  /** Where each value came from, so the form can say "from Room 2". */
  provenance: Record<string, FieldSource>;
  /** Keys the tenancy sets itself — everything else is inherited. */
  overrides: string[];
  /** Essential details still empty after inheritance. */
  missing: string[];
};

export type InheritanceInput = {
  tenancy: Record<string, unknown>;
  agency: AgencySettings;
  landlord?: Landlord | null;
  property?: PropertyRecord | null;
  room?: RoomRecord | null;
  /** The person linked to this tenancy, if one is. */
  tenant?: TenantRecord | null;
};

type Getter = (input: InheritanceInput) => unknown;

const isSet = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

/** agency → agent.* */
const FROM_AGENCY: Record<string, Getter> = {
  'agent.company_name': ({ agency }) => agency.name,
  'agent.address': ({ agency }) => agency.address,
  'agent.phone': ({ agency }) => agency.phone,
  'agent.email': ({ agency }) => agency.email,
  'agent.client_money_scheme': ({ agency }) => agency.clientMoneyScheme,
  'agent.redress_scheme': ({ agency }) => agency.redressScheme,
  'agent.name': ({ agency }) => agency.negotiator,
};

/** landlord → landlord.* */
const FROM_LANDLORD: Record<string, Getter> = {
  'landlord.full_name': ({ landlord }) => landlord?.name,
  'landlord.address': ({ landlord }) => landlord?.address,
  'landlord.email': ({ landlord }) => landlord?.email,
  'landlord.phone': ({ landlord }) => landlord?.phone,
};

/** property → property.* */
const FROM_PROPERTY: Record<string, Getter> = {
  'property.address_line1': ({ property }) => property?.addressLine1,
  'property.address_line2': ({ property }) => property?.addressLine2,
  'property.city': ({ property }) => property?.city,
  'property.postcode': ({ property }) => property?.postcode,
  'property.council_name': ({ property }) => property?.council,
  'property.epc_rating': ({ property }) => property?.epcRating,
  'property.epc_reference': ({ property }) => property?.epcReference,
  'property.property_type': ({ property }) => property?.propertyType,
  'property.furnished_status': ({ property }) => property?.furnishedStatus,
};

/** room → the details that change per room rather than per property. */
const FROM_ROOM: Record<string, Getter> = {
  'property.room_number': ({ room }) => room?.roomNumber,
  'tenancy.rent_amount': ({ room }) => room?.rentAmount,
  'tenancy.rent_frequency': ({ room }) => room?.rentFrequency,
  'tenancy.deposit_amount': ({ room }) => room?.depositAmount,
};

const LAYERS: ReadonlyArray<[FieldSource, Record<string, Getter>]> = [
  ['agency', FROM_AGENCY],
  ['landlord', FROM_LANDLORD],
  ['property', FROM_PROPERTY],
  ['room', FROM_ROOM],
];

/**
 * Merge the layers, then let the tenancy override anything it sets.
 * Empty strings never overwrite an inherited value — clearing a field means
 * "go back to inherited", which is what the form's undo does.
 */
export function resolveFields(input: InheritanceInput): ResolvedFields {
  const values: Record<string, unknown> = {};
  const provenance: Record<string, FieldSource> = {};

  for (const [source, map] of LAYERS) {
    for (const [key, read] of Object.entries(map)) {
      const value = read(input);
      if (!isSet(value)) continue;
      values[key] = value;
      provenance[key] = source;
    }
  }

  // The tenant record, when one is linked and the tenancy has not said otherwise.
  if (!isSet(values['tenants']) && isSet(input.tenant?.fullName)) {
    const person: Record<string, unknown> = { full_name: input.tenant?.fullName ?? '' };
    if (isSet(input.tenant?.email)) person['email'] = input.tenant?.email;
    if (isSet(input.tenant?.phone)) person['phone'] = input.tenant?.phone;
    if (isSet(input.tenant?.dob)) person['dob'] = input.tenant?.dob;
    if (isSet(input.tenant?.currentAddress)) person['current_address'] = input.tenant?.currentAddress;
    if (isSet(input.tenant?.idType)) person['id_type'] = input.tenant?.idType;
    if (isSet(input.tenant?.idReference)) person['id_reference'] = input.tenant?.idReference;
    values['tenants'] = [person];
    provenance['tenants'] = 'tenancy';
  }

  // Whatever the tenancy sets explicitly wins.
  const overrides: string[] = [];
  for (const [key, value] of Object.entries(input.tenancy)) {
    if (!isSet(value)) continue;
    values[key] = value;
    provenance[key] = 'tenancy';
    overrides.push(key);
  }

  // Values that follow from others rather than being entered. A stored payment
  // date that matches what we would derive is reported as derived, so the form
  // does not pretend the agent typed it.
  const startDate = values['tenancy.start_date'];
  if (typeof startDate === 'string' && startDate !== '') {
    const derived = paymentDateFor(startDate);
    if (derived !== '') {
      if (!isSet(values['tenancy.payment_date'])) {
        values['tenancy.payment_date'] = derived;
        provenance['tenancy.payment_date'] = 'derived';
      } else if (values['tenancy.payment_date'] === derived) {
        provenance['tenancy.payment_date'] = 'derived';
      }
    }
  }

  return {
    values,
    provenance,
    // A value we would have derived anyway is not an override the agent chose.
    overrides: overrides.filter((key) => provenance[key] === 'tenancy'),
    missing: missingCoreFields(values),
  };
}

/** Human wording for a provenance badge. */
export function describeSource(source: FieldSource): string {
  switch (source) {
    case 'tenancy': return 'this tenancy';
    case 'room': return 'the room';
    case 'property': return 'the property';
    case 'landlord': return 'the landlord';
    case 'agency': return 'your agency';
    case 'derived': return 'worked out';
  }
}
