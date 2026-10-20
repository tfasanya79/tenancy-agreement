/**
 * Working out what a document's variable parts are.
 *
 * This proposes links between text found in an uploaded file and the details the
 * app holds. It is a proposal, never a decision: the review screen shows every link
 * and the agent confirms or changes it.
 *
 * The rule this module follows is deliberately timid. A wrong suggestion is worse
 * than no suggestion, because a confident-looking mapping is easy to accept without
 * reading. So a field is only suggested when the words around the value make it
 * obvious, and anything ambiguous comes back blank with a note saying why.
 *
 * Found the hard way: an early version mapped "£628" to the *deposit* because the
 * word "deposit" appeared in the same paragraph, and would have replaced the deposit
 * scheme's email address with the tenant's.
 *
 * Deterministic on purpose: no model, so the same file always gives the same answer,
 * and it works before anyone has entered an API key.
 */

export type ProposedLink = {
  /** The text as it appears in the document. */
  sample: string;
  /** Suggested field key, or '' when it is not clear from the context. */
  field: string;
  /** What kind of thing it looked like. */
  kind: 'money' | 'date' | 'postcode' | 'email' | 'room' | 'name';
  /** Why it was suggested — or why it was not. */
  hint: string;
  /** `likely` when the context is clear, `check` when somebody must choose. */
  confidence: 'likely' | 'check';
};

export type Proposal = {
  mode: 'values' | 'blanks';
  links: ProposedLink[];
  blankCount: number;
  wordCount: number;
};

const MAX_LINKS = 24;
/** How far back to look for the words that explain a value. */
const NEAR = 140;

function contextBefore(text: string, index: number): string {
  return text.slice(Math.max(0, index - NEAR), index).toLowerCase();
}

/**
 * How many characters separate the *nearest* match from the end of the text.
 *
 * Proximity matters more than presence: in "pay rent of £1,450 … a deposit of
 * £1,673", the word deposit is three characters from the second figure and sixty
 * from the first. Asking only whether a word appears would map the wrong one.
 */
function nearestDistance(before: string, pattern: RegExp): number {
  // matchAll requires the global flag; callers should not have to remember.
  const global = pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
  let best = Number.POSITIVE_INFINITY;
  for (const match of before.matchAll(global)) {
    const start = match.index ?? 0;
    const distance = before.length - (start + match[0].length);
    if (distance < best) best = distance;
  }
  return best;
}

function moneySuggestion(before: string): { field: string; hint: string; confidence: 'likely' | 'check' } {
  // A fee is not the rent, however close the word "rental" sits to it.
  if (nearestDistance(before, /\b(?:fee|fees|charge|charges|admin|late|penalty|penalties)\b/) <= 40) {
    return { field: '', hint: 'looks like a fee or charge, not the rent', confidence: 'check' };
  }

  const deposit = nearestDistance(before, /\b(?:deposit|security|held)\b/);
  const rent = nearestDistance(before, /\b(?:rent|pcm|payable)\b|per\s+(?:calendar\s+)?month|per\s+week/);

  if (!Number.isFinite(deposit) && !Number.isFinite(rent)) {
    return { field: '', hint: 'money — choose which', confidence: 'check' };
  }
  if (deposit < rent) return { field: 'tenancy.deposit_amount', hint: 'the nearest words say deposit', confidence: 'likely' };
  if (rent < deposit) return { field: 'tenancy.rent_amount', hint: 'the nearest words say rent', confidence: 'likely' };
  return { field: '', hint: 'deposit and rent are equally close — choose which', confidence: 'check' };
}

function dateSuggestion(before: string): { field: string; hint: string; confidence: 'likely' | 'check' } {
  const candidates = [
    { field: 'inventory.scheduled_date', label: 'inventory', distance: nearestDistance(before, /\b(?:inventory|condition|schedule)\b/) },
    { field: 'tenancy.payment_date', label: 'payment', distance: nearestDistance(before, /\b(?:payment|payable|due|paid)\b/) },
    { field: 'tenancy.start_date', label: 'start', distance: nearestDistance(before, /\b(?:commenc\w*|starts?|starting|begins?|from)\b/) },
    { field: 'tenancy.deposit_received_date', label: 'deposit', distance: nearestDistance(before, /\b(?:deposit|received)\b/) },
  ]
    .filter((candidate) => Number.isFinite(candidate.distance))
    .sort((a, b) => a.distance - b.distance);

  const best = candidates[0];
  if (best === undefined) return { field: '', hint: 'date — choose which', confidence: 'check' };

  const second = candidates[1];
  if (second !== undefined && second.distance - best.distance < 8) {
    return { field: '', hint: 'two explanations are equally close — choose which', confidence: 'check' };
  }
  return { field: best.field, hint: `the nearest words say ${best.label}`, confidence: 'likely' };
}

