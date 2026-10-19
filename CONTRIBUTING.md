# Contributing to TenancyDesk

Thanks for looking. TenancyDesk exists to get one small letting agency from "tenant references approved" to "document pack on the tenant's doormat" without a subscription or a developer on retainer. Contributions that keep that promise are welcome: clearer wording, better-tested rules, fewer moving parts.

You do not need to be a programmer to make the most useful contributions. Two of the three common changes are editing a Markdown file.

The project is MIT licensed (see `LICENSE`). By contributing you agree your work is licensed the same way.

## The three things most people actually want to do

### 1. Change the wording of a document

Every document is a Markdown file in `templates/`. No code, no build step.

1. Open the file, for example `templates/apt-agreement.md`.
2. **Leave the `---` front matter at the top alone**, apart from `version` and `updated`. It tells the app the document's `id`, `title`, `category` and which fields it needs:

   ```markdown
   ---
   id: apt-agreement
   title: Assured Periodic Tenancy Agreement
   category: tenancy
   jurisdiction: england-wales
   version: "2.0"
   updated: "2026-10-01"
   description: The core tenancy contract for a new letting of a self-contained home.
   required: [landlord.full_name, landlord.address, property.address_line1, property.postcode, tenancy.start_date, tenancy.rent_amount]
   ---
   ```

3. **Keep every `{{placeholder}}` intact.** They are replaced with the tenant's details when the document is generated:

   ```markdown
   **1.2 The Tenant** is {{#each tenants}}{{this.full_name}}, born {{this.dob|date}}, of {{this.current_address}}{{/each}}.
   ```

   Removing a placeholder silently removes a fact from the document. Renaming one makes the field show as missing instead of filled in.

4. Bump `version` and set `updated` to today's date.
5. Restart the app (`Ctrl+C`, then `pnpm start`). Templates are read at startup, so there is nothing to compile.
6. Build the sample pack and look at the result:

   ```bash
   pnpm sample
   ```

   Then open `samples/README.md` for the list, and the `.docx` files in Word (or the `.html` files in a browser, printed to PDF). The sample uses entirely fictional tenants, so you can see the rendering without touching real data.

Available placeholder syntax, from `src/docs/template.ts`:

| Syntax | What it does |
| --- | --- |
| `{{property.postcode}}` | Insert a value |
| `{{tenancy.rent_amount\|money}}` | Insert with a filter: `money`, `date`, `dateshort`, `dateordinal`, `upper`, `lower`, `title`, `number` |
| `{{#if guarantor.full_name}} … {{else}} … {{/if}}` | Include a passage only when a value is present |
| `{{#each tenants}} … {{this.full_name}} … {{/each}}` | Repeat a block for each tenant |
| `{{today}}` | Today's date |

Keep the legal substance of a clause when you change its wording. If you believe a clause is wrong, say so in the pull request rather than quietly rewriting it — see *Legal-content contributions* below.

### 2. Add a new document type

1. Copy an existing template and rename it, for example `templates/apt-agreement.md` → `templates/renewal-letter.md`.
2. Give it a **new, unique `id`** in the front matter (a duplicate id is skipped with a warning), and set `title`, `category` and `jurisdiction`.
3. **List the fields it needs in `required`.** This is what drives the "missing details" warnings and what blocks generation:

   ```markdown
   required: [tenants, property.address_line1, property.postcode, tenancy.start_date]
   ```

   Field keys come from the catalogue in `src/docs/fields.ts`; `pnpm doctor` and the startup banner warn about placeholders that are not in it.
4. **Add a signature block that repeats for every tenant**, so a joint tenancy gets every signature:

   ```markdown
   {{#each tenants}}
   **Tenant** — {{this.full_name}}

   Signature: ______________________________________  Date: ____________________

   {{/each}}
   ```

5. Restart, then `pnpm sample` to check it renders.

**Choosing `category` matters**, because it decides whether the document is included in the recommended move-in pack. The categories that get auto-selected, in the order the interface offers them, are:

| `category` | Auto-selected for move-in | Normally used for |
| --- | --- | --- |
| `tenancy` | Yes | The agreement and the written statement of terms |
| `deposit` | Yes | Prescribed information and deposit paperwork |
| `inventory` | Yes | Inventory and check-in report |
| `compliance` | Yes | Right to rent and pre-tenancy checklists |
| `welcome` | Yes | Tenant welcome pack |
| `guarantee` | Yes, only when a guarantor is named | Deed of guarantee |
| `possession` | No | Section 8 notices |
| `rent-review` | No | Rent increase notices |
| `other` | No | Anything else; the fallback when `category` is absent |

If you invent a new category, it will exist but never be picked automatically — say so in your pull request so the selection list can be considered deliberately.

### 3. Change a compliance rule

Checks are deterministic arithmetic, not AI guesses, and they live in two places that must be kept in step:

| File | Contains |
| --- | --- |
| `src/docs/compliance.ts` | The checks themselves: date arithmetic, deposit caps, missing fields, deadlines, severities (`error`, `warning`, `info`) and which findings block generation |
| `src/knowledge/rules.ts` | The explanations and sources the assistant is allowed to rely on: a `Rule` per topic with a `summary`, detail lines, and a `source` label and URL |

