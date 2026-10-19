/**
 * `pnpm rules` — regenerate `docs/RULES.md` from `src/knowledge/rules.ts`.
 *
 * The rule set is the part of this project most likely to go out of date, and
 * the part where being wrong matters most. Generating the human-readable
 * version from the same data the assistant uses means they cannot drift apart.
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { RULES, RULES_REVIEWED_ON } from '../src/knowledge/rules.ts';

const lines: string[] = [];

lines.push('# The rule set');
lines.push('');
lines.push(
  'These are the England & Wales rules that TenancyDesk checks against and that the assistant',
  'is allowed to rely on. They live in `src/knowledge/rules.ts`; this page is generated from',
  'that file by `pnpm rules`, so the two cannot drift apart.',
);
lines.push('');
lines.push(`**Last reviewed:** ${RULES_REVIEWED_ON}`);
lines.push('');
lines.push('> This is a summary written for software, not legal advice. Tenancy law changes, and');
lines.push('> several parts of the Renters’ Rights Act 2025 are still being phased in. Always confirm');
lines.push('> the current position at the source before you rely on it.');
lines.push('');
lines.push('## How these are used');
lines.push('');
lines.push('| Where | What it does |');
lines.push('| --- | --- |');
lines.push('| `src/docs/compliance.ts` | Deterministic checks — arithmetic and date comparisons, no AI. These produce the errors that block document generation. |');
lines.push('| `src/agent/tools.ts` → `lookup_rules` | The assistant searches this set instead of answering from memory. |');
lines.push('| `src/agent/prompts.ts` | Reminds the model to use `lookup_rules` rather than recall law. |');
lines.push('');
lines.push(`## What changed in May 2026`);
lines.push('');
lines.push(
  'Phase 1 of the Renters’ Rights Act 2025 came into force on **1 May 2026**. The documents in',
  '`templates/` are written for the position after that date:',
);
lines.push('');
lines.push('- Section 21 “no fault” eviction is abolished. Possession is section 8 only.');
lines.push('- Fixed-term assured shorthold tenancies are replaced by **assured periodic tenancies**.');
lines.push('- Rent may rise once a year, on two months’ notice, under section 13.');
lines.push('- No more than one month’s rent may be taken in advance, and rental bidding is banned.');
lines.push('- Discrimination against tenants with children or receiving benefits is illegal.');
lines.push('- Tenants have a right to request a pet, with a 28-day decision period.');
lines.push('');
lines.push('Phase 2 (from late 2026) brings the PRS Database and the Landlord Ombudsman. Phase 3');
lines.push('covers the Decent Homes Standard and Awaab’s Law, with timetables still being consulted on.');
lines.push('');
lines.push('## The rules');
lines.push('');
lines.push('| # | Topic | Rule |');
lines.push('| --- | --- | --- |');
RULES.forEach((rule, index) => {
  lines.push(`| ${index + 1} | ${rule.topic} | [${rule.title}](#${rule.id}) |`);
});
lines.push('');
lines.push('---');
lines.push('');

for (const rule of RULES) {
  lines.push(`<a id="${rule.id}"></a>`);
  lines.push('');
  lines.push(`### ${rule.title}`);
  lines.push('');
  lines.push(`**Topic:** ${rule.topic} · **Rule id:** \`${rule.id}\``);
  lines.push('');
  lines.push(rule.summary);
  lines.push('');
  for (const detail of rule.detail) lines.push(`- ${detail}`);
  lines.push('');
  lines.push(`Source: [${rule.source.label}](${rule.source.url})`);
  lines.push('');
  lines.push('---');
  lines.push('');
}

lines.push('## Adding or changing a rule');
lines.push('');
lines.push('1. Edit `src/knowledge/rules.ts` — keep the `id` stable if the rule already exists.');
lines.push('2. If the rule affects a check, update `src/docs/compliance.ts` as well.');
lines.push('3. Update the “Phase 1 / 2 / 3” summary above if the change is a timing change.');
lines.push('4. Run `pnpm rules` to regenerate this page, then `pnpm test`.');
lines.push('5. Change `RULES_REVIEWED_ON` so readers know how fresh the advice is.');
lines.push('');

const target = resolve('docs/RULES.md');
await writeFile(target, lines.join('\n'), 'utf8');
console.log(`Wrote ${target} — ${RULES.length} rules, reviewed ${RULES_REVIEWED_ON}.`);
