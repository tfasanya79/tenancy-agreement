# Changelog

All notable changes to this project. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

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
