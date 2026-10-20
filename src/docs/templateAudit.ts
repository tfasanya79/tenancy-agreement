/**
 * Auditing an uploaded document.
 *
 * When an agency supplies its own agreement, the most valuable thing we can do
 * before automating it is tell them where it disagrees with the current law.
 * Plenty of "our standard form" documents in circulation are hybrids: a heading
 * updated after May 2026, with operative clauses still describing section 21 and
 * fixed terms.
 *
 * This is pattern matching over text — no model involved — so the answer is the
 * same every time and can be explained line by line.
 */

export type AuditSeverity = 'error' | 'warning' | 'info';

import { ordinal } from './template.ts';
export type AuditFinding = {
  id: string;
  severity: AuditSeverity;
  title: string;
  detail: string;
  /** The offending text, trimmed for display. */
  excerpt?: string;
  /** Matching entry in the rules knowledge base. */
  ruleId?: string;
};

export type AuditReport = {
  findings: AuditFinding[];
  counts: { error: number; warning: number; info: number };
  /** False when something must be fixed before the document is used. */
  ok: boolean;
  wordCount: number;
};

type Pattern = {
  id: string;
  severity: AuditSeverity;
  title: string;
  detail: string;
  ruleId?: string;
  test: RegExp;
};

const PATTERNS: readonly Pattern[] = [
  {
    id: 'assured-shorthold',
    severity: 'error',
    title: 'Describes the tenancy as an assured shorthold tenancy',
    detail:
      'Assured shorthold tenancies are the pre-May-2026 model. New tenancies in England are assured periodic tenancies, with no fixed end date. A document that still calls itself an AST contradicts itself the moment it is signed.',
    ruleId: 'tenancy-type',
    test: /\bassured\s+shorthold\b/i,
  },
  {
    id: 'section-21',
    severity: 'error',
    title: 'Refers to section 21 of the Housing Act 1988',
    detail:
      'Section 21 was abolished for tenancies in England on 1 May 2026. Any clause relying on it does nothing. Possession is now section 8 only, through the court.',
    ruleId: 'section-21',
    test: /\bsection\s*21\b/i,
  },
  {
    id: 'section-19a',
    severity: 'warning',
    title: 'Refers to section 19A of the Housing Act 1988',
    detail: 'Section 19A is the definition of an assured shorthold tenancy. It was the basis of the old regime.',
    ruleId: 'tenancy-type',
    test: /\bsection\s*19a\b/i,
  },
  {
    id: 'fixed-term',
    severity: 'error',
    title: 'Creates a fixed term',
    detail:
      'Fixed-term tenancies are gone for new lettings in England. An agreement should be periodic and say so, with no end date and no fixed "term of X months".',
    ruleId: 'tenancy-type',
    test: /\bfixed[\s-]*term\b|\bfor\s+a\s+term\s+of\b|\bterm\s+of\s+(?:\d+|one|two|three|six|twelve)\s+(?:months?|years?)\b/i,
  },
  {
    id: 'rent-increase-vague',
    severity: 'warning',
    title: 'Rent review is described vaguely',
    detail:
      'Under section 13, rent may be increased at most once a year and only by serving the prescribed notice at least two months ahead. "A reasonable percentage" or "by agreement" is not the statutory procedure.',
    ruleId: 'rent-increase',
    test: /\breasonable\s+(?:percentage|increase|amount)\b|\bin\s+line\s+with\s+(?:the\s+)?market\b|\brent\s+(?:to|shall)\s+be\s+(?:reviewed|increased)\s+by\s+agreement\b/i,
  },
  {
    id: 'section-13',
    severity: 'info',
    title: 'Refers to section 13',
    detail:
      'Section 13 still applies, but the procedure changed: once a year, prescribed form, two months’ notice, and the tenant may challenge the amount at the tribunal.',
    ruleId: 'rent-increase',
    test: /\bsection\s*13\b/i,
  },
  {
    id: 'notice-period',
    severity: 'warning',
    title: 'Tenant notice period may be wrong',
    detail:
      'A tenant of an assured periodic tenancy may end it with two months’ written notice. Check that the notice clause says two months rather than one.',
    ruleId: 'tenant-notice',
    test: /\b(?:one|1)\s+month['’]?s?['’]?\s+(?:written\s+)?notice\b/i,
  },
  {
    id: 'no-pets-clause',
    severity: 'warning',
    title: 'No pets provision',
    detail:
      'Tenants have a right to request a pet, and the landlord must respond in writing within 28 days with a valid reason if refusing. A document with no pets provision leaves the procedure undefined.',
    ruleId: 'pets',
    test: /\bpets?\b/i,
    // Absence check — handled separately.
  },
];

/** Phrases that suggest a document is an agreement rather than, say, a checklist. */
const AGREEMENT_HINTS = /\btenancy\s+agreement\b|\bassured\s+(?:periodic|shorthold)\b/i;

