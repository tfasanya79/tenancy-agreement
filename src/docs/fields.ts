/**
 * The catalogue of details a tenancy pack is built from.
 *
 * One list, used by everything: the on-screen form, the validation rules, the
 * AI agent's tool definitions and the templates' placeholders. If you need a
 * new detail in a document, add it here once.
 */

export type FieldType = 'text' | 'date' | 'money' | 'number' | 'select' | 'textarea' | 'people';

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  group: GroupId;
  help?: string;
  options?: readonly string[];
  placeholder?: string;
  /** Needed before a pack can be considered complete. */
  core?: boolean;
  /** For `people` fields, the sub-fields of each person. */
  children?: readonly Omit<FieldDef, 'group'>[];
};

export type GroupId =
  | 'agency'
  | 'landlord'
  | 'property'
  | 'tenants'
  | 'tenancy'
  | 'deposit'
  | 'inventory'
  | 'utilities'
  | 'safety'
  | 'guarantor'
  | 'document';

export type GroupDef = { id: GroupId; title: string; blurb: string };

export const GROUPS: readonly GroupDef[] = [
  { id: 'tenants', title: 'The tenant(s)', blurb: 'Everyone named on the tenancy, in the order they should appear on the contract.' },
  { id: 'property', title: 'The property', blurb: 'The address the tenancy relates to, and which room if you let room by room.' },
  { id: 'tenancy', title: 'The tenancy', blurb: 'When it starts, what the rent is and how it is paid.' },
  { id: 'deposit', title: 'Deposit', blurb: 'How much is held, and which scheme protects it.' },
  { id: 'inventory', title: 'Inventory & condition', blurb: 'The schedule of condition agreed at the start of the tenancy.' },
  { id: 'landlord', title: 'The landlord', blurb: 'The name and address that must appear on the agreement.' },
  { id: 'agency', title: 'Your agency', blurb: 'Your own details, copied onto every pack.' },
  { id: 'safety', title: 'Safety & compliance', blurb: 'Certificates and documents you must have given or checked.' },
  { id: 'utilities', title: 'Utilities', blurb: 'Who supplies what, so the tenant can set up their accounts.' },
  { id: 'guarantor', title: 'Guarantor', blurb: 'Optional. Only needed if the landlord has asked for one.' },
  { id: 'document', title: 'Reference', blurb: 'Your internal reference for this pack.' },
];

const PROPERTY_TYPES = ['Flat', 'House', 'Maisonette', 'Bungalow', 'Studio', 'Other'] as const;
const FURNISHED = ['Furnished', 'Part-furnished', 'Unfurnished'] as const;
const EPC_RATINGS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
const COUNCIL_BANDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
const RENT_FREQUENCY = ['Monthly', 'Weekly', 'Fortnightly'] as const;
const PAYMENT_METHODS = ['Standing order', 'Bank transfer', 'Direct debit', 'Other'] as const;
const DEPOSIT_SCHEMES = [
  'Deposit Protection Service (DPS)',
  'MyDeposits',
  'Tenancy Deposit Scheme (TDS)',
  'Not yet protected',
] as const;
const YES_NO_REQUEST = ['No', 'Yes', 'By written request'] as const;
const SMOKING = ['No', 'Not indoors', 'Yes'] as const;
const ID_TYPES = ['Passport', 'Driving licence', 'Residence permit', 'Other'] as const;

export const PEOPLE_FIELDS: readonly Omit<FieldDef, 'group'>[] = [
  { key: 'full_name', label: 'Full name', type: 'text', placeholder: 'As shown on their ID', core: true },
  { key: 'email', label: 'Email', type: 'text', placeholder: 'name@example.com' },
  { key: 'phone', label: 'Phone', type: 'text', placeholder: '07700 900000' },
  { key: 'dob', label: 'Date of birth', type: 'date' },
  { key: 'current_address', label: 'Current address', type: 'textarea' },
  { key: 'id_type', label: 'ID checked', type: 'select', options: ID_TYPES },
  { key: 'id_reference', label: 'ID document number', type: 'text' },
];

