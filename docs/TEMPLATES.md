# Editing the documents

Every document TenancyDesk produces comes from a Markdown file in
[`templates/`](../templates/). You can read them, change them, and add your own.

- No code changes, no rebuild, no database migration.
- Edit the file in Notepad, Word, VS Code, Obsidian — anything that saves plain text.
- Restart the app and the change is live.

After editing, run `pnpm sample` to generate [`samples/`](../samples/) and look at
the result, and `pnpm test` to confirm nothing broke.

---

## Anatomy of a template

```markdown
---
id: apt-agreement
title: Assured Periodic Tenancy Agreement
category: tenancy
jurisdiction: england-wales
version: "2.0"
updated: "2026-10-01"
description: The core tenancy contract for a new letting.
required: [landlord.full_name, property.address_line1, tenancy.start_date]
---
# Assured Periodic Tenancy Agreement

This tenancy is between **{{landlord.full_name}}** of {{landlord.address}} and
the tenant(s) named below.

{{#each tenants}}
- {{this.full_name}}, of {{this.current_address}}
{{/each}}

1. **The property.** The Landlord lets {{property.address_line1}},
   {{property.city}} {{property.postcode}} to the Tenant.

2. **The rent.** The rent is {{tenancy.rent_amount|money}} per
   {{tenancy.rent_frequency}} period, payable {{tenancy.rent_due_day}}.

{{#if tenancy.pets_allowed == "Yes"}}
3. **Pets.** A pet is permitted: {{tenancy.pet_details}}.
{{/if}}

> *This document was assembled by TenancyDesk from a template. It is not legal
> advice. Always check the current law before signing.*
```

### The front matter

The block between the `---` lines at the top is the document's identity.

| Key | Required | What it does |
| --- | --- | --- |
| `id` | yes | Unique, kebab-case. This is what the assistant and the API use to refer to the document. |
| `title` | yes | Shown in the interface, in the Word header, and in the ZIP filename. |
| `category` | yes | Controls ordering and whether it is auto-selected — see below. |
| `jurisdiction` | recommended | `england-wales` for all shipped templates. |
| `version` | recommended | Your own version marker. |
| `updated` | recommended | The date you last reviewed the wording. |
| `description` | recommended | One sentence, shown under the title in the Documents tab. |
| `required` | yes | The details that must be present. The app shows these as warnings and reports them to the assistant. |

### Categories

| Category | Meaning | Auto-selected for move-in? |
| --- | --- | --- |
| `tenancy` | The contract itself | ✅ first |
| `deposit` | Deposit paperwork | ✅ |
| `inventory` | Check-in and condition | ✅ |
| `compliance` | Checklists and records | ✅ |
| `welcome` | Plain-English tenant letter | ✅ last |
| `guarantee` | Guarantor deed | only if `guarantor.full_name` is filled in |
| `possession` | Section 8 notice | no — on request |
| `rent-review` | Section 13 rent increase | no — on request |

Anything with a category not in that list is still listed in the interface, just
never auto-selected.

---

## The template language

Four constructs. That is the whole language — deliberately, because a template is a
legal document and surprises are expensive.

### 1. Insert a detail

```markdown
The rent is {{tenancy.rent_amount}}.
```

Paths are matched against the pack's field keys **exactly first**, then walked as
nested objects. In practice you write the flat key you see in the field list:
`{{property.postcode}}` works because that is the key, not because there is a
`property` object with a `postcode` inside it.

If a value is missing, the placeholder renders as nothing at all.

### 2. Format it with a filter

```markdown
{{tenancy.rent_amount|money}}        →  £1,250
{{tenancy.start_date|date}}          →  1 November 2026
{{tenancy.start_date|dateordinal}}   →  1st November 2026
{{tenancy.start_date|dateshort}}     →  01/11/2026
{{property.postcode|upper}}          →  M1 2AB
{{tenant_name|title}}                →  Alex Morgan
```