/** Documents that legitimately never mention pets or the deposit deadline. */
const NOT_AN_AGREEMENT = /\b(?:prescribed\s+information|inventory|check[\s-]*in|guarantee|guarantor|deed|checklist|notice|welcome|certificate|receipt)\b/i;

/**
 * Decide from the *opening* of the document, not its body — a deposit form
 * mentions the tenancy agreement constantly, but it is not one.
 */
function looksLikeTenancyAgreement(text: string): boolean {
  const head = text.slice(0, 700);
  if (NOT_AN_AGREEMENT.test(head)) return false;
  return AGREEMENT_HINTS.test(head);
}

/**
 * A correct document often *mentions* section 21 in order to say it no longer
 * applies ("since 1 May 2026 section 21 is abolished"). Flagging that would be a
 * false alarm, so a match is ignored when it sits near a negation.
 */
const NEGATIONS =
  /\b(?:abolish(?:ed|es)?|no\s+longer|no\s+more\s+than|no\s+fixed|not\s+(?:be\s+)?(?:used|served|available|apply|applicable|exist)|cannot|can\s+not|may\s+not|must\s+not|never|ceased|gone|ended|replaced|removed|legacy|pre[\s-]*may|no\s+section|without)\b/i;

function isNegated(text: string, index: number, length: number): boolean {
  const start = Math.max(0, index - 110);
  const end = Math.min(text.length, index + length + 110);
  if (NEGATIONS.test(text.slice(start, end))) return true;

  // "This creates no fixed term" — a determiner immediately before the phrase.
  const immediate = text.slice(Math.max(0, index - 45), index);
  return /\b(?:no|not|never|without)\b[^.;]{0,25}$/i.test(immediate);
}