export const FIELDS: readonly FieldDef[] = [
  // Agency ---------------------------------------------------------------
  { key: 'agent.company_name', label: 'Agency name', type: 'text', group: 'agency' },
  { key: 'agent.name', label: 'Negotiator name', type: 'text', group: 'agency', help: 'The person dealing with this tenancy.' },
  { key: 'agent.email', label: 'Agency email', type: 'text', group: 'agency' },
  { key: 'agent.phone', label: 'Agency phone', type: 'text', group: 'agency' },
  { key: 'agent.address', label: 'Agency address', type: 'textarea', group: 'agency' },
  { key: 'agent.client_money_scheme', label: 'Client money protection scheme', type: 'text', group: 'agency', help: 'Required to be shown on agency paperwork.' },
  { key: 'agent.redress_scheme', label: 'Redress scheme', type: 'text', group: 'agency', help: 'e.g. The Property Ombudsman.' },

  // Landlord -------------------------------------------------------------
  { key: 'landlord.full_name', label: "Landlord's full name", type: 'text', group: 'landlord', core: true },
  { key: 'landlord.address', label: "Landlord's address", type: 'textarea', group: 'landlord', core: true, help: 'Must be an address in England or Wales where notices can be served.' },
  { key: 'landlord.email', label: "Landlord's email", type: 'text', group: 'landlord' },
  { key: 'landlord.phone', label: "Landlord's phone", type: 'text', group: 'landlord' },

  // Property -------------------------------------------------------------
  { key: 'property.address_line1', label: 'Address line 1', type: 'text', group: 'property', core: true, placeholder: 'e.g. 14 Beech Road' },
  { key: 'property.address_line2', label: 'Address line 2', type: 'text', group: 'property' },
  { key: 'property.room_number', label: 'Room number', type: 'text', group: 'property', placeholder: 'e.g. Room 2', help: 'Leave blank if you let the whole property rather than a room.' },
  { key: 'property.city', label: 'Town or city', type: 'text', group: 'property' },
  { key: 'property.postcode', label: 'Postcode', type: 'text', group: 'property', core: true },
  { key: 'property.property_type', label: 'Property type', type: 'select', options: PROPERTY_TYPES, group: 'property' },
  { key: 'property.bedrooms', label: 'Number of bedrooms', type: 'number', group: 'property' },
  { key: 'property.furnished_status', label: 'Furnished status', type: 'select', options: FURNISHED, group: 'property' },
  { key: 'property.garden', label: 'Outside space', type: 'text', group: 'property', placeholder: 'e.g. Rear garden — tenant maintains' },
  { key: 'property.parking', label: 'Parking', type: 'text', group: 'property', placeholder: 'e.g. One allocated space' },
  { key: 'property.epc_rating', label: 'EPC rating', type: 'select', options: EPC_RATINGS, group: 'property', help: 'You cannot let a property rated F or G unless a valid exemption applies.' },
  { key: 'property.epc_reference', label: 'EPC reference', type: 'text', group: 'property' },
  { key: 'property.council_tax_band', label: 'Council tax band', type: 'select', options: COUNCIL_BANDS, group: 'property' },
  { key: 'property.council_name', label: 'Council', type: 'text', group: 'property' },

  // Tenants --------------------------------------------------------------
  {
    key: 'tenants',
    label: 'Tenants',
    type: 'people',
    group: 'tenants',
    core: true,
    help: 'Add one entry per person named on the tenancy.',
    children: PEOPLE_FIELDS,
  },

  // Tenancy --------------------------------------------------------------
  { key: 'tenancy.start_date', label: 'Tenancy start date', type: 'date', group: 'tenancy', core: true },
  {
    key: 'tenancy.payment_date',
    label: 'First payment date',
    type: 'date',
    group: 'tenancy',
    help: 'Filled in for you as the day before the start date, then monthly. Change it if your agreement says otherwise.',
  },
  { key: 'tenancy.rent_amount', label: 'Rent', type: 'money', group: 'tenancy', core: true },
  { key: 'tenancy.rent_frequency', label: 'Rent period', type: 'select', options: RENT_FREQUENCY, group: 'tenancy' },
  { key: 'tenancy.rent_due_day', label: 'Rent due', type: 'text', group: 'tenancy', placeholder: 'e.g. 1st of each month' },
  { key: 'tenancy.payment_method', label: 'Payment method', type: 'select', options: PAYMENT_METHODS, group: 'tenancy' },
  { key: 'tenancy.payment_reference', label: 'Payment reference', type: 'text', group: 'tenancy', placeholder: 'e.g. the property postcode' },
  { key: 'tenancy.rent_in_advance', label: 'Rent taken in advance', type: 'money', group: 'tenancy', help: 'Capped at one month.' },
  { key: 'tenancy.holding_deposit_amount', label: 'Holding deposit', type: 'money', group: 'tenancy', help: 'Capped at one week’s rent.' },
  { key: 'tenancy.notice_period_tenant', label: "Tenant's notice period", type: 'text', group: 'tenancy', placeholder: '2 months' },
  { key: 'tenancy.pets_allowed', label: 'Pets', type: 'select', options: YES_NO_REQUEST, group: 'tenancy' },
  { key: 'tenancy.pet_details', label: 'Pet details', type: 'text', group: 'tenancy', placeholder: 'e.g. One cat, neutered' },
  { key: 'tenancy.smoking_allowed', label: 'Smoking', type: 'select', options: SMOKING, group: 'tenancy' },
  { key: 'tenancy.utilities_included', label: 'Bills included in the rent', type: 'text', group: 'tenancy', placeholder: 'e.g. Water only' },
  { key: 'tenancy.bills_responsibility', label: 'Other bills and responsibilities', type: 'textarea', group: 'tenancy' },
  { key: 'tenancy.break_clause', label: 'Special terms', type: 'textarea', group: 'tenancy', help: 'Anything specific to this letting. Break clauses only apply to legacy fixed-term tenancies.' },

  // Deposit --------------------------------------------------------------
  { key: 'tenancy.deposit_amount', label: 'Deposit amount', type: 'money', group: 'deposit', core: true, help: 'Capped at five weeks’ rent (six if annual rent is £50,000 or more).' },
  { key: 'tenancy.deposit_scheme', label: 'Deposit scheme', type: 'select', options: DEPOSIT_SCHEMES, group: 'deposit' },
  { key: 'tenancy.deposit_scheme_ref', label: 'Scheme reference', type: 'text', group: 'deposit' },
  { key: 'tenancy.deposit_received_date', label: 'Deposit received on', type: 'date', group: 'deposit', help: 'It must be protected within 30 days of this date.' },

  // Inventory ------------------------------------------------------------
  {
    key: 'inventory.scheduled_date',
    label: 'Schedule of condition & inventory date',
    type: 'date',
    group: 'inventory',
    help: 'The date the inventory and condition report is agreed, usually the day the tenant moves in.',
  },

  // Utilities ------------------------------------------------------------
  { key: 'utilities.gas_supplier', label: 'Gas supplier', type: 'text', group: 'utilities' },
  { key: 'utilities.electricity_supplier', label: 'Electricity supplier', type: 'text', group: 'utilities' },
  { key: 'utilities.water_supplier', label: 'Water supplier', type: 'text', group: 'utilities' },
  { key: 'utilities.broadband', label: 'Broadband / phone', type: 'text', group: 'utilities' },

  // Safety ---------------------------------------------------------------
  { key: 'safety.gas_safety_date', label: 'Gas safety check date', type: 'date', group: 'safety', help: 'Required before move-in, then every 12 months.' },
  { key: 'safety.gas_safety_engineer', label: 'Gas engineer', type: 'text', group: 'safety' },
  { key: 'safety.eicr_date', label: 'EICR date', type: 'date', group: 'safety', help: 'Electrical condition report — every 5 years.' },
  { key: 'safety.eicr_next_due', label: 'EICR next due', type: 'date', group: 'safety' },
  { key: 'safety.smoke_alarms', label: 'Smoke alarms', type: 'text', group: 'safety', placeholder: 'e.g. Hallway and landing, tested 01/05/2026' },
  { key: 'safety.co_alarms', label: 'Carbon monoxide alarms', type: 'text', group: 'safety', placeholder: 'e.g. Next to boiler' },
  { key: 'safety.how_to_rent_date', label: 'How to Rent guide given on', type: 'date', group: 'safety' },
  { key: 'safety.right_to_rent_check_date', label: 'Right to rent checked on', type: 'date', group: 'safety' },

  // Guarantor ------------------------------------------------------------
  { key: 'guarantor.full_name', label: "Guarantor's full name", type: 'text', group: 'guarantor' },
  { key: 'guarantor.address', label: "Guarantor's address", type: 'textarea', group: 'guarantor' },
  { key: 'guarantor.email', label: "Guarantor's email", type: 'text', group: 'guarantor' },
  { key: 'guarantor.phone', label: "Guarantor's phone", type: 'text', group: 'guarantor' },
  { key: 'guarantor.relationship', label: 'Relationship to tenant', type: 'text', group: 'guarantor' },

  // Document -------------------------------------------------------------
  { key: 'doc.reference', label: 'Pack reference', type: 'text', group: 'document', placeholder: 'Assigned automatically' },
  { key: 'doc.issue_date', label: 'Date of issue', type: 'date', group: 'document' },
];

