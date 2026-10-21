# Changelog

All notable changes to this project. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed — one door, not two

The Caddy site block lost its shared password. With accounts, roles and an audit
trail inside the app, a second password in front of it was a shared secret protecting
per-person logins: the arrangement that makes a WhatsApp group seem reasonable.
TLS stays, request logging stays, and each person signs in as themselves.

Proxy access logs no longer carry a `user_id` (there is no longer a proxy
credential to name), so attribution lives in the app's own trail — which is more
precise anyway, because it records the field that changed rather than the URL that
was requested.
### Fixed — a tenant's name could not be mapped in your own document

Found by testing the upload-and-fill route end to end, which had no route-level test
before. The rent filled correctly and the tenant did not: the mapping picker offered only
flat field keys, and a person's details live in the `tenants` array, so `full_name` alone
resolved to nothing. The picker now offers **Full name (first tenant)**, **Email (first
tenant)**, and the second tenant likewise; `resolveFieldPath` also accepts the unindexed
`tenants.full_name` as meaning the first tenant, for anybody mapping by hand.

### Added — tests for the features that had none, and the retention promise

`tests/features.test.ts` covers what was reachable but unproven: uploading an agency's own
`.docx`, mapping it by hand, filling it for a tenant and checking the produced file (their
letterhead kept, the rent and the name substituted), rejecting a file that is not Word,
and deleting an upload; the calendar as `.ics`, whole and per tenancy; the printable
history, including a hostile tenant name that must not become markup.

It also pins the two promises the queue makes:

- **Nothing deletes feedback.** There is no delete route, and a test fails if one appears.
  Marking a record `done` or `declined` is a status: it stays in the queue and in the
  sender's own list, with its date, conversation and outcome, for as long as the database
  exists.
- **A declined ask does not gather support for a new one** — clustering skips it, so a
  refused idea cannot look popular by duplication.

`docs/FEEDBACK.md` now records where feedback is stored and why it has to move: it sits in
the tenancy database today (so it is in every hourly backup), and it belongs in the control
database once each organisation has its own file — otherwise a landlord's words about their
agency travel with that agency's data. Also documented: five submissions a person per hour,
in memory, cleared by a restart.
### Added — the FEEDBACK button, and the queue behind it

A button in the corner of every screen, for everyone with an account. Type what you want
in your own words; a small assistant says back what it understood and offers a one-line
record to confirm before anything is sent. Then it goes to the queue of the person who
owns the product — never to the agency, so a landlord can say what they like about the
software without it landing on their agent's desk.

- **Everyone can file**, including landlords, whose access is otherwise read-only. The
  rules in `src/auth/guard.ts` became method-aware to allow exactly that: a person who
  may not change a tenancy may still complain about the app.
- **The operator is a flag, not a role.** `users.is_operator`, set at startup from
  `OPERATOR_EMAILS`, applied to accounts as they are created. An agency owner is not an
  operator, and the tests assert it — otherwise a promise made in the interface would be
  false the moment a second agency exists.
- **The conversation cannot file anything.** Its schema arrives as a *proposal* that the
  interface files after the tester agrees, so the confirmation lives in the code path
  rather than in a prompt's good behaviour. It has no pack tools, never sees tenancy data,
  and is told never to promise a fix or a date.
- **Nothing is lost when the model is missing.** With `OFFLINE_MODE`, no key, or DeepSeek
  unreachable, the same panel becomes a plain form that files the same record.
- **The queue can be worked**: statuses (`new → triaged → planned → done / declined`),
  duplicates grouped by cheap word similarity and counted (*asked 4 times*), a note to
  yourself and a note the tester sees, and Markdown export.
- **Two things are flagged for a human**: anything that looks like somebody else's
  personal data, and anything that looks like a promise — on either side of the
  conversation.