/** Addresses used by deposit schemes and government services, which are not tenant emails. */
const NOT_A_TENANT_EMAIL = /(?:deposit|dps|tds|mydeposits|gov\.uk|noreply|no-reply|info@|hello@|admin@|support@)/i;

/**
 * Suggest links for a document's text.
 * @param text the plain text extracted from the uploaded file
 */
export function proposeLinks(text: string): Proposal {
  const flat = text.replace(/\s+/g, ' ');
  const wordCount = flat.trim() === '' ? 0 : flat.split(' ').filter(Boolean).length;
  const blankCount = (flat.match(/_{3,}/g) ?? []).length;

  const links: ProposedLink[] = [];
  const seenSamples = new Set<string>();
  const usedFields = new Set<string>();

  const add = (link: ProposedLink) => {
    const sample = link.sample.trim();
    if (sample === '' || seenSamples.has(sample)) return;

    // Two different values can never both be the same detail: if the field is
    // already taken, this one needs a human to decide.
    let field = link.field;
    let hint = link.hint;
    let confidence = link.confidence;
    if (field !== '' && usedFields.has(field)) {
      field = '';
      hint = `${link.kind} — “${field || 'that detail'}” is already used by another value`;
      confidence = 'check';
    }
    if (field !== '') usedFields.add(field);

    seenSamples.add(sample);
    links.push({ ...link, sample, field, hint, confidence });
  };

  // Money ------------------------------------------------------------------
  for (const match of flat.matchAll(/£\s?[\d,]+(?:\.\d{2})?/g)) {
    const index = match.index ?? 0;
    const suggestion = moneySuggestion(contextBefore(flat, index));
    add({ sample: match[0], kind: 'money', ...suggestion });
    if (links.length >= MAX_LINKS) break;
  }

  // Dates ------------------------------------------------------------------
  for (const match of flat.matchAll(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/g)) {
    const index = match.index ?? 0;
    add({ sample: match[0], kind: 'date', ...dateSuggestion(contextBefore(flat, index)) });
    if (links.length >= MAX_LINKS) break;
  }

  // Postcodes --------------------------------------------------------------
  const postcodes = [...new Set([...flat.matchAll(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/g)].map((match) => match[0]))];
  for (const postcode of postcodes) {
    add({
      sample: postcode,
      kind: 'postcode',
      // More than one postcode in a document means one of them is not the property.
      ...(postcodes.length === 1
        ? { field: 'property.postcode', hint: 'the only postcode in the document', confidence: 'likely' as const }
        : { field: '', hint: 'several postcodes — choose the property’s', confidence: 'check' as const }),
    });
  }

  // Emails -----------------------------------------------------------------
  const emails = [...new Set([...flat.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((match) => match[0]))];
  for (const email of emails) {
    const looksOfficial = NOT_A_TENANT_EMAIL.test(email);
    add({
      sample: email,
      kind: 'email',
      ...(emails.length === 1 && !looksOfficial
        ? { field: 'tenants[0].email', hint: 'the only email in the document', confidence: 'likely' as const }
        : {
            field: '',
            hint: looksOfficial ? 'looks like a scheme or company address' : 'several emails — choose which',
            confidence: 'check' as const,
          }),
    });
  }

  // Room references --------------------------------------------------------
  for (const match of flat.matchAll(/\b(?:Room|Flat|Unit)\s*[A-Z]?\d+[A-Z]?\b/gi)) {
    add({
      sample: match[0],
      kind: 'room',
      field: 'property.room_number',
      hint: 'looks like a room reference',
      confidence: 'likely',
    });
    if (links.length >= MAX_LINKS) break;
  }

  return {
    mode: blankCount >= 3 ? 'blanks' : 'values',
    links,
    blankCount,
    wordCount,
  };
}