const BY_KEY = new Map(FIELDS.map((field) => [field.key, field]));

export function getField(key: string): FieldDef | undefined {
  return BY_KEY.get(key);
}

export function fieldsInGroup(group: GroupId): FieldDef[] {
  return FIELDS.filter((field) => field.group === group);
}

export const CORE_FIELDS: readonly string[] = FIELDS.filter((field) => field.core === true).map((field) => field.key);

/** Fields the agency can fill in once via .env and reuse on every pack. */
export const ENV_DEFAULTS: Readonly<Record<string, string>> = {
  'agent.company_name': 'AGENCY_NAME',
  'agent.email': 'AGENCY_EMAIL',
  'agent.phone': 'AGENCY_PHONE',
  'agent.address': 'AGENCY_ADDRESS',
  'agent.client_money_scheme': 'AGENCY_CLIENT_MONEY_SCHEME',
  'agent.redress_scheme': 'AGENCY_REDRESS_SCHEME',
};

/** True when a value counts as "filled in". */
export function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function normaliseDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (text === '') return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return text;
  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (uk) {
    const [, d, m, y] = uk as unknown as [string, string, string, string];
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function normaliseMoney(value: unknown): number | '' {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  const cleaned = String(value).replace(/[£,\s]/g, '');
  if (cleaned === '') return '';
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : '';
}

/**
 * Coerce raw input (form strings, AI output) into the shapes templates expect.
 * Unknown keys are dropped so a stray model suggestion can never pollute a pack.
 */
export function normaliseFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    const def = BY_KEY.get(key);
    if (def === undefined) continue;

    if (def.type === 'people') {
      if (!Array.isArray(value)) continue;
      const people = value
        .filter((person): person is Record<string, unknown> => typeof person === 'object' && person !== null)
        .map((person) => {
          const cleaned: Record<string, unknown> = {};
          for (const child of def.children ?? []) {
            const rawChild = person[child.key];
            if (!hasValue(rawChild)) continue;
            cleaned[child.key] =
              child.type === 'date' ? normaliseDate(rawChild) : String(rawChild).trim();
          }
          return cleaned;
        })
        .filter((person) => Object.keys(person).length > 0);
      if (people.length > 0) out[key] = people;
      continue;
    }

    if (!hasValue(value)) continue;

    switch (def.type) {
      case 'money': {
        const money = normaliseMoney(value);
        if (money !== '') out[key] = money;
        break;
      }
      case 'number': {
        const numeric = Number(typeof value === 'string' ? value.replace(/[,\s]/g, '') : value);
        if (Number.isFinite(numeric)) out[key] = numeric;
        break;
      }
      case 'date':
        out[key] = normaliseDate(value);
        break;
      default:
        out[key] = typeof value === 'string' ? value.trim() : value;
    }
  }

  return out;
}

