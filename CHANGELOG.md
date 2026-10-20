# Changelog

All notable changes to this project. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added — M3: what's due, and a calendar

The app computed statutory dates per pack, but nobody was told about them. Now:

- **A "What's due" screen**: every deadline across every live tenancy, grouped into
  Overdue, Next 7 days, Next 30 days and Later, each one opening the pack. Ended
  tenancies are left out — their dates no longer need chasing.
- **One-click `.ics` export**, for the whole portfolio or a single tenancy. All-day
  events with a stable UID (so a re-import updates rather than duplicates) and a
  reminder the day before. No email infrastructure, no cron: it lands in the calendar
  they already look at.
- **A count on the sidebar**: each pack shows `N due` when a statutory date falls
  inside the next month, so the list itself says where to look.

Verified live: nine dates across two tenancies, three inside 30 days, exported as a
valid 9-event calendar.

241 tests, including `due.test.ts` for the aggregation and the calendar format.


### Added — M2: use their own documents

Upload a `.docx` and the app fills it for each tenant, in their own layout. The
original is never rewritten: every fill makes a new copy.

- **Back office → Our documents**: upload, see the audit, review the mapping, save.
- **Recognising the variable parts** (`src/docs/linkProposal.ts`). Shape for the
  obvious ones — postcodes, emails, money, dates, room references — and the words
  *nearest* to each value to decide which detail it is. Deliberately timid: anything
  ambiguous comes back blank and marked **choose**, because a confident wrong mapping
  is easy to accept without reading.
  - Two findings from testing against the client's real contract drove this. An earlier
    version mapped `£628` to the *deposit* because "deposit" appeared later in the same
    paragraph, and would have replaced the deposit scheme's own email address with the
    tenant's. Both are now refused: a fee is not the rent, and a scheme address is not a
    tenant, however close the words sit.
  - Two values may never claim the same detail; the second is marked for a human.
- **Two fill modes**: *value replacement* for the contracts, *blank filling* in
  document order for the holding deposit form.
- **Fill for this tenant** on a pack's Documents tab, producing a `.docx` download.
- The audit runs at upload, so a document that still says "assured shorthold" or
  "section 21" is flagged before it is ever used.

Verified against the documents in `received from the client/`: the room-only contract
fills four values with the old tenant's name and rent gone and the scheme's email
untouched; the holding deposit form fills six blanks with the tenant name, rent and
agency name.

232 tests, including 12 for the proposal engine and one for each fill mode.

Also: the confirmation dialog reads plainly ("Carry on and generate"), and every finished document now shows Word only, since an uploaded document has no print view.


### Added — the tenancy lifecycle, and a warning before a shared change

M1 is complete. The last two pieces:

**Lifecycle.** Every tenancy is `upcoming`, `active`, `ending` or `ended`. A dropdown
next to the pack reference moves it, and the pack list is now grouped by where each
tenancy sits — *Active · Starting soon · Ending · Ended* — so the list reads like a
portfolio rather than an inbox.

**Shared values.** Rooms are now editable in the back office, and changing one says
who it reaches first: *"This room is used by 2 tenancies. Changing the rent or deposit
here changes what those tenancies inherit. Continue?"* Verified end to end — changing
a room from £1,450 to £1,495 moves both tenancies, and an override on one of them
holds at £1,500 while the other follows the room.

`countTenanciesUsing()` ignores ended tenancies: they are history, not a risk. The
permanent record is still there.

Also: badges say "to look at" rather than "to fix", and a complete pack reads "Nothing
outstanding".

220 tests. `pnpm docs:check` clean.


### Changed — the app asks, it does not police

The client's steer, stated plainly: this is their software, not their regulator. The
app should tell them what is outstanding and let them decide.

Generation no longer refuses. `src/docs/gate.ts` decides only whether to **ask**:

| Mode | Behaviour |
| --- | --- |
| **relaxed** (default) | Nothing blocks. Outstanding items are put in front of the agent with a question: carry on, or fix them first |
| **strict** | Holds the documents until the items are resolved, for anyone who wants the guardrail |

Switched in **Back office → Our details**. Relaxed is the default because we know
their process better than we know their circumstances.

- `POST /api/packs/:id/generate` returns `needsConfirmation` with the findings instead
  of an error, and writes nothing until `confirm: true` arrives.