**Update both together.** A check with no rule entry gives the agent a verdict and no reasoning; a rule with no check gives it a fact nothing enforces. Where a finding corresponds to a rule, set the finding's `ruleId` to that rule's `id` so the two are linked in the interface.

`docs/RULES.md` is generated from `src/knowledge/rules.ts` — regenerate it rather than hand-editing it (the file's own header says how), and update `RULES_REVIEWED_ON` when you have re-checked the sources.

Then:

```bash
pnpm test
pnpm typecheck
```

Rules carry a review date and a source on purpose. A rule without a citation will be questioned in review.

## Development setup

Node 24 or newer, and pnpm:

```bash
node -v            # v24 or higher
corepack enable
pnpm install
pnpm dev           # starts with --watch, reloads on a source change
pnpm test
pnpm typecheck
pnpm doctor
pnpm sample
```

| Command | What it does |
| --- | --- |
| `pnpm dev` | Runs the app and restarts it when a source file changes |
| `pnpm start` | Runs it once, as you would in production |
| `pnpm test` | The whole `node:test` suite — no API key, no network |
| `pnpm typecheck` | `tsc --noEmit`; there is no build output by design |
| `pnpm doctor` | The friendly health check: Node version, `.env`, templates, data folder, API key, port |
| `pnpm sample` | Renders every template with fictional data into `samples/` |

You do not need a DeepSeek key to develop. `OFFLINE_MODE=true` in `.env`, or no key at all, leaves everything working except the assistant.

## House style for code

- **Plain TypeScript, no build step.** Node 24 runs the `.ts` files directly. If a change needs a compiler, a bundler or a post-processing step, it is the wrong change.
- **No new runtime dependency without a good reason.** The app has three: `fastify`, `@fastify/static` and `docx`. Everything else — SQLite, HTTP, file paths, zip — comes from Node itself. A dependency has to earn its place against the cost of keeping it patched.
- **ESM with explicit `.ts` extensions.** `import { loadConfig } from './config.ts'` — always with the extension, always with the `.ts`.
- **Comments explain *why*, not *what*.** The code says what it does. A comment earns its line by recording a decision, a trap or a legal reason. Look at the date arithmetic in `src/docs/compliance.ts` for the tone.
- **Small, honest functions.** Thin endpoints in `src/app.ts`; the interesting logic in `src/docs/` (templates, fields, rules) and `src/agent/` (the assistant).
- **British spelling in prose and in user-facing text.** The audience is a UK letting agent.

## Tests

The suite uses the built-in `node:test` runner:

```bash
pnpm test
```

- **Tests never touch the real `data/` folder.** They build their own temporary directory (see `tests/helpers.ts`) and clean up after themselves — so `pnpm test` is always safe to run on the machine holding live tenant packs.
- **Add a test for any behaviour change.** A template change is covered by the render tests; a rule change needs a case that would have failed before it; a bug fix needs a test that fails without the fix.
- **Keep tests offline.** No network calls to DeepSeek: use the client's injectable `fetch` instead.
- CI runs `pnpm typecheck`, `pnpm test`, `pnpm sample` and then checks that the sample pack produced documents, on Node 24 and 26 (`.github/workflows/ci.yml`). If it passes locally, it will pass there.

## Pull requests

- **Keep them small and single-purpose.** One wording change, or one rule, or one fix. A pull request that mixes a template rewrite with a refactor will be asked to split.
- **Say what and why.** What changed, who is affected (the agent? the tenant? the generated document?), and what you checked by hand.
- **Call out anything that changes output.** A template edit, a new `required` field, a changed severity or a new rule can all change what a pack contains. Say so plainly — it is the part reviewers care about most.
- **Confirm the two commands pass** before you ask for review:

  ```bash
  pnpm test
  pnpm typecheck
  ```

- Mention the Node version you tested on if it is not 24.
- No generated files: do not commit `samples/`, `data/`, `node_modules/` or anything under `samples/.build/`. `.gitignore` already covers them.

## Legal-content contributions

A short, firm note, because this is a document tool used on real tenancies.

- **Do not paste copyrighted third-party templates.** Agency-branded or commercially licensed documents are somebody's property, and shipping them would make the project's licence untrue. Write the clause yourself, or start from a government or scheme publication that permits reuse.
- **Mark anything jurisdiction-specific.** `jurisdiction: england-wales` is the default. Scotland and Northern Ireland have different law and different paperwork; a document that only applies to one nation must say so in the front matter and in its first paragraph.
- **Cite a source** for every legal claim — GOV.UK, a deposit protection scheme, HMRC, or the relevant Act. Put it in the rule's `source` in `src/knowledge/rules.ts` and mention it in the pull request. An unsourced legal change will not be merged.
- **Remember the project does not give legal advice**, and neither do its contributors. Templates are illustrations of how the software works; the agent is responsible for the document they serve. Keep the "not legal advice" footer in templates, and do not describe a template as compliant, approved or solicitor-reviewed.
- **When in doubt, ask first.** Open an issue describing the change and the source before writing it — it is much cheaper than rewriting a template.

---

*TenancyDesk cannot send email, sign documents, protect deposits, take payments or keep a rent ledger, and it has no user accounts. Those are deliberate boundaries, not gaps waiting to be filled — see `docs/TOOLBOX.md` for the tools that do them.*