/** The ISO date one day before `startIso` — the default first payment date. */
export function paymentDateFor(startIso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startIso.trim());
  if (match === null) return '';
  const [, y, m, d] = match as unknown as [string, string, string, string];
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() - 1); // calendar-safe across BST/GMT changes
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Fill in values that follow from others.
 *
 * The first rent payment is the day before the tenancy starts, then monthly. That
 * is derived rather than asked for, but it stays editable: a caller that supplies
 * a payment date explicitly always wins.
 */
function applyDerived(merged: Record<string, unknown>, supplied: Record<string, unknown>): void {
  if (hasValue(supplied['tenancy.payment_date'])) return;
  const start = merged['tenancy.start_date'];
  if (typeof start !== 'string' || start === '') return;
  const derived = paymentDateFor(start);
  if (derived !== '') merged['tenancy.payment_date'] = derived;
}

export type MergeResult = {
  merged: Record<string, unknown>;
  /** Keys that were actually written this time. */
  written: string[];
  /** Keys the caller supplied that are not in the catalogue. */
  unknown: string[];
};

/**
 * Merge newly supplied values into an existing pack.
 * Empty values never overwrite good ones, and lists (tenants) replace wholesale.
 */
export function mergeFields(previous: Record<string, unknown>, incomingRaw: Record<string, unknown>): MergeResult {
  const normalised = normaliseFields(incomingRaw);
  const merged: Record<string, unknown> = { ...previous, ...normalised };

  for (const field of FIELDS) {
    if (field.type !== 'people') continue;
    if (hasValue(normalised[field.key])) merged[field.key] = normalised[field.key];
    else if (hasValue(previous[field.key])) merged[field.key] = previous[field.key];
    else delete merged[field.key];
  }

  const known = new Set(FIELDS.map((field) => field.key));
  applyDerived(merged, normalised);

  return {
    merged,
    written: Object.keys(normalised),
    unknown: Object.keys(incomingRaw).filter((key) => !known.has(key)),
  };
}

/** Which catalogue keys are still empty. */
export function missingCoreFields(fields: Record<string, unknown>): string[] {
  return CORE_FIELDS.filter((key) => {
    const value = fields[key];
    if (key === 'tenants') {
      return !Array.isArray(value) || !value.some((person) => hasValue((person as Record<string, unknown>).full_name));
    }
    return !hasValue(value);
  });
}

export function labelFor(key: string): string {
  const def = BY_KEY.get(key);
  if (def !== undefined) return def.label;
  return key.split('.').at(-1)?.replace(/_/g, ' ') ?? key;
}
