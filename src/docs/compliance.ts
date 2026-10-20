/**
 * Deterministic compliance checks.
 *
 * These are plain arithmetic and date comparisons, not AI guesses. The agent
 * runs them, and the web page shows the same results, so what you see in the
 * browser is exactly what the assistant was told.
 */

import { CORE_FIELDS, hasValue, labelFor } from './fields.ts';
import { parseDate } from './template.ts';

export type Severity = 'error' | 'warning' | 'info';

export type Finding = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  fields?: string[];
  /** Matching entry in the rules knowledge base, if there is one. */
  ruleId?: string;
};

export type Deadline = {
  id: string;
  label: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  detail: string;
};

export type ComplianceReport = {
  findings: Finding[];
  deadlines: Deadline[];
  counts: { error: number; warning: number; info: number };
  /** True when nothing is outstanding. */
  ok: boolean;
};

const DAY_MS = 86_400_000;

function asNumber(fields: Record<string, unknown>, key: string): number | null {
  const value = fields[key];
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[£,\s]/g, '');
    if (cleaned === '') return null;
    const numeric = Number(cleaned);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function asDate(fields: Record<string, unknown>, key: string): Date | null {
  return parseDate(fields[key]);
}

function asText(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  return typeof value === 'string' ? value.trim() : '';
}

function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/*
 * Date arithmetic is done on the calendar, not by adding milliseconds.
 * Adding 30 × 86,400,000 ms to a date in British Summer Time lands an hour
 * early and can shift the answer to the previous day.
 */
function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function addYears(date: Date, years: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setFullYear(next.getFullYear() + years);
  return next;
}

function daysBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / DAY_MS);
}

function money(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(amount);
}

/**
 * Does this look like a UK postcode?
 *
 * Deliberately a shape test, not a validity test: it catches a Swedish
 * `422 41` or a US `90210`, which is what matters here. `GIR 0AA` is the one
 * genuine exception to the pattern.
 */
export function isUkPostcode(value: string): boolean {
  const cleaned = value.toUpperCase().replace(/\s+/g, ' ').trim();
  if (cleaned === 'GIR 0AA') return true;
  return /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/.test(cleaned);
}

/** Rent expressed as a weekly figure, whatever period it is quoted in. */
export function weeklyRent(fields: Record<string, unknown>): number | null {
  const rent = asNumber(fields, 'tenancy.rent_amount');
  if (rent === null || rent <= 0) return null;
  const frequency = asText(fields, 'tenancy.rent_frequency').toLowerCase();
  if (frequency.startsWith('week')) return rent;
  if (frequency.startsWith('fortnight')) return rent / 2;
  return (rent * 12) / 52;
}

export function depositCap(fields: Record<string, unknown>): number | null {
  const weekly = weeklyRent(fields);
  if (weekly === null) return null;
  const annual = weekly * 52;
  return (annual >= 50_000 ? 6 : 5) * weekly;
}

/**
 * Run every check against a set of fields.
 * @param fields  the pack's field values
 * @param options.documentIds the documents about to be generated (unused today,
 *        kept so per-document checks can be added without changing callers)
 */