- `generate_documents` gained a `confirm` argument. The assistant's first call asks;
  when the agent says go ahead, it calls again and the documents are produced.
- Choosing to carry on is recorded as a note on the pack — a record, not a lecture.
- Assistant rules rewritten: it is not their regulator, it never leaves them stuck,
  it states the facts once and asks, and it does not repeat a warning after they have
  acknowledged it.

Verified live against DeepSeek with a deliberately bad postcode: the assistant asked
*"Would you like to give me the correct postcode, or shall I go ahead as it stands?"*,
then produced all six documents on the next turn and moved on to the real deadlines.

216 tests, including `gate.test.ts` (relaxed never blocks; strict holds; only serious
findings prompt) and an API test covering ask → confirm → generate → note recorded.


### Added — the back office, and forms that fill themselves

The client's two asks: manage tenancies in one place, and stop retyping what has not
changed.

New records in SQLite — **landlords, properties, rooms, tenants, and the agency's own
details** — with a **Back office** screen for each. A tenancy keeps its own details and
gains links to these records; nothing is moved, so nothing can be lost.

`src/backoffice/inheritance.ts` merges a tenancy over what it inherits, in order:
agency → landlord → property → room → the tenancy itself. The first value found wins,
an empty value means "go back to inherited", and every prefilled field is labelled
with where it came from ("from the room"). Only fields the agent actually types are
saved, so a prefilled value is never frozen into the tenancy.

**Typing three things — tenant name, tenant email, start date — now produces a full
document set in an existing room.** `tests/backoffice.test.ts` asserts it end to end,
including that the rendered agreement contains the inherited address and the room's
rent.

Also in this change:

- `pnpm`-free migration: "Tidy up" finds the properties, rooms, landlords and tenants
  already inside existing packs, **shows what it would create**, and links them only
  on confirmation. A preview writes nothing; an already-linked pack is never migrated
  twice; a pack with no address is reported rather than guessed at.
- The agency's details are no longer copied into each pack, so changing them in
  Settings takes effect everywhere instead of leaving stale copies behind.
- Tenancy lifecycle (`upcoming` / `active` / `ending` / `ended`) on the pack record,
  set from the start date during migration.
- New routes: `/api/settings`, `/api/backoffice`, CRUD for each record type,
  `/api/backoffice/migrate/preview` and `/apply`.

209 tests. `pnpm docs:check` clean.


### Changed — the app follows the client's process, not a compliance checklist

The client's steer: their paperwork defines what the app asks for, and it is not our
job to push them towards anything they do not already do.

