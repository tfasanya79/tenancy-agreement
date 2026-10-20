/**
 * `pnpm repair:contracts` — produce corrected copies of the client's contracts.
 *
 * The originals in `received from the client/` are never modified. Corrected
 * copies are written to `repaired contracts/`, together with a change log listing
 * every edit, why it was made, and which changes need sign-off.
 *
 * The substitutions go through the same engine the app uses to fill a document,
 * so the letterhead, tables, numbering and fonts are untouched.
 *
 * These files contain a previous tenant's personal data — they are the anchor
 * values the fill flow matches on — and both folders are git-ignored.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { extractDocxText, fillDocx, type Replacement } from '../src/docs/docxFill.ts';
import { auditDocumentText } from '../src/docs/templateAudit.ts';

const SOURCE_DIR = 'received from the client';
const OUTPUT_DIR = 'repaired contracts';

type Category = 'must-fix' | 'compliance-risk' | 'accuracy' | 'internal-error';
type AppliesTo = 'both' | 'room-only' | 'whole-house';

type Repair = {
  id: string;
  category: Category;
  appliesTo: AppliesTo;
  title: string;
  why: string;
  find: string;
  replace: string;
  all?: boolean;
  /** A decision a human should confirm. */
  confirm?: string;
};

const CONTRACTS = [
  { key: 'room-only' as const, source: 'Tenancy contract.docx', output: 'Room-only contract - repaired.docx' },
  { key: 'whole-house' as const, source: 'WHOLE HOUSE CONTRACT- New.docx', output: 'Whole house contract - repaired.docx' },
];