| Filter | Use |
| --- | --- |
| `money` | Pounds, with thousands separators |
| `date` | `1 November 2026` |
| `dateordinal` | `1st November 2026` — for deeds and formal dating |
| `dateshort` | `01/11/2026` |
| `upper` `lower` `title` | Text case |
| `number` | Strip any currency symbol or comma |

An unknown filter raises an error rather than printing nothing, because a silent
blank in a contract is worse than a loud failure.

### 3. Include a block conditionally

```markdown
{{#if tenancy.deposit_amount}}
The deposit is {{tenancy.deposit_amount|money}}.
{{else}}
No deposit is held for this tenancy.
{{/if}}
```

**Comparing dropdown values.** Dropdowns hold words, and the word `No` counts as
"present". Compare explicitly:

```markdown
{{#if tenancy.pets_allowed == "Yes"}}
A pet is permitted: {{tenancy.pet_details}}.
{{/if}}

{{#if tenancy.pets_allowed != "No"}}
…
{{/if}}

{{#if !tenancy.deposit_amount}}
No deposit is held.
{{/if}}
```

Comparison is case-insensitive and ignores surrounding spaces. A missing value
compares equal to `""`.

> **The mistake to avoid:** `{{#if tenancy.pets_allowed}}` renders the "pets
> allowed" branch even when you set pets to `No`. Always compare.

### 4. Repeat for each tenant

```markdown
{{#each tenants}}
Signed: ______________________  {{this.full_name}}   Date: ____________
{{/each}}
```

Inside an `{{#each}}`, `{{this.field}}` reads from the current tenant. Anything
outside `this.` still reads the pack — so `{{property.postcode}}` works inside the
loop too.

`tenants` entries hold: `full_name`, `email`, `phone`, `dob`, `current_address`,
`id_type`, `id_reference`.

There is no `#unless`, no `#each` over the field list, and no arithmetic. If you
find yourself needing one, that is usually a sign the wording should be simpler.

---

## What Markdown you may use

Keep to this list. The renderer is intentionally small, and unsupported syntax
appears literally in the output.

| You write | You get |
| --- | --- |
| `# Title` | Document title (use once, at the top) |
| `## Section` | Section heading |
| `### Sub-section` | Sub-heading |
| A blank line between paragraphs | Paragraphs |
| `- item` | Bulleted list |
| `1. item` | Numbered list — write the numbers yourself (`1.1`, `2.3`) |
| `**bold**` / `*italic*` | Emphasis |
| `\| A \| B \|` with a `\| --- \| --- \|` divider | A table |
| `> text` | A highlighted callout — use for warnings and disclaimers |
| `---` on its own line | A horizontal rule |
| `\newpage` on its own line | Page break |

**Not supported:** images, hyperlinks, HTML, code blocks, nested lists, footnotes.

### Three traps worth knowing

1. **A blank line ends a table.** Never put a blank line — or a `{{#each}}` on its
   own line — in the middle of table rows; the table splits and you get stray `|`
   characters. Put loops around whole blocks instead, and use signature lines
   (`Signed: ______  Date: ______`) rather than signature tables.
2. **`No` is truthy.** Covered above — compare with `==` and `!=`.
3. **Lists are flat.** A `- ` line directly under another `- ` line is one list;
   indenting does not nest it.

---

## The field catalogue

These are all the details a pack can hold. Use these keys — anything else is
rejected by the app (and reported as a template warning at startup).

### Tenants — a list, repeat with `{{#each tenants}}`

| Key | Type |
| --- | --- |
| `full_name` `email` `phone` `dob` `current_address` `id_type` `id_reference` | text / date |

### Property

| Key | Type | Notes |
| --- | --- | --- |
| `property.address_line1` `property.address_line2` `property.city` `property.postcode` | text | |
| `property.room_number` | text | For room-by-room lettings, e.g. "Room 2". Leave blank for a whole property |
| `property.property_type` | select | Flat · House · Maisonette · Bungalow · Studio · Other |
| `property.bedrooms` | number | |
| `property.furnished_status` | select | Furnished · Part-furnished · Unfurnished |
| `property.garden` `property.parking` | text | Free text |
| `property.epc_rating` | select | A–G. F and G are flagged as errors |
| `property.epc_reference` `property.council_name` | text | |
| `property.council_tax_band` | select | A–H |