export function runComplianceChecks(
  fields: Record<string, unknown>,
  options: { today?: Date } = {},
): ComplianceReport {
  const findings: Finding[] = [];
  const deadlines: Deadline[] = [];
  const today = options.today ?? new Date();

  const add = (finding: Finding) => findings.push(finding);

  // --- Missing essentials --------------------------------------------------
  for (const key of CORE_FIELDS) {
    if (key === 'tenants') {
      const tenants = fields['tenants'];
      const named = Array.isArray(tenants)
        ? tenants.some((person) => hasValue((person as Record<string, unknown>)['full_name']))
        : false;
      if (!named) {
        add({
          id: 'missing-tenants',
          severity: 'error',
          title: 'No tenant named',
          detail: 'The agreement needs at least one named tenant.',
          fields: ['tenants'],
        });
      }
      continue;
    }
    if (!hasValue(fields[key])) {
      add({
        id: `missing-${key}`,
        severity: 'error',
        title: `Missing: ${labelFor(key)}`,
        detail: `“${labelFor(key)}” has not been entered. It is needed on the tenancy agreement.`,
        fields: [key],
      });
    }
  }

  const start = asDate(fields, 'tenancy.start_date');

  // --- Deposit -------------------------------------------------------------
  const deposit = asNumber(fields, 'tenancy.deposit_amount');
  const cap = depositCap(fields);
  if (deposit !== null && cap !== null && deposit > cap + 1) {
    add({
      id: 'deposit-over-cap',
      severity: 'warning',
      title: 'Deposit is above the legal cap',
      detail: `The deposit of ${money(deposit)} is more than the maximum of ${money(cap)}. The cap is five weeks’ rent, or six weeks where the annual rent is £50,000 or more. Reduce the deposit, or treat the excess as a permitted payment.`,
      fields: ['tenancy.deposit_amount'],
      ruleId: 'deposit-cap',
    });
  }

  const holding = asNumber(fields, 'tenancy.holding_deposit_amount');
  const weekly = weeklyRent(fields);
  if (holding !== null && weekly !== null && holding > weekly + 1) {
    add({
      id: 'holding-over-cap',
      severity: 'warning',
      title: 'Holding deposit is above one week’s rent',
      detail: `Holdings are capped at one week’s rent (${money(weekly)}). You have entered ${money(holding)}.`,
      fields: ['tenancy.holding_deposit_amount'],
      ruleId: 'deposit-cap',
    });
  }

  const inAdvance = asNumber(fields, 'tenancy.rent_in_advance');
  const rent = asNumber(fields, 'tenancy.rent_amount');
  const period = asText(fields, 'tenancy.rent_frequency').toLowerCase();
  if (inAdvance !== null && rent !== null && period.startsWith('month') && inAdvance > rent + 1) {
    add({
      id: 'advance-over-cap',
      severity: 'warning',
      title: 'Too much rent taken in advance',
      detail: `No more than one month’s rent may be taken in advance. You have entered ${money(inAdvance)} against a monthly rent of ${money(rent)}.`,
      fields: ['tenancy.rent_in_advance'],
      ruleId: 'rent-in-advance',
    });
  }

  const received = asDate(fields, 'tenancy.deposit_received_date') ?? start;
  if (received !== null) {
    const protectBy = addDays(received, 30);
    deadlines.push({
      id: 'deposit-protection',
      label: 'Protect the deposit and serve the prescribed information',
      date: toIso(protectBy),
      detail: `Thirty days from ${toIso(received)}.`,
    });
    const scheme = asText(fields, 'tenancy.deposit_scheme');
    if (scheme === 'Not yet protected' || scheme === '') {
      add({
        id: 'deposit-not-protected',
        severity: protectBy < today ? 'error' : 'warning',
        title: 'Deposit not yet protected',
        detail:
          protectBy < today
            ? `The 30-day deadline passed on ${toIso(protectBy)}. Protect it and serve the prescribed information now.`
            : `Protect the deposit in a scheme and serve the prescribed information by ${toIso(protectBy)}.`,
        fields: ['tenancy.deposit_scheme'],
        ruleId: 'deposit-protection',
      });
    } else if (!hasValue(fields['tenancy.deposit_scheme_ref'])) {
      add({
        id: 'deposit-no-ref',
        severity: 'warning',
        title: 'No deposit scheme reference recorded',
        detail: 'Add the scheme’s certificate reference so the prescribed information is complete.',
        fields: ['tenancy.deposit_scheme_ref'],
      });
    }
  }

  // --- Dates ---------------------------------------------------------------
  if (start !== null) {
    if (daysBetween(start, today) > 30) {
      add({
        id: 'start-in-past',
        severity: 'warning',
        title: 'Tenancy start date is in the past',
        detail: `The start date is ${toIso(start)}. Check you are producing the right document — for an existing tenancy this is a written statement, not a new agreement.`,
        fields: ['tenancy.start_date'],
      });
    }
    deadlines.push({
      id: 'written-statement',
      label: 'Give the tenant the written statement of terms',
      date: toIso(addDays(start, 28)),
      detail: `Twenty-eight days from the start of the tenancy on ${toIso(start)}.`,
    });
  }

  // --- Safety and compliance documents ------------------------------------
  const gasDate = asDate(fields, 'safety.gas_safety_date');
  if (start !== null) {
    if (gasDate === null) {
      add({
        id: 'gas-safety-missing',
        severity: 'info',
        title: 'No gas safety certificate recorded',
        detail: 'A gas safety check is normally done before the tenant moves in, and the record given to them.',
        fields: ['safety.gas_safety_date'],
        ruleId: 'gas-safety',
      });
    } else {
      if (addYears(gasDate, 1) < start) {
        add({
          id: 'gas-safety-expired',
          severity: 'info',
          title: 'Gas safety certificate will be out of date',
          detail: `The recorded check (${toIso(gasDate)}) is more than 12 months before the tenancy starts. Get a new check.`,
          fields: ['safety.gas_safety_date'],
          ruleId: 'gas-safety',
        });
      } else if (gasDate > start) {
        add({
          id: 'gas-safety-after-start',
          severity: 'info',
          title: 'Gas safety check is dated after the tenancy starts',
          detail: 'The tenant normally has the certificate before they move in. Worth checking the dates.',
          fields: ['safety.gas_safety_date'],
          ruleId: 'gas-safety',
        });
      }
      deadlines.push({
        id: 'gas-safety-renewal',
        label: 'Next gas safety check due',
        date: toIso(addYears(gasDate, 1)),
        detail: 'Annual gas safety check.',
      });
    }
  }

  const eicr = asDate(fields, 'safety.eicr_date');
  if (eicr === null) {
    add({
      id: 'eicr-missing',
      severity: 'info',
      title: 'No EICR recorded',
      detail: 'An electrical installation condition report is required at least every five years.',
      fields: ['safety.eicr_date'],
      ruleId: 'eicr',
    });
  } else {
    const expiry = addYears(eicr, 5);
    if (expiry < today) {
      add({
        id: 'eicr-expired',
        severity: 'info',
        title: 'EICR has expired',
        detail: `The report dated ${toIso(eicr)} is more than five years old. Get a new inspection.`,
        fields: ['safety.eicr_date'],
        ruleId: 'eicr',
      });
    }
    deadlines.push({
      id: 'eicr-renewal',
      label: 'Next EICR due',
      date: toIso(expiry),
      detail: 'Electrical installation condition report is valid for five years.',
    });
  }

  // England only. The assured periodic tenancy regime comes from the Renters'
  // Rights Act 2025, which applies in England; Wales has its own framework, and
  // Scotland and Northern Ireland theirs. A non-UK postcode here means the whole
  // document is the wrong instrument, so this blocks generation.
  const postcode = asText(fields, 'property.postcode');
  if (postcode !== '' && !isUkPostcode(postcode)) {
    add({
      id: 'postcode-not-uk',
      severity: 'error',
      title: 'The property postcode is not a UK postcode',
      detail: `“${postcode}” is not in the format of a UK postcode. These templates are English assured periodic tenancies and do not apply outside England — a property in Wales, Scotland, Northern Ireland or abroad needs different documents.`,
      fields: ['property.postcode'],
      ruleId: 'england-only',
    });
  }

  const epc = asText(fields, 'property.epc_rating').toUpperCase();
  if (epc === '') {
    add({
      id: 'epc-missing',
      severity: 'info',
      title: 'No EPC rating recorded',
      detail: 'A valid EPC is needed, and a copy is normally given to the tenant before they move in.',
      fields: ['property.epc_rating'],
      ruleId: 'epc',
    });
  } else if (epc === 'F' || epc === 'G') {
    add({
      id: 'epc-below-e',
      severity: 'warning',
      title: `EPC band ${epc} cannot be let`,
      detail: 'Properties rated F or G may not be let unless a valid exemption is registered.',
      fields: ['property.epc_rating'],
      ruleId: 'epc',
    });
  }

  if (!hasValue(fields['safety.right_to_rent_check_date'])) {
    add({
      id: 'right-to-rent-missing',
      severity: 'info',
      title: 'Right to rent check not recorded',
      detail: 'Check every adult tenant’s right to rent before the tenancy starts and keep the evidence.',
      fields: ['safety.right_to_rent_check_date'],
      ruleId: 'right-to-rent',
    });
  }

  if (!hasValue(fields['safety.how_to_rent_date'])) {
    add({
      id: 'how-to-rent-missing',
      severity: 'info',
      title: 'How to Rent guide not recorded as given',
      detail: 'Give the tenant the current How to Rent guide at the start of the tenancy.',
      fields: ['safety.how_to_rent_date'],
      ruleId: 'how-to-rent',
    });
  }

  if (!hasValue(fields['safety.smoke_alarms'])) {
    add({
      id: 'alarms-missing',
      severity: 'info',
      title: 'Alarm test not recorded',
      detail: 'Smoke alarms on every storey, and carbon monoxide alarms where needed, are normally tested on the day the tenancy starts.',
      fields: ['safety.smoke_alarms'],
      ruleId: 'alarms',
    });
  }

  // --- Agency disclosure ---------------------------------------------------
  if (!hasValue(fields['agent.client_money_scheme']) || !hasValue(fields['agent.redress_scheme'])) {
    add({
      id: 'agency-schemes',
      severity: 'warning',
      title: 'Client money protection or redress scheme missing',
      detail: 'Your agency’s scheme membership normally appears on the paperwork. Set these once in your settings.',
      fields: ['agent.client_money_scheme', 'agent.redress_scheme'],
      ruleId: 'client-money',
    });
  }

  // A field can be filled in and still be wrong. A currency amount or a stray
  // number in a "scheme name" box would print on every agreement.
  const looksLikeName = (value: string) => /[a-z]{3,}/i.test(value) && !/^[£$€]?\s*\d+([.,]\d+)?$/.test(value.trim());

  const cmp = asText(fields, 'agent.client_money_scheme');
  if (cmp !== '' && !looksLikeName(cmp)) {
    add({
      id: 'agency-cmp-suspect',
      severity: 'warning',
      title: 'Client money protection does not look like a scheme name',
      detail: `It currently reads “${cmp}”. This appears on every agreement you produce, so enter the scheme’s name — for example “Propertymark Client Money Protection” or “UKALA Client Money Protection”.`,
      fields: ['agent.client_money_scheme'],
      ruleId: 'client-money',
    });
  }

  const redress = asText(fields, 'agent.redress_scheme');
  if (redress !== '' && !looksLikeName(redress)) {
    add({
      id: 'agency-redress-suspect',
      severity: 'warning',
      title: 'Redress scheme does not look like a scheme name',
      detail: `It currently reads “${redress}”. Enter the scheme’s name — for example “The Property Ombudsman” or “Property Redress Scheme”.`,
      fields: ['agent.redress_scheme'],
      ruleId: 'client-money',
    });
  }

  // --- Wording checks ------------------------------------------------------
  const notice = asText(fields, 'tenancy.notice_period_tenant');
  if (notice !== '' && !/\b2\b|two/i.test(notice)) {
    add({
      id: 'notice-period',
      severity: 'warning',
      title: 'Notice period looks wrong',
      detail: `A tenant can end an assured periodic tenancy with two months’ notice. You have written “${notice}”.`,
      fields: ['tenancy.notice_period_tenant'],
      ruleId: 'tenant-notice',
    });
  }

  if (asText(fields, 'tenancy.pets_allowed').toLowerCase() === 'yes' && !hasValue(fields['tenancy.pet_details'])) {
    add({
      id: 'pets-detail',
      severity: 'info',
      title: 'Pets are allowed but not described',
      detail: 'Describe the pet and any conditions so the agreement is unambiguous.',
      fields: ['tenancy.pet_details'],
      ruleId: 'pets',
    });
  }

  if (asText(fields, 'tenancy.rent_frequency') === '') {
    add({
      id: 'rent-frequency',
      severity: 'info',
      title: 'Rent period not set',
      detail: 'State whether the rent is monthly, weekly or fortnightly — it is a required term of the tenancy.',
      fields: ['tenancy.rent_frequency'],
    });
  }

  const counts = {
    error: findings.filter((f) => f.severity === 'error').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };

  deadlines.sort((a, b) => a.date.localeCompare(b.date));

  return { findings, deadlines, counts, ok: counts.error === 0 };
}