Reading their three documents properly corrected an assumption. The contracts *do*
mention gas safety, EICR, EPC, right to rent, the How to Rent guide and alarms — but
only as obligations and references ("the Gas Safety Inspection Report … may be served
on you"), never as values recorded. So a proposed "compliance records" section would
have asked for data their process never captures. It is dropped.

`docs/TENANT-RECORDS.md` is the evidence: every value each document actually records
(fifteen in a tenancy agreement, eleven in the holding deposit form), and the explicit
list of what they do not record, so the app stops asking.

Check severities changed to match. Only what a *document* needs can block generation:

| Severity | Before | Now |
| --- | --- | --- |
| Error (blocks) | 12 findings, including gas safety, EICR, EPC, right to rent, How to Rent, alarms, and three statutory caps | Three kinds — a missing essential detail, a postcode that is not UK-shaped, a deposit protection deadline already passed |
| Warning | 8 | 9, including the caps now that they advise rather than refuse |
| Note | 5 | 13, including all of the above compliance topics |

### Added — `docs/TENANT-RECORDS.md`, `docs/BACKOFFICE.md`

The authoritative field list, and the back-office design. The certificate register is
dropped: their documents do not record certificates, so there is nothing to register.
Money is recorded, not accounted for: rent, deposit, scheme and dates, but no ledger,
arrears or receipts — their contract already says payments go through their own
portal.

### Added — repairing an agency's own contracts (`scripts/repair-contracts.ts`)

`pnpm repair:contracts` produces corrected copies of an agency's own documents
without touching the originals:

- every edit is a text substitution inside the original `.docx`, so letterheads,
  tables, clause numbering and fonts are preserved exactly;
- it reports the audit of each document before and after;
- it writes a change log listing every edit as before/after text, grouped by
  severity, with the decisions a human must confirm;
- when a replacement cannot be found it says so and fails, rather than quietly
  producing a half-repaired document.

Applied to the documents the client supplied: nine substantive repairs per
contract — the assured-shorthold and section 21 language, the second section 21
clause in 8.2.2, the legacy reference in 8.2.6, the rent review procedure, the £15
late-payment fee, the release clause that charged a tenant for leaving, and the
deposit-forfeiture clause — plus the two internal errors in the room-only contract.
Both documents went from three or four audit errors to zero.

### Fixed — ZIP entries are compressed again

`createZip()` stored every entry uncompressed, so a filled Word document came back
nearly four times its original size. It now deflates each entry when that helps and
stores it when it does not; a repaired contract is 119 KB against the original's
141 KB. Two tests cover both branches.

### Added — proofreading an uploaded document

The audit now catches the errors that survive every human review, found by running
it against the documents the client supplied:

- **a weekday that does not match its date** — "Wednesday 5th September 2026" is a
  Saturday;
- **two different rent due days in one document** — "on the 1st" in clause 4 and
  "on the 4th" in clause 5, skipping worked examples that mention another day;
- **a fixed late-payment fee** — the client's contracts charge "£15 admin fee",
  which under the Tenant Fees Act 2019 is very likely a prohibited payment;
- **a mistyped ordinal** — "the 1stth of each month".

Two rules were added to the knowledge base to back the last two:
`prohibited-payments` and `holding-deposit`, both citing the Tenant Fees Act 2019
guidance. `docs/RULES.md` regenerated (20 rules).

### Added — `docs/ROADMAP.md`

A sequenced plan with acceptance criteria for each milestone: deadlines and a
cross-pack dashboard, finishing the upload flow, backup, bulk room lets,
consistency checks, and the evidence timeline. Includes the open questions the
client's documents raised.

### Added — filling an agency's own Word document (`src/docs/docxFill.ts`)

The core of "use my document, not yours". A `.docx` is opened (it is a ZIP of
XML), the values are substituted inside the paragraphs that contain them, and it
is written back — so letterheads, numbering, fonts, tables and signature blocks
survive untouched. `readZip()` was added to `src/util/zip.ts` to make that possible
without a new dependency.

- **Word splits sentences into runs.** `£9` and `80` can be two different `<w:t>`
  elements with different formatting, so searching for `£980` finds nothing. The
  engine rebuilds each paragraph's plain text, finds the value in that, and maps
  the edit back onto the runs.
- **Formatting is kept.** The first run in a match keeps its properties, so a bold
  rent figure stays bold; `xml:space="preserve"` is added where a replacement
  needs spaces.
- **Values are written the way the document writes them.** `formatLike()` turns
  `1450` into `£1,450` when the original said `£980`, and `2026-11-01` into
  `1 November 2026`, `1st November 2026` or `01/11/2026` to match the sample.
- **Ambiguous values can be targeted.** A start date and an inventory date are
  often the same day; `near` restricts a link to paragraphs containing identifying
  words, and targeted links are applied first.
- **Nothing is silently skipped.** Values that were not found are reported back.

### Added — room-by-room lettings

- `property.room_number`, for agencies letting a house room by room.
- `inventory.scheduled_date` and a new *Inventory & condition* group.
- `tenancy.payment_date` is now derived: the day before the start date, then
  monthly (calendar-safe across clock changes), editable if the agreement says
  otherwise.

`pnpm demo:fill` builds a Word agreement resembling an agency's own, then fills it
for a new tenant with the eight values an agent actually changes, writing both
versions to `.incoming/demo/` for inspection in Word.

184 tests.

### Added — document audit (`src/docs/templateAudit.ts`)

Groundwork for letting an agency upload its own agreement. Before such a document
is automated, it is pattern-checked against the current law — no model involved, so
the answer is deterministic and every finding quotes the offending text:

- flags an agreement that still describes itself as an **assured shorthold
  tenancy**, refers to **section 21** or **section 19A**, or creates a **fixed
  term** — all superseded on 1 May 2026;
- flags a vague rent review ("a reasonable percentage") that does not describe the
  section 13 procedure;
- notes a missing pets provision and a missing 30-day deposit deadline, only for
  documents that actually read like a tenancy agreement;
- understands negation, so a correct document that mentions section 21 in order to
  say it is abolished is not flagged — which matters, because the shipped
  agreement does exactly that.

14 tests, including one asserting that every shipped template passes the audit that
will be applied to customer uploads.

---

## [1.0.0] — 2026-10-19

The first working release. A letting agent can create a tenant pack, fill it from a
pasted email or by hand, run compliance checks, and download a complete set of
tenancy documents.

### Added

**Documents**
- Nine England & Wales templates drafted for the post-1 May 2026 regime: assured
  periodic tenancy agreement, written statement of terms, deposit prescribed
  information, inventory and check-in report, right to rent checklist, tenant
  welcome pack, guarantor deed, section 8 notice and section 13 rent increase
  notice.
- Every document generated as `.docx`, print-ready `.html` and expanded `.md`.
- Print to PDF from the browser — no LibreOffice or headless Chrome required.
- One-click ZIP of the whole pack, including a contents sheet with the key dates
  and any findings.

**Template engine**
- `{{placeholder}}` substitution with a documented field catalogue.
- Filters: `money`, `date`, `dateordinal`, `dateshort`, `upper`, `lower`, `title`,
  `number`.
- `{{#if}}` / `{{else}}` / `{{#if x == "Yes"}}` / `{{#if !x}}` conditionals, and
  `{{#each}}` with `{{this.field}}` for joint tenants.
- Flat-key resolution: a pack stores `"landlord.full_name"` as one key, matched
  exactly before any nested traversal.
- Templates are plain Markdown with YAML front matter, editable in any text editor
  and picked up on restart. Unknown placeholders and duplicate ids are reported at
  startup and by `pnpm doctor`.

**Compliance**
- Thirteen deterministic checks — deposit and holding-deposit caps, rent in advance,
  deposit protection, gas safety, EICR, EPC band, right to rent, How to Rent,
  alarms, notice period, agency scheme disclosure.
- Statutory deadlines with countdowns: 30-day deposit protection, 28-day written
  statement, gas safety renewal, EICR expiry.
- Curated 18-rule knowledge base with a GOV.UK or scheme source for each entry, and
  `docs/RULES.md` generated from it by `pnpm rules` so the two cannot drift.

**Assistant**
- DeepSeek chat-completions client with tool calling, exponential-backoff retries
  for transient failures, and actionable messages for bad keys, no balance and rate
  limits.
- Eight tools: `get_pack`, `set_fields`, `check_compliance`, `list_documents`,
  `generate_documents`, `add_note`, `save_cover_message`, `lookup_rules`.
- Streaming trace in the browser, so every step the assistant takes is visible.
- Hard guard: the model cannot write clauses, only fill allow-listed fields.
  Generation is refused while a compliance error stands.
- Every run logged to the local database with its steps and token counts.
- `OFFLINE_MODE` for running without an API key.

**Interface**
- One page, no framework, no build step: pack list, and Assistant, Details,
  Documents and Checks tabs.
- Form generated from the field catalogue, with essential fields marked.
- Document preview before generating.

**Operations**
- Single Node process, SQLite via the built-in `node:sqlite`, three runtime
  dependencies.
- Docker image and compose file, bound to `127.0.0.1` by default, with a healthcheck
  and a named data volume.
- `pnpm doctor` health check, `pnpm sample` demo-pack builder, `pnpm rules`
  documentation generator.
- 141 tests covering the template engine, Markdown parser, compliance maths, field
  merging, document generation, storage, the HTTP API and the agent loop.

### Known limitations

- No accounts or login: designed for a single user on a trusted machine or behind a
  VPN. See [SECURITY.md](SECURITY.md).
- The assistant has not been exercised against a live DeepSeek key in this
  repository's CI; its transport, retry and tool-calling behaviour is covered by
  tests with a mocked transport. Add your key and run the shortcut buttons once.
- No reminder emails, no e-signature, no deposit protection integration — see
  [docs/TOOLBOX.md](docs/TOOLBOX.md) for the suggested companions.
- England & Wales only.

---

## Planned

- Calendar reminders (`.ics`) exported from the deadline list.
- Per-pack activity history view.
- Optional PDF output when LibreOffice is available.
- Template preview with sample data, from inside the app.
- End-of-tenancy and renewal packs.