22 tests in `tests/feedback.test.ts`, mostly about refusals: an agency owner gets `403`
on the queue, an agent gets `403`, a landlord may file but not read, and a landlord cannot
see another's submissions. Documentation: `docs/FEEDBACK.md` is now a record of what was
built rather than a plan; `docs/API.md` and `docs/USING-THE-APP.md` describe the routes
and the button.
### Added — a plan for the feedback engine

`docs/FEEDBACK.md` sets out the FEEDBACK button: everyone with an account can file an
idea, a complaint or a confusion, a short conversation reflects it back before filing,
and the operator works a queue rather than reading a log.

Three decisions are already fixed in it: the button is for everybody, a landlord's words
**never** reach their agency (so the queue is operator-only, not agency-owner), and the
plan builds the record and the queue *first* — the chat is a better front door, and the
plain form beneath it keeps working when the model does not. It also records what the
assistant may never do: touch a tenancy, promise a fix, or act as a support desk.
### Fixed — a lost write-ahead log, and the recovery

A live installation lost a day's work without anything appearing to fail. The cause:
in WAL mode a committed change lives in `tenancydesk.db-wal` until a checkpoint folds it
into `tenancydesk.db`, and that log was removed from under the running process — the
kind of thing a shell `sqlite3` call, a `cp`, a `VACUUM` or a tidy-up script does without
meaning to. The app kept serving from the deleted file, so everything looked normal: the
account and the pack were visible in the browser while the `.db` on disk held neither,
and a restart would have ended them.

Recovered by copying the still-open log out of `/proc/<pid>/fd/` before restarting,
checkpointing it into a copy, verifying `PRAGMA integrity_check`, and installing that.
The surviving data: one owner account, one tenancy, 54 audit events and an upload.

Four changes so it cannot bite twice:

- **`wal_autocheckpoint = 256`** — the log is folded into the database as it grows, so it
  never holds more than about a megabyte of committed work.
- **A checkpoint every five minutes**, and on shutdown, so `.db` is a complete copy of the
  database for anyone who opens it with a backup tool or `sqlite3`.
- **Backups run hourly** instead of nightly, named to the hour, kept 14 days — and the
  script now prints what it captured (`1 packs, 1 users, 54 events`), so an empty snapshot
  is noticed at the time rather than when it is needed.
- **`docs/DEPLOY.md` says how to open the database safely**: read-only
  (`file:…?mode=ro`), never `VACUUM`, `cp` or clean up `data/` under a running app, and how
  to recover a deleted-but-open file from `/proc`.

Also: the sign-in screen now says that there is no sign-up — an account is created by the
agency's owner — because somebody reasonably went looking for a button that does not
exist.
### Added — a platform design, deliberately not built

`docs/PLATFORM.md` sets out how this becomes a platform many agencies share, on the
strength of two decisions:

- **One database per organisation**, with a small control database holding only
  identities, memberships and plans. The existing `Store` already takes a data
  directory, so the isolation is a file boundary rather than a query discipline: a
  forgotten filter cannot reach another agency's tenant because that tenant is not in
  that file. (This corrects the shared-table design sketched in conversation — writing
  it down showed the file boundary is both safer and less work.)
- **No tenant accounts.** One capability link per tenancy, tokened in the URL fragment
  and stored only as a hash, opening a whitelisted read-only view — with the delivery
  record (issued, opened, when) shown where the agent already looks.

It also fixes what the platform will never do — protect a deposit, check right to rent,
sign a deed, move money, introduce tenants for a fee — and why each of those is a legal
boundary rather than a backlog item.
### Added — accounts, roles, and the record of who did what

The app treated every request as "the agent". A single shared password was the
only door, and nothing anywhere could say who changed a rent or deleted a pack.
That is a difficult position to defend when the data is other people's tenancy
paperwork.

- **People, with roles.** `owner` can do everything; `agent` can do everything
  about tenancies and records but not people or the agency settings; `landlord` is
  read-only and sees only their own properties' tenancies. What each may call is
  enforced once, in `src/auth/guard.ts`, before any route runs — a landlord asking
  for another landlord's pack is told it does not exist, so the reply reveals
  nothing.