function excerptAround(text: string, matchIndex: number, matchLength: number, radius = 60): string {
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + matchLength + radius);
  const fragment = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${fragment}${end < text.length ? '…' : ''}`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const WEEKDAY_DATE =
  /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/g;

/** "Wednesday 5th September 2026" — 5 September 2026 was a Saturday. */
function checkWeekdays(text: string): AuditFinding[] {
  const mismatches: string[] = [];

  for (const match of text.matchAll(WEEKDAY_DATE)) {
    const named = match[1] ?? '';
    const day = Number(match[2]);
    const monthIndex = MONTH_NAMES.indexOf((match[3] ?? '') as (typeof MONTH_NAMES)[number]);
    const year = Number(match[4]);
    if (monthIndex === -1 || !Number.isFinite(day) || !Number.isFinite(year)) continue;

    const date = new Date(year, monthIndex, day);
    if (Number.isNaN(date.getTime())) continue;
    const actual = date.toLocaleDateString('en-GB', { weekday: 'long' });
    if (actual !== named) mismatches.push(`“${match[0]}” — that date is a ${actual}`);
  }

  if (mismatches.length === 0) return [];
  return [
    {
      id: 'weekday-mismatch',
      severity: 'error',
      title: 'A weekday does not match its date',
      detail: `${mismatches.slice(0, 3).join('; ')}. A date that disagrees with its own weekday is exactly the detail a tenant or their adviser will pick up.`,
      excerpt: mismatches[0],
    },
  ];
}

/** One document should not say rent is due on the 1st in one clause and the 4th in another. */
function checkRentDueDays(text: string): AuditFinding[] {
  const days = new Set<number>();
  const samples: string[] = [];

  for (const match of text.matchAll(/\bon the (\d{1,2})(?:st|nd|rd|th)/gi)) {
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 160), Math.min(text.length, index + 90));
    if (!/\brent\b/i.test(context)) continue;
    // Skip worked examples such as "if rent is due on the 10th…".
    if (/\bif\b/i.test(text.slice(Math.max(0, index - 70), index))) continue;

    const day = Number(match[1]);
    if (!Number.isFinite(day) || day < 1 || day > 31) continue;
    if (!days.has(day)) samples.push(match[0]);
    days.add(day);
  }

  if (days.size < 2) return [];
  const listed = [...days].sort((a, b) => a - b).map((day) => ordinal(day)).join(', ');
  return [
    {
      id: 'rent-due-inconsistent',
      severity: 'warning',
      title: 'The document gives more than one rent due date',
      detail: `It refers to rent being due on the ${listed}. Decide which one applies and make every clause agree — this is the single most common cause of a late-payment dispute.`,
      excerpt: samples.slice(0, 3).join(' / '),
      ruleId: 'prohibited-payments',
    },
  ];
}

/** A flat "admin fee" for late rent is a prohibited payment. */
function checkProhibitedFees(text: string): AuditFinding[] {
  const match = /£\s?\d+(?:\.\d{2})?\s*(?:admin(?:istration)?|late\s*payment|late)\s*(?:fee|charge)/i.exec(text);
  if (match === null) return [];
  return [
    {
      id: 'prohibited-fee',
      severity: 'error',
      title: 'A fixed late-payment fee is probably a prohibited payment',
      detail:
        'Under the Tenant Fees Act 2019 a charge for late rent is limited to interest at 3% above the Bank of England base rate, and only once the rent is 14 days overdue. A flat fee of this kind must normally be repaid, and a council can fine for it. Replace it with the statutory interest calculation, or remove it.',
      excerpt: excerptAround(text, match.index, match[0].length),
      ruleId: 'prohibited-payments',
    },
  ];
}

/** "the 1stth of each month" */
function checkOrdinalTypos(text: string): AuditFinding[] {
  const match = /\b\d{1,2}(?:st|nd|rd|th)(?:st|nd|rd|th)\b/i.exec(text);
  if (match === null) return [];
  const suggested = match[0].replace(/(?:st|nd|rd|th)(?:st|nd|rd|th)$/i, (suffix) => suffix.slice(0, 2));
  return [
    {
      id: 'ordinal-typo',
      severity: 'info',
      title: 'A date ordinal looks mistyped',
      detail: `“${match[0]}” is probably meant to be “${suggested}”. A small typo in a signed document undermines trust in all of it.`,
      excerpt: excerptAround(text, match.index, match[0].length),
    },
  ];
}

/**
 * Audit a document's text.
 * @param text plain text of the uploaded document
 */
export function auditDocumentText(text: string): AuditReport {
  const findings: AuditFinding[] = [];
  const normalised = text.replace(/\s+/g, ' ').trim();
  const wordCount = normalised === '' ? 0 : normalised.split(' ').filter(Boolean).length;

  if (normalised === '') {
    return {
      findings: [
        {
          id: 'no-text',
          severity: 'error',
          title: 'No text could be read from this document',
          detail:
            'It may be a scan (a picture of a document) rather than real text. TenancyDesk needs a Word file with selectable text. If you only have a scanned copy, retype or re-export it first.',
        },
      ],
      counts: { error: 1, warning: 0, info: 0 },
      ok: false,
      wordCount: 0,
    };
  }

  for (const pattern of PATTERNS) {
    if (pattern.id === 'no-pets-clause') continue;
    const flags = pattern.test.flags.includes('g') ? pattern.test.flags : `${pattern.test.flags}g`;
    const regex = new RegExp(pattern.test.source, flags);
    let match = regex.exec(normalised);
    // Keep looking past negated mentions rather than stopping at the first one.
    while (match !== null && isNegated(normalised, match.index, match[0].length)) {
      match = regex.exec(normalised);
    }
    if (match === null) continue;
    findings.push({
      id: pattern.id,
      severity: pattern.severity,
      title: pattern.title,
      detail: pattern.detail,
      excerpt: excerptAround(normalised, match.index, match[0].length),
      ...(pattern.ruleId === undefined ? {} : { ruleId: pattern.ruleId }),
    });
  }

  // --- Internal consistency ------------------------------------------------
  // These are the mistakes that survive every review: a weekday that does not
  // match its date, or two different rent due days in the same document.
  findings.push(...checkWeekdays(normalised));
  findings.push(...checkRentDueDays(normalised));
  findings.push(...checkProhibitedFees(normalised));
  findings.push(...checkOrdinalTypos(normalised));

  // Absence checks only make sense for something that reads like a tenancy agreement.
  const looksLikeAgreement = looksLikeTenancyAgreement(normalised);

  if (looksLikeAgreement && !/\bpets?\b/i.test(normalised)) {
    findings.push({
      id: 'no-pets-clause',
      severity: 'warning',
      title: 'No pets provision',
      detail:
        'Tenants have a right to request a pet, and the landlord must respond in writing within 28 days with a valid reason if refusing. With no pets provision, the procedure is undefined.',
      ruleId: 'pets',
    });
  }

  if (
    looksLikeAgreement &&
    /\bdeposit\b/i.test(normalised) &&
    !/\b30\s*days?\b|\bthirty\s*days?\b/i.test(normalised)
  ) {
    findings.push({
      id: 'deposit-deadline',
      severity: 'info',
      title: 'The 30-day deposit deadline is not mentioned',
      detail:
        'A deposit must be protected in an approved scheme within 30 days, and the prescribed information served on the tenant. Worth stating in the agreement so both sides know the clock.',
      ruleId: 'deposit-protection',
    });
  }

  const counts = {
    error: findings.filter((finding) => finding.severity === 'error').length,
    warning: findings.filter((finding) => finding.severity === 'warning').length,
    info: findings.filter((finding) => finding.severity === 'info').length,
  };

  return { findings, counts, ok: counts.error === 0, wordCount };
}