### Tenancy

| Key | Type | Notes |
| --- | --- | --- |
| `tenancy.start_date` | date | |
| `tenancy.payment_date` | date | **Derived** — the day before the start date. Supply it only to override |
| `tenancy.rent_amount` | money | |
| `tenancy.rent_frequency` | select | Monthly · Weekly · Fortnightly |
| `tenancy.rent_due_day` | text | e.g. "1st of each month" |
| `tenancy.payment_method` | select | Standing order · Bank transfer · Direct debit · Other |
| `tenancy.payment_reference` | text | |
| `tenancy.rent_in_advance` | money | Capped at one month |
| `tenancy.holding_deposit_amount` | money | Capped at one week's rent |
| `tenancy.notice_period_tenant` | text | Should say two months |
| `tenancy.pets_allowed` | select | No · Yes · By written request |
| `tenancy.pet_details` | text | |
| `tenancy.smoking_allowed` | select | No · Not indoors · Yes |
| `tenancy.utilities_included` | text | |
| `tenancy.bills_responsibility` | text | |
| `tenancy.break_clause` | text | Special terms (legacy fixed terms only) |

### Deposit

| Key | Type | Notes |
| --- | --- | --- |
| `tenancy.deposit_amount` | money | Capped at five weeks' rent |
| `tenancy.deposit_scheme` | select | DPS · MyDeposits · TDS · Not yet protected |
| `tenancy.deposit_scheme_ref` | text | |
| `tenancy.deposit_received_date` | date | Starts the 30-day clock |

### Inventory & condition

| Key | Type | Notes |
| --- | --- | --- |
| `inventory.scheduled_date` | date | The date the schedule of condition and inventory is agreed |

### Landlord, agent and guarantor

| Key | Type |
| --- | --- |
| `landlord.full_name` `landlord.address` `landlord.email` `landlord.phone` | text |
| `agent.company_name` `agent.name` `agent.email` `agent.phone` `agent.address` | text |
| `agent.client_money_scheme` `agent.redress_scheme` | text |
| `guarantor.full_name` `guarantor.address` `guarantor.email` `guarantor.phone` `guarantor.relationship` | text |

### Utilities and safety

| Key | Type |
| --- | --- |
| `utilities.gas_supplier` `utilities.electricity_supplier` `utilities.water_supplier` `utilities.broadband` | text |
| `safety.gas_safety_date` `safety.eicr_date` `safety.eicr_next_due` `safety.how_to_rent_date` `safety.right_to_rent_check_date` | date |
| `safety.gas_safety_engineer` `safety.smoke_alarms` `safety.co_alarms` | text |

### Document

| Key | Type | Notes |
| --- | --- | --- |
| `doc.reference` | text | The pack reference, e.g. `TD-2026-0004` |
| `doc.issue_date` | date | Defaults to today |
| `today` | date | Always available; equals today |

---

## Adding a new document type

1. Copy the closest existing template in `templates/`.
2. Change `id`, `title`, `category` and `description` in the front matter.
3. List the details you actually use in `required`.
4. Write the body, keeping to the syntax above.
5. Include a signature block:
   ```markdown
   {{#each tenants}}
   Signed: ______________________  {{this.full_name}}   Date: ____________
   {{/each}}
   ```
6. Restart the app. Check the startup output — unknown placeholders are reported
   there, and in the `pnpm doctor` report.
7. `pnpm sample` and open the result in Word.

To add a **new detail** rather than a new document, add it to
[`src/docs/fields.ts`](../src/docs/fields.ts) first — one entry, in the right group —
then use it in a template. `pnpm doctor` will tell you if a template references a
key that does not exist.

---

## Checking your work

```bash
pnpm doctor     # unknown placeholders, unknown ids, tables that will split
pnpm sample     # render every document with the demo tenant
pnpm test       # the automated suite
```

`pnpm doctor` and the app's startup banner are the two places template problems
surface. Both are worth running after any wording change.
