# TenancyDesk

**Tenancy paperwork, done in minutes.** TenancyDesk takes the tenancy document
templates a letting agent already uses, fills them with a new tenant's details,
checks them against the rules, and hands back a finished, ready-to-sign document
pack — as Word files, print-ready pages, and one ZIP.

Built for a small UK agency working in **England & Wales**, with an AI assistant
(DeepSeek) that does the reading and typing but is never allowed to write the
legal text.

> **The one-sentence version:** the templates stay yours and stay fixed; the
> assistant only fills in the blanks — so a confident AI can never quietly
> invent a clause in a tenancy agreement.

---

## Contents

- [See it working](#see-it-working)
- [What it actually does](#what-it-actually-does)
- [Quick start](#quick-start)
- [Your first document pack](#your-first-document-pack)
- [The documents](#the-documents)
- [How the assistant is kept safe](#how-the-assistant-is-kept-safe)
- [The compliance checks](#the-compliance-checks)
- [The agent's toolbox](#the-agents-toolbox)
- [Editing the documents](#editing-the-documents)
- [Configuration](#configuration)
- [How it is built](#how-it-is-built)
- [Project layout](#project-layout)
- [Commands](#commands)
- [The law, and what this is not](#the-law-and-what-this-is-not)
- [Your data and security](#your-data-and-security)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [Status and roadmap](#status-and-roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## See it working

You do not need a key, a database or an install to look at the output. The
[`samples/`](samples/) folder contains a complete pack built from the shipped
templates for a fictional tenancy:

| File | What to do with it |
| --- | --- |
| [`samples/01-apt-agreement.docx`](samples/01-apt-agreement.docx) | Open in Word — this is the file you would send for signature |
| [`samples/01-apt-agreement.html`](samples/01-apt-agreement.html) | Open in a browser and press **Print → Save as PDF** |
| [`samples/README.md`](samples/README.md) | A one-page contents sheet for the pack |

Regenerate them any time with `pnpm sample`.

---

## What it actually does

An agency does this for every new tenancy: read the landlord's email, retype the
same details into eight documents, remember six legal deadlines, and hope nothing
was missed. TenancyDesk turns that into three steps.

**Before**

1. Someone reads a messy email thread and works out the rent, dates and deposit.
2. Those details get retyped into a Word template — eight times.
3. The deposit cap, the gas certificate date and the notice period get checked
   from memory.
4. Files are saved under names nobody can find again.

**After**

1. **Paste the email into the assistant.** It extracts the details it is sure of
   and asks you about the ones it is not.
2. **Look at the Checks tab.** Real arithmetic, not AI: is the deposit over the
   five-week cap, does the gas certificate go out of date before move-in, when is
   the 30-day deposit-protection deadline.
3. **Press Generate.** Every document for move-in, in Word and print-ready HTML,
   plus one ZIP with a contents sheet. Download, sign, send.

The sticky details — the exact wording of every clause — stay in your templates,
which you can read and edit in any text editor.

### Who it is for

- A one-to-three person letting agency that handles its own tenancy paperwork.
- A landlord with a handful of properties who wants to stop reusing 2019 templates.
- Anyone who has ever discovered the deposit was protected on day 34.

### What it deliberately does not do

No accounts, no subscriptions, no CRM, no email sending, no e-signature, no cloud
storage, and no data sent anywhere except your chosen AI provider. It does one job
and gets out of the way — see [docs/TOOLBOX.md](docs/TOOLBOX.md) for the small
handful of other tools that pair well with it.

---

## Quick start

Two ways in. Both need a **DeepSeek API key** for the assistant — everything else
(documents, checks, downloads) works without one.

### Option A — Docker (recommended, nothing to install)

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) or
Docker Engine.

```bash
git clone https://github.com/tfasanya79/tenancy-agreement.git
cd tenancy-agreement

cp .env.example .env          # Windows: copy .env.example .env
# open .env and paste your key into DEEPSEEK_API_KEY=
# optionally fill in AGENCY_NAME, AGENCY_EMAIL, AGENCY_PHONE

docker compose up -d
```

Open **http://localhost:3000**.

```bash
docker compose logs -f      # watch what it is doing
docker compose down         # stop it
```

### Option B — run it directly (Node 24 or newer)

You need Node 24+ and [pnpm](https://pnpm.io/installation).

```bash
git clone https://github.com/tfasanya79/tenancy-agreement.git
cd tenancy-agreement

corepack enable
pnpm install

cp .env.example .env          # Windows: copy .env.example .env
# put your DeepSeek key in .env

pnpm doctor                   # checks everything and tells you what is wrong
pnpm start
```

Open **http://localhost:3000**. Press `Ctrl+C` in the terminal to stop it.

> There is no build step. Node 24 runs the TypeScript source directly, so there is
> nothing to compile and nothing to forget.

### Getting a DeepSeek key

1. Sign in at <https://platform.deepseek.com>.
2. Create an API key under **API Keys**.
3. Paste it into `.env` as `DEEPSEEK_API_KEY=sk-...`.
4. Restart the app.

A tenancy pack is a handful of short requests, so the cost per tenant is small —
see [docs/DEEPSEEK.md](docs/DEEPSEEK.md) for model choice, cost shape and what is
sent to the provider.

---

## Your first document pack

The whole app is one screen: a list of packs on the left, four tabs on the right.

1. **New tenant pack** (top right). A pack is one tenancy.
2. **Assistant tab** — paste the landlord's email, or a WhatsApp thread, or just
   type: *"Tenant is Alex Morgan, 12 Bridge Street Flat 3 Manchester M1 2AB, rent
   £1,250 a month from 1 November, deposit £1,442, landlord Priya Raman of 4 Oak
   Lane Leeds."*
   You will see each step it takes, in plain English, as it takes it.
3. **Details tab** — every detail it collected, in a form you can correct. Anything
   the agreement needs that is still blank is marked **needed**, quietly rather than with an alarm.
4. **Checks tab** — errors that block you, warnings worth a look, and the statutory
   deadlines with a countdown.
5. **Documents tab** — tick what you want (the move-in set is pre-ticked), press
   **Generate selected documents**, then download:
   - **Word** — the file to send and sign
   - **Print / PDF** — opens a print-ready page; press Print → Save as PDF
   - **Source** — the expanded text, for checking wording
   - **Download all (ZIP)** — every document plus a contents sheet

Prefer typing to pasting? Fill in the Details tab by hand and skip the assistant
entirely. Everything except the AI works with no key at all.

---

## The documents

Ten templates ship with the project. They are drafted for the position in
England after **1 May 2026** — assured periodic tenancies, no section 21.

| Document | Category | In the move-in set |
| --- | --- | --- |
| Assured Periodic Tenancy Agreement | `tenancy` | ✅ |
| Written Statement of Terms | `tenancy` | ✅ |
| Deposit Prescribed Information | `deposit` | ✅ |
| Inventory and Check-In Report | `inventory` | ✅ |
| Right to Rent and Pre-Tenancy Checklist | `compliance` | ✅ |
| Tenant Welcome Pack | `welcome` | ✅ |
| Your Tenancy at a Glance *(plain-English summary for the tenant)* | `welcome` | ✅ |
| Guarantor Deed | `guarantee` | only if a guarantor is entered |
| Section 8 Notice | `possession` | on request only |
| Rent Increase Notice (section 13) | `rent-review` | on request only |

Each document is written out in three formats: `.docx`, `.html` (for printing to
PDF) and `.md` (the expanded source, so you can check every word).

---

## How the assistant is kept safe

This is the part that matters if you are going to let an AI near a tenancy
agreement. Four rules are built into the architecture, not just the prompt:

**1. The assistant cannot write clauses.**
Documents are rendered from your Markdown templates. The assistant's only way to
change a document is to fill in a field, and the field layer rejects any key that
is not in the catalogue ([`src/docs/fields.ts`](src/docs/fields.ts)). A model that
hallucinates "a £900 cleaning fee clause" has nowhere to put it.

**2. It is not allowed to guess a fact.**
The system prompt forbids inventing names, dates, amounts and certificate numbers,
and requires it to ask instead. Every step it takes is visible in the chat panel,
so a wrong value is visible rather than buried.

**3. The legal advice comes from a curated rule set, not from memory.**
When the assistant is unsure what the law requires it calls `lookup_rules`, which
searches [`src/knowledge/rules.ts`](src/knowledge/rules.ts) — 21 rules, each with a
source. You can read the whole set in [docs/RULES.md](docs/RULES.md).

**4. The checks are arithmetic, not opinions.**
The deposit cap, the 30-day deadline, the certificate dates: those are ordinary
date maths in [`src/docs/compliance.ts`](src/docs/compliance.ts). The same
calculation runs whether you ask the assistant or just look at the Checks tab.

Every assistant run is logged to the local database (`agent_runs`) with its steps
and token counts, so there is an audit trail of what was done and when.

### What that looks like in practice

```
You:  paste landlord email
TD:   Recording 6 details            — 4 still needed.
      Checking the rules on "deposit deadline" — 2 matching rules.
      All eight documents are ready to download.
```

---

## The compliance checks

Run automatically, every time, on every pack.

| Check | What it looks at |
| --- | --- |
| Essentials present | Landlord, property address, postcode, tenant name, start date, rent, deposit |
| Deposit cap | 5 weeks' rent (6 where annual rent is £50,000+) — *Tenant Fees Act 2019* |
| Holding deposit cap | 1 week's rent |
| Rent in advance | 1 month maximum |
| Deposit protection | Whether it is protected, and the 30-day deadline date |
| Gas safety | Present, and less than 12 months old at move-in |
| EICR | Present, and less than 5 years old |
| EPC | Present, and not band F or G |
| Right to rent | Check recorded |
| How to Rent guide | Given, with the date recorded |
| Alarms | Smoke and CO test recorded |
| Notice period | A tenant's two months is stated correctly |
| Agency disclosure | Client money protection and redress scheme named |

Nothing blocks document generation. That is deliberate: this is the agency's own paperwork, and they decide. In the default **relaxed** mode the app tells them what is outstanding and asks whether to carry on; what they chose is recorded on the pack. Warnings do not prompt at all — sometimes the right answer is
"yes, I know, and it is fine", and the app is not going to argue with you.

The Checks tab also shows the **statutory deadlines** for the pack: the date the
deposit and prescribed information must be protected by, the date the written
statement must be given by, when the next gas safety check falls due, and when the
EICR expires.

---

## The agent's toolbox

The app deliberately does one job. These are the small, boring tools that fill the
gaps — all optional, all cheap, none of them required.

| Job | Easy options | How it fits here |
| --- | --- | --- |
| **E-signature** | Dropbox Sign, DocuSign, Signable | Upload the `.docx` from TenancyDesk |
| **Deposit protection** | TDS, DPS, MyDeposits | You still protect it in the scheme; TenancyDesk gives you the date and the prescribed information |
| **Referencing & right to rent** | Canopy, Credas, Homelet | Record the check date in the pack |
| **Rent ledger & accounts** | Xero, FreeAgent, Hammock | Separate concern — export nothing, just keep the two in step |
| **Compliance reminders** | Your calendar, or the deadlines here | Checks tab shows the dates; put them in your diary |
| **Storage & backup** | OneDrive, Google Drive, Dropbox | The ZIP download drops straight into a folder per tenancy |

[**docs/TOOLBOX.md**](docs/TOOLBOX.md) has the full list: ten categories, what each
costs, how each one connects, an end-to-end walkthrough from enquiry to move-in,
and the complexity this project deliberately avoided.

**If you set up only three things:** an e-signature account, a deposit scheme
account, and a backup folder.

---

## Editing the documents

Templates are ordinary Markdown files in [`templates/`](templates/). Open one in any
text editor, change the wording, save, restart the app. That is the whole workflow.

```markdown
---
id: apt-agreement
title: Assured Periodic Tenancy Agreement
category: tenancy
required: [landlord.full_name, property.address_line1, tenancy.start_date]
---
# Assured Periodic Tenancy Agreement

This tenancy is between **{{landlord.full_name}}** and the tenant(s) named below…

The rent is {{tenancy.rent_amount|money}}, payable {{tenancy.rent_due_day}}.

{{#if tenancy.pets_allowed == "Yes"}}
A pet is permitted: {{tenancy.pet_details}}.
{{/if}}
```

| Syntax | Meaning |
| --- | --- |
| `{{landlord.full_name}}` | Insert a detail |
| `{{tenancy.rent_amount\|money}}` | …formatted as `£1,250` |
| `{{tenancy.start_date\|date}}` | …as `1 November 2026` (`dateordinal` → `1st`, `dateshort` → `01/11/2026`) |
| `{{#if x}}…{{else}}…{{/if}}` | Include a block only when something is filled in |
| `{{#if x == "Yes"}}…{{/if}}` | Compare a dropdown value (`!=` and `!x` also work) |
| `{{#each tenants}}…{{this.full_name}}…{{/each}}` | Repeat per tenant — use for signature blocks |

After editing, run `pnpm sample` to see the result rendered, and `pnpm test` to
check nothing broke. Full syntax, the field list and how to add a whole new
document type: [docs/TEMPLATES.md](docs/TEMPLATES.md).

> **Editing tip:** a dropdown such as pets holds the word `No`, which is *truthy*.
> Use `{{#if tenancy.pets_allowed == "Yes"}}` rather than `{{#if tenancy.pets_allowed}}`.

---

## Configuration

Everything lives in `.env`. Only the first line matters.

| Variable | Default | What it does |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | — | **Required** for the assistant |
| `DEEPSEEK_MODEL` | `deepseek-chat` | Must be a tool-calling model; `deepseek-reasoner` is not compatible |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | Change only if you use a proxy |
| `PORT` | `3000` | Web port |
| `DATA_DIR` | `./data` | Database and generated documents |
| `AGENCY_NAME` `AGENCY_EMAIL` `AGENCY_PHONE` `AGENCY_ADDRESS` | — | Pre-filled onto every new pack |
| `AGENCY_CLIENT_MONEY_SCHEME` `AGENCY_REDRESS_SCHEME` | — | Required disclosures; the checks warn if blank |
| `OFFLINE_MODE` | `false` | `true` runs everything except the assistant |

---

## How it is built

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | Node 24+, TypeScript run directly | No build step, no bundler, no `dist/` to go stale |
| Server | [Fastify 5](https://fastify.dev) | Small, fast, and honest about errors |
| Storage | SQLite via `node:sqlite` | Built into Node — no native module to compile, no database server to run |
| Documents | `docx` for Word, generated HTML for print | No LibreOffice or headless Chrome needed to make a PDF |
| Interface | Vanilla HTML/CSS/JS, one page | Nothing to build, nothing to keep updated |
| Assistant | DeepSeek chat-completions + function calling | Cheap, fast, and good at structured extraction |
| Dependencies | Three at runtime | Fewer things to break, update or audit |

Design notes, request flow and the trade-offs behind each choice:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Project layout

```
tenancy-agreement/
├── src/
│   ├── server.ts              entry point — starts the web server
│   ├── app.ts                 every HTTP route
│   ├── config.ts              .env reading
│   ├── db.ts                  SQLite: packs, documents, agent runs
│   ├── docs/
│   │   ├── fields.ts          the catalogue of details a pack holds
│   │   ├── template.ts        {{placeholder}} engine
│   │   ├── markdown.ts        the small Markdown parser
│   │   ├── toDocx.ts          → Word
│   │   ├── toHtml.ts          → print-ready page
│   │   ├── registry.ts        loads templates/, works out what is missing
│   │   ├── compliance.ts      the arithmetic checks
│   │   ├── generate.ts        renders everything and writes the files
│   │   ├── packSummary.ts     the contents sheet in the ZIP
│   │   ├── templateAudit.ts   checks an uploaded agreement against the law
│   │   └── docxFill.ts        fills an agency's own .docx without losing formatting
│   ├── agent/
│   │   ├── deepseek.ts        API client with retries
│   │   ├── loop.ts            the tool-calling loop
│   │   ├── tools.ts           the eight tools, and their guards
│   │   └── prompts.ts         the system prompt
│   ├── backoffice/
│   │   ├── entities.ts        landlords, properties, rooms, tenants, agency settings
│   │   ├── inheritance.ts     the prefill layers, and where each value came from
│   │   ├── context.ts         a tenancy merged with the records it points at
│   │   └── migrate.ts         derives records from packs that already exist
│   ├── util/zip.ts            reads and writes ZIP (Word files are ZIPs)
│   └── knowledge/rules.ts     the curated rule set
├── templates/                 ← the documents. edit these.
├── public/                    the interface (index.html, app.js, styles.css)
├── tests/                     251 tests
├── scripts/                   doctor · sample · rules
├── samples/                   a finished example pack
├── docs/                      the manuals
├── Dockerfile · docker-compose.yml
└── .env.example
```

---

## Commands

| Command | What it does |
| --- | --- |
| `pnpm start` | Run the app |
| `pnpm dev` | Run it and restart on file changes |
| `pnpm doctor` | Check Node, `.env`, templates, data folder, key, port — and say what to fix |
| `pnpm test` | Run the 251 tests |
| `pnpm typecheck` | TypeScript, no build |
| `pnpm docs:check` | Fail if the documentation disagrees with the code — commands, paths, test counts |
| `pnpm golden` | Record the rendered text of every template, so a wording change is a deliberate act |
| `pnpm sample` | Rebuild `samples/` from the templates |
| `pnpm demo:fill` | Show the "use our own Word document" engine filling an example agreement |
| `pnpm repair:contracts` | Produce corrected copies of an agency's own contracts, with a change log (needs their files in `received from the client/`) |
| `pnpm rules` | Regenerate `docs/RULES.md` from the rule set |

---

## The law, and what this is not

**TenancyDesk is software, not a solicitor.** It assembles documents from templates
that ship with the project. Those templates are complete, sane starting points —
they are not a substitute for advice from a qualified professional, and this
project cannot know the facts of your tenancy.

Please read these plainly:

- **Tenancy law changes, and it has just changed a lot.** Phase 1 of the Renters'
  Rights Act 2025 took effect on **1 May 2026**: section 21 is abolished, fixed
  terms are replaced by assured periodic tenancies, rent increases follow section
  13 on two months' notice, and no more than one month's rent may be taken in
  advance. The shipped templates are drafted for that position.
- **The rule set was last reviewed on 2026-10-19** and is dated in
  [docs/RULES.md](docs/RULES.md). Phase 2 (the PRS Database and the Landlord
  Ombudsman) and Phase 3 (Decent Homes, Awaab's Law) are still being brought into
  force. Check GOV.UK before relying on anything here.
- **Always read what you are about to sign.** The app shows you the expanded source
  of every document precisely so that you can.
- **The assistant can be wrong.** It is good at pulling names and dates out of an
  email. It is not an authority, and it is not permitted to write clauses.

---

## Your data and security

Tenant names, dates of birth, addresses, ID references and every generated document
are stored in `./data`. That is personal data under UK GDPR, and you are the data
controller.

- **There is no login.** Run it on your own machine, or put it behind a VPN or an
  authenticating proxy. Do not expose port 3000 to the internet. The supplied
  `docker-compose.yml` binds to `127.0.0.1` for exactly this reason.
- **`data/` and `.env` are git-ignored** so they cannot be committed by accident.
- **The only outbound traffic is to your AI provider.** The details you enter are
  sent to DeepSeek so the assistant can work; nothing else leaves the machine. There
  is no telemetry and no analytics.
- **Back up `./data`** — it contains the only copy of your packs.

Full detail, including a hardening checklist: [SECURITY.md](SECURITY.md) and
[docs/DEPLOY.md](docs/DEPLOY.md).

---

## Troubleshooting

Run `pnpm doctor` first — it checks all of this and tells you what to fix.

| Symptom | Fix |
| --- | --- |
| "No DeepSeek API key" / assistant is off | Put `DEEPSEEK_API_KEY=sk-...` in `.env` and restart. Everything except the assistant works without it. |
| "DeepSeek rejected the API key" | The key is wrong, revoked, or has trailing spaces in `.env` |
| "No templates found" | Run the app from the project root, where `templates/` lives |
| Port already in use | Change `PORT` in `.env` |
| Assistant says it cannot reach DeepSeek | No internet, or a proxy/firewall is blocking `api.deepseek.com` |
| Generated file has an empty field | That detail was never entered — check the Details tab for red asterisks |
| "Documents generated but cannot download" | The file was deleted from `./data/documents` — generate again |
| Assistant rambles or repeats | Try a narrower instruction, or fill the Details tab by hand |

---

## Documentation

| Document | For |
| --- | --- |
| [docs/USING-THE-APP.md](docs/USING-THE-APP.md) | The letting agent — day-to-day use, no jargon |
| [docs/TOOLBOX.md](docs/TOOLBOX.md) | The letting agent — the other tools worth having |
| [docs/TEMPLATES.md](docs/TEMPLATES.md) | Editing and adding documents |
| [docs/RULES.md](docs/RULES.md) | The England & Wales rule set, with sources |
| [docs/DEEPSEEK.md](docs/DEEPSEEK.md) | Keys, models, cost, privacy |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Developers — how it works and why |
| [docs/API.md](docs/API.md) | Developers — the HTTP API |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Running it on a server, and backing it up |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What is being built next, in what order, and how we will know it is done |
| [docs/BACKOFFICE.md](docs/BACKOFFICE.md) | Design for the back office: landlords, properties, rooms, tenants, prefilled forms |
| [docs/TENANT-RECORDS.md](docs/TENANT-RECORDS.md) | Exactly what the client's documents record — the authoritative field list |
| [SECURITY.md](SECURITY.md) | Data handling and hardening |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Changing templates, rules or code |

---

## Status and roadmap

**v1.0.0** — working and tested, with the "bring your own document" work in progress.

| Area | State |
| --- | --- |
| Document pipeline (Word, print HTML, Markdown, ZIP) | ✅ 251 tests passing |
| Compliance checks and deadlines | ✅ |
| Agent loop, tools, guards, audit log | ✅ tested against a mocked transport |
| Live DeepSeek call | ✅ verified end-to-end against the real API — one pasted email produced 17 fields, four rule lookups, the checks, six documents and three notes |
| Room-by-room lettings | ✅ `property.room_number`, first payment date derived from the start date |
| Back office — landlords, properties, rooms, tenants | ✅ records, screens, and a migration that links the packs you already have |
| Prefilled forms | ✅ a new tenancy in an existing room needs three typed details; every other value is inherited and labelled with where it came from |
| Tenancy lifecycle | ✅ upcoming, active, ending, ended — the pack list is grouped by it |
| Shared values warn before they change | ✅ editing a room's rent says how many tenancies inherit it and asks first |
| What's due, across every tenancy | ✅ a dashboard sorted by urgency, plus one-click .ics export into their calendar |
| Let several rooms at once | ✅ one form, one pack per tenant, each with its own room and documents |
| Backup and health | ✅ one click downloads the database, every document and every upload, with restore instructions |
| Agency settings | ✅ edit your details in the app instead of a config file |
| Agreement audit — is an uploaded document still current? | ✅ flags assured shorthold, section 21, fixed terms and vague rent reviews |
| Proofreading a document for internal contradictions | ✅ a weekday that does not match its date, two different rent due days, a fixed late-payment fee, a mistyped ordinal |
| Repairing an agency's own contracts | ✅ `pnpm repair:contracts` rewrites the defective clauses in place, keeps the layout, and logs every change for sign-off |
| Evidence trail and 'Why?' | ✅ a printable history of every document and note, and each check explains itself with its source |
| Filling an agency's own `.docx` without losing its formatting | ✅ engine and tests; `pnpm demo:fill` shows it working |
| Upload screen for a custom document | ✅ Back office → Our documents: upload, review the mapping, then fill it per tenant |
| Recognising a document's variable parts | ✅ by shape and by the nearest explaining words; anything ambiguous is marked ''choose'' rather than guessed |
| Accounts, multi-user | ✗ by design |
| Sending email, e-signature | ✗ out of scope — see [docs/TOOLBOX.md](docs/TOOLBOX.md) |

Planned next, roughly in order: the upload → confirm-the-links → fill screen ·
calendar reminders (`.ics`) exported from the deadline list · a cross-pack
dashboard of upcoming deadlines · a per-pack activity history view · optional PDF
output when LibreOffice is present · tenancy renewal and end-of-tenancy packs.

---

## Contributing

The three things people usually want are changing a document's wording, adding a
new document type, and changing a compliance rule. All three are covered step by
step in [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
pnpm install
pnpm test        # 251 tests
pnpm typecheck
```

Please do not paste copyrighted third-party templates into this repository, and
cite a source for anything legal.

---

## License

[MIT](LICENSE). The templates are illustrations of how the software works — see the
note at the bottom of the license, and the disclaimer above.