- **Passwords and sessions that are worth the name.** scrypt hashes with the
  parameters stored alongside them, never a password in the database in the clear;
  sessions are random tokens in an `HttpOnly`, `SameSite=Lax`, `Secure`-over-TLS
  cookie, and only a SHA-256 of each token is stored. Twelve hours of use, at most
  a week; changing your password signs out your other browsers.
- **A first run that cannot be hijacked.** With no accounts the app shows a setup
  screen; the endpoint behind it answers `409` for ever once the first account
  exists.
- **The interface offers only what the server allows.** A landlord gets the
  tenancy list, read-only details, the documents and the history — no assistant,
  no checks, no back office.
- **An audit trail with a name on it.** Pack opened, details changed (the field
  names, not a copy of the values), documents generated, notes with their author,
  assistant runs, uploads, settings, migrations and account changes. The History
  tab reads it and says who; packs that predate accounts degrade honestly to "what
  happened" without inventing an author.
- **People & access**, owner only: add somebody, choose their role, tie a landlord
  account to a landlord record, generate or set a password, switch an account off
  (which ends its sessions at once), and read the agency-wide activity log.

Two new test files, and the reason for the second one: `tests/client-sanity.test.ts`
tokenises `public/app.js` and fails if the interface calls a function it never
declares. That is precisely how the Back office button shipped wired to a function
that did not exist, and no test could have caught it before.

Documentation: `docs/MULTI-USER.md` is new; `SECURITY.md` no longer says the app has
no login; `docs/API.md`, `docs/USING-THE-APP.md`, `docs/ARCHITECTURE.md` and
`docs/DEPLOY.md` are updated to match.
### Added — a runbook for hosting it on a real server

`docs/DEPLOY.md` §4 now ends with the setup this has actually been deployed with:
Node 24 from nvm, a root-owned `/etc/tenancydesk.env`, a hardened systemd unit
(read-only filesystem apart from the data folder), a Caddy host block with a
password and automatic TLS, `TZ=Europe/London` so deadline dates are computed in
UK time, and a nightly backup that uses SQLite's `.backup` rather than copying the
file under a running app.

It also records two things learned the hard way: `flush_interval -1` on the proxy
or the assistant's streamed reply arrives in one lump at the end, and a Caddyfile
that contains `{env.*}` placeholders cannot be checked offline — a failed reload
leaves the previous configuration running, so reloading is the safe way to test.

### Fixed — deleting a tenancy failed, and the back office did nothing

Two faults behind the same complaint: *"why is it not possible to delete a tenant?"*
and *"there was meant to be an upload option — I can't find it."*

- **Delete answered "Body cannot be empty when content-type is set to
  'application/json'".** The interface labelled every request as JSON, including a
  delete that carries nothing, and the server refuses an empty JSON body. That made
  deleting a tenancy, a note and an uploaded document all fail. The request now
  declares JSON only when it has something to send, and the server treats an empty
  body as an empty object rather than an error — so a script or a phone client that
  always sets the header works too.
- **The Back office button was wired to a function that did not exist.** Clicking it
  threw a silent error and nothing happened. Everything that lives there — our
  details, properties and rooms, landlords and tenants, **our documents**, backup —
  was unreachable. It opens now.
- **The upload was also hidden even once the back office worked.** It was only
  mentioned in one line of small print. The Documents tab now asks the question
  directly — *do you already have your own versions?* — with an **Upload our
  documents** button; a first-run screen offers the same, and the tab shows an
  **Add another** button once something is uploaded.
- Two tests now cover the empty-body case, so the delete cannot silently break again.

### Fixed — asking for a draft gave you a receipt, not a draft

Clicking *Draft the covering email and a short WhatsApp message* answered "the
covering email and WhatsApp message are saved to the pack", then two things to fix.
The agent could not read the message it had asked for.

Two causes, both fixed:

- **The instructions never said the reply *is* the draft.** They now do: write the
  email with a Subject line and the body, write the WhatsApp message short and
  human, save both, and never answer with only "saved to the pack". Any caveat comes
  after the drafts in one sentence, not as a numbered list of problems.
- **The saved message was displayed nowhere.** It existed on the pack and inside the
  zip's summary sheet, and nowhere in the interface. There is now a **Message to the
  tenant** panel at the top of the Documents tab, with a Copy button for each
  version.

Verified live: the reply now carries a full email (subject, greeting, dates, rent,
deposit, sign-off) and a short WhatsApp message, with one closing line about the
deposit deadline.

### Changed — replies are rendered, not dumped

The assistant writes Markdown, and the chat showed the source: `**Email**` on its
own line, asterisks around every bold word, a letter flattened into one wall of
text. It read like a broken file, which is a poor way to present words meant to be
sent to a tenant.

Replies are now rendered: labels (**Email**, **WhatsApp**) become quiet small-caps
headings, `**bold**` becomes bold, a list becomes a list, single line breaks are
kept — so a letter keeps its greeting, paragraphs and sign-off. Bold labels,
italic, inline code, links, headings, numbered steps, quotes and rules all render.
Markdown inside a reply is built with the DOM and never with `innerHTML`, and only
`http(s)`, `mailto:` and same-site links are clickable, so a template or an email
cannot inject anything into the page.

Each reply also gets a **Copy** button (visible on hover) that copies the words
*without* the Markdown — ready to paste into an email or WhatsApp. Messages the
agent types are shown exactly as typed.

The instructions now tell the assistant that the words the tenant receives are
plain text — no asterisks or headings inside a draft — and that a `**label**` goes
on its own line above each one.


### Added — M5: evidence, explanations and a tenant summary

- **A History tab** per tenancy: every document, note, assistant run and saved
  message, newest first, with a **Print this history** button. The printed page
  carries the facts that settle a deposit dispute — tenant, property, room, landlord,
  dates, rent, deposit and scheme — followed by every document on the date it was
  produced.
- **"Why?" on every check.** Each finding that has a rule behind it now explains
  itself in place: the rule, the detail points, and a GOV.UK source. The 21 sourced
  rules were already there; nothing could reach them.
- **A tenant summary** as an editable template (`templates/key-facts.md`) rather than
  something the model invents: what you pay and when, how to pay, how to end the
  tenancy, who to contact, and what to do about repairs. It joins the move-in set, so
  a new pack now produces seven documents.

### Added — M6: the templates cannot change by accident

`pnpm golden` fingerprints the rendered *text* of every shipped template;
`tests/golden.test.ts` fails when one differs. A wording change is now a deliberate
act — run `pnpm golden` and commit the updated file alongside the template — and a
change to styling or Word metadata does not trip it.

251 tests. `pnpm docs:check` clean.


### Added — M7: backup and health

There are real tenancies, documents and uploads in `data/` now, and they survived
only by copying a folder by hand.

- **Download a backup**: one zip containing `tenancydesk.db`, every generated
  document, every uploaded original, and restore instructions written for someone
  who is not a developer. The database is copied with `VACUUM INTO`, so it is
  consistent while the app keeps running — copying the file by hand mid-write can
  produce a backup that will not open.
- **A Health & backup tab**: tenancies, records, documents, uploads, templates and
  their warnings, assistant status, the database size, how many documents are on
  disk, free space, and where everything lives.

### Added — M4: let several rooms at once

One form per property, a row per room: tenant name, email and start date. Press
*Create the packs* and each row becomes its own tenancy, linked to its own room and
tenant, with the rent and address inherited and the lifecycle set from the start
date. Each pack keeps its own documents — one tenant never sees another's paperwork.

Verified live: four rooms on one property produced four packs in one call, with the
right room, the room's rent, the inherited address, and the past start correctly
marked active while the future ones stayed upcoming.

248 tests, including `backup.test.ts` (the archive opens as a working database and
still holds the notes) and an API test for the bulk creation.


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