const REPAIRS: readonly Repair[] = [
  {
    id: 'assured-periodic-identity',
    category: 'must-fix',
    appliesTo: 'both',
    title: 'The tenancy is now described as an assured periodic tenancy',
    why:
      'The clause still described an assured shorthold tenancy under section 19A and relied on section 21. Section 21 was abolished on 1 May 2026 and fixed-term assured shorthold tenancies no longer exist for new lettings in England, so the document contradicted its own title. Possession is now section 8 grounds only, through the court.',
    find:
      'This Agreement is an Assured Shorthold Tenancy (as defined in Section 19A of the Housing Act 1988). The repossession arrangements in Section 21 of the Housing Act 1988 apply to this Agreement. This means that you cannot claim any legal rights to stay on once we have ended the Tenancy and a court order says you must leave.',
    replace:
      'This Agreement is an Assured Periodic Tenancy. It is an assured tenancy for the purposes of the Housing Act 1988, as amended by the Renters’ Rights Act 2025, and it has no fixed end date. It continues until it is ended in accordance with this Agreement and the law. We may only recover possession of the Property by obtaining an order of the court on one of the grounds set out in Schedule 2 to the Housing Act 1988, and nothing in this Agreement gives us any other right to end the Tenancy or to recover possession.',
  },
  {
    id: 'agreement-heading',
    category: 'must-fix',
    appliesTo: 'both',
    title: 'The introductory sentence names the correct tenancy type',
    why: 'The second reference to an assured shorthold tenancy, in the opening description of the Agreement.',
    find: 'This is an Agreement for an Assured Shorthold Tenancy between us, the landlord',
    replace: 'This is an Agreement for an Assured Periodic Tenancy between us, the landlord',
  },
  {
    id: 'possession-clause',
    category: 'must-fix',
    appliesTo: 'both',
    title: 'Clause 8.2.2 no longer relies on section 21',
    why: 'This was a second, separate reliance on section 21 inside the list of circumstances in which possession is sought.',
    find: '8.2.2 the arrangements for us to repossess the property in section 21 of the Housing Act 1988 apply.',
    replace:
      '8.2.2 we obtain an order of the court for possession on one of the grounds set out in Schedule 2 to the Housing Act 1988; or',
  },
  {
    id: 'clause-8-2-6',
    category: 'must-fix',
    appliesTo: 'both',
    title: 'Clause 8.2.6 drops the obsolete reference to a shorthold tenancy',
    why: 'The tenancy ceasing to be assured is a correct trigger; the parenthetical reference to a shorthold tenancy is no longer meaningful.',
    find: 'the Tenancy is no longer an assured tenancy (including a Shorthold).',
    replace: 'the Tenancy is no longer an assured tenancy.',
  },
  {
    id: 'rent-review',
    category: 'must-fix',
    appliesTo: 'both',
    title: 'Rent review now follows the section 13 procedure',
    why:
      'The clause allowed an increase by “a reasonable percentage” on one month’s notice. Section 13 requires a notice in the prescribed form and at least two months’ notice, and rent may only be increased once in any 12-month period. The tenant may challenge the amount at the tribunal.',
    find:
      'We shall have the option on the anniversary of this agreement to increase the Rent by a reasonable percentage provided we have given you at least one month’s notice of our intention to exercise this option in accordance with Section 13 of the Housing Act 1988  as amended.',
    replace:
      'We may increase the Rent no more than once in any 12-month period by serving on you a notice in the form prescribed under section 13 of the Housing Act 1988. The notice must be given at least two months before the increase takes effect, and must state the new Rent and the date on which it takes effect. You may refer a proposed increase to the tribunal if you consider it excessive.',
  },
  {
    id: 'late-payment-fee',
    category: 'compliance-risk',
    appliesTo: 'both',
    title: 'The fixed £15 late-payment charge is replaced with statutory interest',
    why:
      'Under the Tenant Fees Act 2019 a charge for late rent is limited to interest at 3% above the Bank of England base rate, and only once the rent is 14 days overdue. A flat “admin fee” for a late payment is a prohibited payment: it must be repaid, and a council can impose a financial penalty.',
    find:
      'Please note for any late rental payment there is an additional £15 admin fee that will be added. You will be notified via our payment portal',
    replace:
      'Please note that if the Rent is more than 14 days overdue we may charge interest at 3% above the Bank of England base rate for the days it remains unpaid. No other charge is made for a late payment.',
  },
  {
    id: 'early-leaving',
    category: 'must-fix',
    appliesTo: 'both',
    title: 'Clause 8.4 no longer charges a tenant for leaving',
    why:
      'The clause required a tenant who left “before the fixed term” to pay re-letting costs and rent until a new tenant moved in. There is no fixed term any more: a tenant may end an assured periodic tenancy with two months’ notice, and cannot be charged for exercising that right.',
    find:
      'If you give us notice that you are going to leave the property before the fixed term of this Agreement has ended, you must pay our reasonable costs for reletting the Property and continue to pay the rent in advance for each rent period until a new tenant moves in. We do not have to take the Property or the Tenancy back from you early unless we want to do so.',
    replace:
      'You may end the Tenancy by giving us at least two months’ notice in writing, and the Tenancy will end on the date on which your notice takes effect. You do not have to pay any charge for giving notice or for leaving at the end of your notice period. If you ask to leave before your notice expires and we agree in writing, we may ask you to pay our reasonable costs of re-letting the Property; we will tell you the amount before you agree to it.',
  },
  {
    id: 'deposit-forfeiture',
    category: 'compliance-risk',
    appliesTo: 'both',
    title: 'Clause 8.2.7 no longer forfeits the deposit',
    why:
      'The clause said that leaving without notice “will lead to a forfeit of you deposit”. A deposit cannot simply be forfeited: any deduction must be reasonable and is dealt with under the deposit scheme’s rules and dispute process.',
    find:
      '8.2.7 In any circumstance you cannot abandon the property without prior notice to the Landlord, doing so will lead to a forfeit of you deposit.',
    replace:
      '8.2.7 you leave the Property without giving notice, in which case you remain liable for the Rent until the Tenancy ends in accordance with this Agreement. Any deduction from the Deposit must be reasonable and will be dealt with under the rules of the tenancy deposit scheme.',
  },
  {
    id: 'rent-arrears-possession',
    category: 'accuracy',
    appliesTo: 'both',
    title: 'Clause 8.2.3 no longer implies possession follows 14 days of arrears',
    why:
      'It sat in a list of circumstances in which possession may be recovered, but rent being 14 days overdue does not by itself entitle a landlord to possession. It is the threshold at which interest may be charged, and possession for arrears needs section 8 Ground 8 and a court order.',
    find: '8.2.3 the Rent is unpaid 14 days after becoming payable whether it has been formally demanded or not.',
    replace:
      '8.2.3 the Rent is unpaid 14 days after becoming payable, whether formally demanded or not, in which case we may charge interest as set out above. This does not by itself entitle us to possession.',
    confirm:
      'This changes when possession is said to be available. Please confirm you are happy with the narrower wording.',
  },
  {
    id: 'room-due-day',
    category: 'internal-error',
    appliesTo: 'room-only',
    title: 'The rent due day agrees throughout the room-only contract',
    why:
      'One clause said “rent in advance on the 1stth of each month” while the next said subsequent payments are due “on the 4th of each month”. The 4th is consistent with the first payment falling before the 5th, so the mistyped day is corrected to the 4th.',
    find: 'rent in advance on the 1stth of each month',
    replace: 'rent in advance on the 4th of each month',
    confirm: 'Confirm the rent is due on the 4th, not the 1st.',
  },
  {
    id: 'room-weekday',
    category: 'internal-error',
    appliesTo: 'room-only',
    title: 'Weekday names removed from the room-only dates',
    why:
      'The contract said “Wednesday 5th September 2026”, but 5 September 2026 is a Saturday. Weekday names are removed rather than corrected, so that filling in a new date can never leave a stale weekday behind.',
    find: 'Wednesday 5th September 2026',
    replace: '5th September 2026',
    all: true,
  },
  {
    id: 'whole-house-weekday',
    category: 'internal-error',
    appliesTo: 'whole-house',
    title: 'Weekday names removed from the whole-house dates',
    why:
      'These dates were correct (30 October 2026 is a Friday), but leaving the weekday in place means a filled-in document would name the wrong day as soon as the date changed. Removed for safety.',
    find: 'Friday 30th October 2026',
    replace: '30th October 2026',
    all: true,
  },
];

const CATEGORY_LABEL: Record<Category, string> = {
  'must-fix': 'Must fix — the law changed',
  'compliance-risk': 'Compliance risk — Tenant Fees Act 2019',
  accuracy: 'Accuracy',
  'internal-error': 'Internal error',
};

function hash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}

async function main() {
  // On a fresh clone the client's documents are absent (they are personal data and
  // never committed), so this is a no-op rather than an error.
  try {
    await readdir(SOURCE_DIR);
  } catch {
    console.log('');
    console.log(`  No "${SOURCE_DIR}/" folder, so there is nothing to repair.`);
    console.log('  Put the client\'s .docx files there and run this again.');
    console.log('');
    return;
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const log: string[] = [];
  const rows: Array<{ document: string; repair: Repair; count: number }> = [];
  const missing: Array<{ document: string; repair: Repair }> = [];
  const notes: string[] = [];

  for (const contract of CONTRACTS) {
    const original = await readFile(join(SOURCE_DIR, contract.source));
    const applicable = REPAIRS.filter(
      (repair) => repair.appliesTo === 'both' || repair.appliesTo === contract.key,
    );

    const replacements: Replacement[] = applicable.map((repair) => ({
      find: repair.find,
      replace: repair.replace,
      label: repair.id,
      ...(repair.all === true ? { all: true } : {}),
    }));

    const result = fillDocx(original, replacements);
    await writeFile(join(OUTPUT_DIR, contract.output), result.buffer);

    for (const repair of applicable) {
      const applied = result.applied.find((change) => change.label === repair.id);
      if (applied === undefined) missing.push({ document: contract.source, repair });
      else rows.push({ document: contract.source, repair, count: applied.count });
    }

    const before = auditDocumentText(extractDocxText(original).text);
    const after = auditDocumentText(extractDocxText(result.buffer).text);
    const words = extractDocxText(result.buffer).text.split(/\s+/).filter(Boolean).length;

    notes.push(
      [
        `### ${contract.output}`,
        '',
        `- Source: \`${contract.source}\` (sha256 ${hash(original)}, unchanged)`,
        `- Output: \`${contract.output}\` (sha256 ${hash(result.buffer)}, ${words} words)`,
        `- Audit before: **${before.counts.error} errors**, ${before.counts.warning} warnings, ${before.counts.info} notes`,
        `- Audit after: **${after.counts.error} errors**, ${after.counts.warning} warnings, ${after.counts.info} notes`,
        after.findings.length > 0
          ? `- Remaining findings: ${after.findings.map((finding) => `\`${finding.id}\` (${finding.severity})`).join(', ')}`
          : '- Remaining findings: none',
        '',
      ].join('\n'),
    );
  }

  // ---- change log ---------------------------------------------------------
  log.push('# Changes made to the client’s contracts');
  log.push('');
  log.push(
    'Two corrected copies, made from the documents received. The originals in ' +
      '`received from the client/` are untouched, so they can still be used instead if preferred.',
  );
  log.push('');
  log.push(
    'Every change below was made by substituting text inside the original Word file, so the ' +
      'letterhead, tables, clause numbering and fonts are exactly as supplied. Nothing was redesigned.',
  );
  log.push('');
  log.push('> **These files still contain a previous tenant’s details.** That is deliberate — the app');
  log.push('> matches on those values when filling for a new tenant. Never send one of these to a new');
  log.push('> tenant as it stands.');
  log.push('');
  log.push('---');
  log.push('');
  log.push('## Audit before and after');
  log.push('');
  for (const note of notes) {
    log.push(note);
  }
  log.push('---');
  log.push('');
  log.push('## What changed, and why');
  log.push('');

  const categories: Category[] = ['must-fix', 'compliance-risk', 'accuracy', 'internal-error'];
  for (const category of categories) {
    const inCategory = rows.filter((row) => row.repair.category === category);
    if (inCategory.length === 0) continue;
    log.push(`### ${CATEGORY_LABEL[category]}`);
    log.push('');
    for (const repair of REPAIRS.filter((item) => item.category === category)) {
      const hits = rows.filter((row) => row.repair.id === repair.id);
      if (hits.length === 0) continue;
      const where = hits.map((hit) => `${hit.document} (×${hit.count})`).join('; ');
      log.push(`**${repair.title}** — ${where}`);
      log.push('');
      log.push(repair.why);
      log.push('');
      log.push('```text');
      log.push(`was:    ${repair.find}`);
      log.push(`now:    ${repair.replace}`);
      log.push('```');
      log.push('');
    }
  }

  const confirmations = REPAIRS.filter((repair) => repair.confirm !== undefined);
  if (confirmations.length > 0) {
    log.push('---');
    log.push('');
    log.push('## Please confirm');
    log.push('');
    for (const repair of confirmations) log.push(`- **${repair.title}** — ${repair.confirm}`);
    log.push('');
  }

  log.push('---');
  log.push('');
  log.push('## Deliberately not changed');
  log.push('');
  log.push(
    '- **The tenancy-specific details** (names, rent, dates, addresses, emails) are left exactly as ' +
      'they were. They are what the app matches on and replaces when filling for a new tenant.',
  );
  log.push(
    '- **Clause 8.2.1** (Schedule 2 grounds) is still correct and was left alone.',
  );
  log.push(
    '- **The tenant’s two months’ notice** is already right and was not touched.',
  );
  log.push(
    '- **Wording style, layout and clause order** were preserved throughout. This is their document ' +
      'with corrections, not a replacement.',
  );
  log.push('');
  log.push('## Before these are used');
  log.push('');
  log.push(
    '1. Have them read by whoever advises the business — a solicitor or their professional body. ' +
      'These corrections are based on the England & Wales position after 1 May 2026, and several ' +
      'parts of the Renters’ Rights Act are still being phased in.',
  );
  log.push(
    '2. Decide the open questions above, and confirm the rent due day on the room-only contract.',
  );
  log.push(
    '3. Reconcile the two agency email addresses: the documents and `.env` should name the same one.',
  );
  log.push('');

  await writeFile(join(OUTPUT_DIR, 'CHANGES.md'), log.join('\n'), 'utf8');

  // ---- console ------------------------------------------------------------
  console.log('');
  console.log('  Repaired contracts');
  console.log('  ' + '─'.repeat(58));
  for (const contract of CONTRACTS) {
    const count = rows.filter((row) => row.document === contract.source).length;
    console.log(`  ✓ ${contract.output}  (${count} changes)`);
  }
  if (missing.length > 0) {
    console.log('');
    console.log('  ✗ Could not find, so NOT applied:');
    for (const item of missing) console.log(`      ${item.document}: ${item.repair.title}`);
  }
  console.log('');
  console.log(`  Written to ${OUTPUT_DIR}/`);
  console.log(`  Change log: ${join(OUTPUT_DIR, 'CHANGES.md')}`);
  console.log('');
  if (missing.length > 0) process.exitCode = 1;
}

await main();
