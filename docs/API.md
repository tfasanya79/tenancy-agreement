# TenancyDesk HTTP API

TenancyDesk serves a small JSON API from the same Fastify process that serves its
single page. The base URL is `http://localhost:3000` (from `PORT`; `HOST` defaults
to `0.0.0.0`). Requests and responses are JSON, except for file downloads and the
assistant stream. There is no authentication, no session and no CORS
configuration: this is a single-user tool on the operator's own machine. Errors are
always `{ "error": "message" }`, with a human-readable sentence, from `notFound()`,
`badRequest()` or the shared error handler in `src/app.ts` (which uses the error's
own `statusCode`, or `500`). Messages are written for a letting agent to read —
show them rather than matching on them.

Body limit is 2 MB (`bodyLimit` in `src/app.ts`); larger bodies get `413`. Fastify's
logger is off unless `NODE_ENV=production`. Field values in `fields` are coerced by
`normaliseFields()` in `src/docs/fields.ts`: unknown keys are dropped, empty values
are dropped so they never overwrite, money becomes a number (a `£`, commas and
spaces are stripped), dates become `YYYY-MM-DD` (`dd/mm/yyyy` is converted), and a
`people` array such as `tenants` replaces the stored list wholesale.

## Route summary

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness, row counts, template count and warnings, assistant availability |
| `GET` | `/api/config` | Agency details, model, offline flag, rules review date, prompts, core keys |
| `GET` | `/api/fields` | The field catalogue, groups and `.env` mapping |
| `GET` | `/api/templates` | Loaded templates, with required fields still missing |
| `GET` | `/api/rules?q=` | Search the curated England & Wales rule set |
| `GET` | `/api/packs` | List packs as summary rows |
| `POST` | `/api/packs` | Create a pack, seeded with agency details from `.env` |
| `GET` | `/api/packs/:id` | One pack plus readiness, documents, templates, suggested set |
| `PATCH` | `/api/packs/:id` | Merge fields and/or set the status |
| `DELETE` | `/api/packs/:id` | Delete the pack row and its document/run rows |
| `POST` | `/api/packs/:id/notes` | Append an internal note |
| `DELETE` | `/api/packs/:id/notes/:noteId` | Remove one note |
| `POST` | `/api/packs/:id/checks` | Run the deterministic compliance checks now |
| `POST` | `/api/packs/:id/preview` | Render one template to HTML without saving |
| `POST` | `/api/packs/:id/generate` | Write DOCX, HTML and MD files |
| `GET` | `/api/documents/:id/download` | Download a generated file (`docx`, `html`, `md`) |
| `GET` | `/api/packs/:id/bundle.zip` | ZIP of the summary sheet and every DOCX |
| `GET` | `/api/packs/:id/runs` | The last 20 assistant runs for the pack |
| `POST` | `/api/packs/:id/assistant` | Talk to the assistant; `text/event-stream` |

`@fastify/static` also serves `public/` at `/` with `index.html` as the index.
Those are static files, not API routes.

Five routes return the pack detail wrapper built by `packDetail()`:

```json
{ "pack": { "id": "afd913b4-…", "reference": "TD-2026-0007", "tenantName": "Alex Morgan & Sam Okafor",
    "propertyAddress": "12 Alder Road, Stockport, SK2 6HH", "status": "generated", "notes": [], "coverMessage": null },
  "readiness": { "ready": true, "missingCore": [], "compliance": { "findings": [], "deadlines": [], "ok": true } },
  "documents": [], "templates": [], "suggested": ["apt-agreement"] }
```

Field values sit under `pack.fields` as a flat map, e.g.
`{ "landlord.full_name": "Priya Raman", "tenancy.rent_amount": 1250 }`.

`tenantName` and `propertyAddress` are derived on write by `tenantNameFrom()` and
`propertyAddressFrom()` (`src/db.ts`) — you cannot set them. `readiness` comes from
`assessPack()`: `ready` means the compliance report holds no `missing-*` finding.
`templates` is `registry.list()` (per-document `missing` = that template's own
required keys still blank). `suggested` is `registry.suggestSelection()`: category
order `tenancy`, `deposit`, `inventory`, `compliance`, `welcome`, `guarantee`, with
`guarantee` only when `guarantor.full_name` is set. Templates in other categories
(today `rent-review`, `possession`) are never suggested — ask for them by id.

## Meta

Five read-only endpoints, all returning `200`.

**`GET /api/health`** — no body, no query.

```json
{ "ok": true, "store": { "packs": 3, "documents": 12, "runs": 5 }, "templates": 9,
  "templateWarnings": [], "assistantAvailable": true, "model": "deepseek-chat", "offlineMode": false }
```

`assistantAvailable` is computed once in `buildApp()` as
`!config.offlineMode && client.configured`; changing the key needs a restart.

**`GET /api/config`** — no body, no query.

```json
{ "agency": { "name": "Northgate Lettings", "email": "hello@northgate.example", "phone": "0161 000 0000",
    "address": "4 Mill Street, Stockport SK1 1AA", "clientMoneyScheme": "Client Money Protect",
    "redressScheme": "The Property Ombudsman" },
  "assistantAvailable": true, "model": "deepseek-chat", "offlineMode": false, "rulesReviewedOn": "2026-10-19",
  "templateWarnings": [], "coreFields": ["landlord.full_name", "tenants"],
  "examplePrompts": [{ "title": "Start from an email", "prompt": "Paste the landlord’s email …" }] }
```

**`GET /api/fields`** — no body, no query. `type` is one of `text`, `date`,
`money`, `number`, `select`, `textarea`, `people`.

```json
{ "groups": [{ "id": "tenants", "title": "The tenant(s)", "blurb": "Everyone named on the tenancy, …" }],
  "fields": [{ "key": "tenancy.rent_amount", "label": "Rent", "type": "money", "group": "tenancy", "core": true },
             { "key": "tenants", "label": "Tenants", "type": "people", "group": "tenants", "core": true,
               "children": [{ "key": "full_name", "label": "Full name", "type": "text", "core": true }] }],
  "envDefaults": { "agent.company_name": "AGENCY_NAME", "agent.email": "AGENCY_EMAIL" } }
```

**`GET /api/templates`** — no body, no query.

```json
{ "templates": [{ "id": "apt-agreement", "title": "Assured Periodic Tenancy Agreement", "category": "tenancy",
    "version": "2.0", "updated": "2026-10-01", "required": ["landlord.full_name"],
    "placeholders": ["doc.reference"], "unknownPlaceholders": [], "sourcePath": "apt-agreement.md",
    "missing": ["landlord.full_name"] }], "warnings": [] }
```

Called without a pack, `missing` lists every required key, because the fields
argument defaults to `{}`. Load a pack to get a meaningful value.

**`GET /api/rules?q=`** — `q` optional; empty or missing returns the whole set in
file order. Matching is word-overlap scoring over topic, title, summary and detail
(`searchRules()`); words of three characters or fewer are ignored.

```bash
curl "http://localhost:3000/api/rules?q=deposit%20deadline"
```

```json
{ "rules": [{ "id": "deposit-protection", "topic": "deposit",
    "title": "Deposits must be protected within 30 days, with prescribed information",
    "summary": "A tenancy deposit must be protected in a government-approved scheme within 30 days …",
    "source": { "label": "GOV.UK — Tenancy deposit protection guidance", "url": "https://www.gov.uk/tenancy-deposit-protection" } }],
  "reviewedOn": "2026-10-19" }
```

The rule set is static; no rule can be edited through the API.

## Packs

**`GET /api/packs`** — no body. Newest `updatedAt` first, built by
`packSummaryView()`. Statuses: `200`.

```json
{ "packs": [{ "id": "afd913b4-…", "reference": "TD-2026-0007", "tenantName": "Alex Morgan & Sam Okafor",
    "propertyAddress": "12 Alder Road, Stockport, SK2 6HH", "status": "generated", "documentCount": 6,
    "errorCount": 0, "warningCount": 2, "ready": true, "updatedAt": "2026-10-19T09:14:52.884Z" }] }
```

**`POST /api/packs`** — body `{ "fields": { … } }`, optional. Values are normalised
and merged on top of the non-empty agency defaults from `.env` (`AGENCY_NAME`,
`AGENCY_EMAIL`, `AGENCY_PHONE`, `AGENCY_ADDRESS`, `AGENCY_CLIENT_MONEY_SCHEME`,
`AGENCY_REDRESS_SCHEME`) by `agencyFallback()`. Responds `201` with the pack detail.

```bash
curl -X POST http://localhost:3000/api/packs -H 'Content-Type: application/json' \
  -d '{ "fields": { "landlord.full_name": "Priya Raman", "tenancy.rent_amount": "£1,250" } }'
```

```json
{ "pack": { "id": "afd913b4-…", "reference": "TD-2026-0007", "status": "draft",
    "fields": { "agent.company_name": "Northgate Lettings", "landlord.full_name": "Priya Raman", "tenancy.rent_amount": 1250 } },
  "readiness": { "ready": false, "missingCore": ["landlord.address", "property.address_line1"],
    "missingLabels": ["Landlord's address", "Address line 1"] },
  "documents": [], "templates": [ … ], "suggested": ["apt-agreement", "deposit-prescribed-information"] }
```

`"£1,250"` came back as `1250`. Statuses: `201`, `413`, `500`. The reference is
`TD-<year>-<count+1>` from `SELECT COUNT(*) … WHERE reference LIKE 'TD-<year>-%'`;
the column is `UNIQUE`, so a pack deleted from the middle of a year's sequence can
make the next create collide and surface as `500`.

**`GET /api/packs/:id`** — no body. Statuses: `200`, `404`
(`{ "error": "That pack no longer exists." }`) for any id not in the database,
malformed ids included, since lookup is literal.

**`PATCH /api/packs/:id`** — body may hold `fields` (key → value, merged) and/or
`status` (one of `draft`, `ready`, `generated`, `sent`; anything else is ignored and
the stored value kept). Responds with the refreshed pack detail.

```bash
curl -X PATCH http://localhost:3000/api/packs/afd913b4-… -H 'Content-Type: application/json' \
  -d '{ "fields": { "property.postcode": "sk2 6hh" }, "status": "ready" }'
```

Statuses: `200`, `404`, `413`, `500`. `{ "status": "banana" }` is not an error: the
response is `200` with the previous status.

**`DELETE /api/packs/:id`** — no body. Deletes the pack row; `documents` and
`agent_runs` rows go too (`ON DELETE CASCADE`, with `PRAGMA foreign_keys = ON`).
Files under `data/documents/<pack-id>/` are **not** deleted, though the interface's
confirmation says "The generated documents are removed too". Statuses: `204`
(empty body), `404`.

## Notes

**`POST /api/packs/:id/notes`** — body `{ "text": "Protect the deposit by 30
November" }`, trimmed; blank is rejected. Each note gets `crypto.randomUUID()` and
a `createdAt`. Success is `200` (not `201`) and the response is the raw `pack`
object, not the detail wrapper.

```json
{ "pack": { "id": "afd913b4-…", "notes": [{ "id": "5c1f…", "text": "Protect the deposit by 30 November", "createdAt": "2026-10-19T09:12:04.221Z" }] } }
```

Statuses: `200`, `400` (`{ "error": "Write something first." }`), `404`.

**`DELETE /api/packs/:id/notes/:noteId`** — no body. Removes matching notes; an
unknown `noteId` is not an error and the pack comes back unchanged. Returns the raw
`pack`. Statuses: `200`, `404` (unknown pack).

## Checks

**`POST /api/packs/:id/checks`** — no body. Runs `runComplianceChecks()` on the
stored fields with the server's current date and returns the report directly; it
changes nothing. This is the same code the assistant reaches through its
`check_compliance` tool, so the browser and the model never disagree. There is no
way to pass a different "today".

```json
{ "findings": [
    { "id": "deposit-not-protected", "severity": "warning", "title": "Deposit not yet protected",
      "detail": "Protect the deposit in a scheme and serve the prescribed information by 2026-11-19.",
      "fields": ["tenancy.deposit_scheme"], "ruleId": "deposit-protection" },
    { "id": "how-to-rent-missing", "severity": "warning", "title": "How to Rent guide not recorded as given",
      "detail": "Give the tenant the current How to Rent guide at the start of the tenancy.",
      "fields": ["safety.how_to_rent_date"], "ruleId": "how-to-rent" }],
  "deadlines": [{ "id": "written-statement", "label": "Give the tenant the written statement of terms",
      "date": "2026-11-29", "detail": "Twenty-eight days from the start of the tenancy on 2026-11-01." }],
  "counts": { "error": 0, "warning": 2, "info": 0 }, "ok": true }
```

`severity` is `error`, `warning` or `info`; `ok` is true when there are no errors;
deadlines are sorted by date. Statuses: `200`, `404`.

## Documents

**`POST /api/packs/:id/preview`** — body `{ "templateId": "apt-agreement" }`.
Renders the current fields into a stand-alone HTML page and returns the string;
nothing is written to disk and no `documents` row is created. The page is built
with `embedded: true`, so it has no print toolbar. Statuses: `200`, `400`
(`{ "error": "Unknown document." }` when `templateId` is missing or not in the
registry), `404`.

```json
{ "html": "<!doctype html>\n<html lang=\"en-GB\">…", "missing": ["tenancy.rent_frequency"],
  "title": "Assured Periodic Tenancy Agreement" }
```

`missing` only reports placeholders the template lists under `required`, so
optional gaps never flood it.

**`POST /api/packs/:id/generate`** — body `{ "templateIds": ["apt-agreement"] }`.
Omit the key, or send an empty array, to generate the suggested selection. Writes
three files per document into `data/documents/<pack-id>/` — `<slug>.docx`,
`<slug>.html`, `<slug>.md` — replacing any previous row for that `templateId`. The
pack status becomes `generated` unless it is already `sent`. Statuses: `200`, `400`
(`Unknown document(s): …`), `404`, `500` if a file cannot be written.

```bash
curl -X POST http://localhost:3000/api/packs/afd913b4-…/generate \
  -H 'Content-Type: application/json' -d '{ "templateIds": ["apt-agreement"] }'
```

```json
{ "documents": [{ "id": "0b1e…", "packId": "afd913b4-…", "templateId": "apt-agreement",
    "title": "Assured Periodic Tenancy Agreement", "docxPath": "documents/afd913b4-…/apt-agreement.docx",
    "htmlPath": "documents/afd913b4-…/apt-agreement.html", "mdPath": "documents/afd913b4-…/apt-agreement.md",
    "checksum": "9f3c1a77b204e5d8", "byteSize": 41233, "generatedAt": "2026-10-19T09:14:52.884Z", "missing": [] }],
  "pack": { "pack": { … }, "readiness": { … }, "documents": [ … ], "templates": [ … ], "suggested": [ … ] } }
```

`missing` is the template's required fields that were blank at render time;
`checksum` is the first 16 hex characters of the DOCX's SHA-256 and `byteSize` its
byte length. Unlike the assistant's `generate_documents` tool, this route does
**not** refuse when compliance reports errors — the HTTP path generates whatever
you ask for.

**`GET /api/documents/:id/download`** — query `format` (`docx` default, `html`,
`md`) and `inline` (`1` or `true` to send `Content-Disposition: inline` instead of
`attachment`). Statuses: `200`, `400` (`Invalid path.` — the stored path would
escape the data directory), `404` (`That document is no longer available.`,
`No <format> version of that document.`, or `The generated file has been removed
from disk. Generate it again.`).

```bash
curl -OJ "http://localhost:3000/api/documents/0b1e…/download?format=docx"
```

```
Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
Content-Disposition: attachment; filename="TD-2026-0007 - Assured Periodic Tenancy Agreement.docx"; filename*=UTF-8''…
```

`text/html; charset=utf-8` is used for `html` and `text/markdown; charset=utf-8` for
`md`. The filename is `"<pack reference> - <document title>.<ext>"`, with
`\/:*?"<>|` replaced by dashes and the result cut to 90 characters. `inline=1` is
how the "Print / PDF" button opens the HTML copy so the browser can save a PDF.

## Bundle

**`GET /api/packs/:id/bundle.zip`** — no body, no query. Builds a ZIP in memory
with `createZip()` from `src/util/zip.ts`, a stored (uncompressed) archive written
by hand so no dependency is needed. Contents, in order: `00 - Pack summary.txt`
(from `buildPackSummaryText()`: reference, tenant, property, agency, what is in the
pack, key dates, findings, blank fields, notes, cover message, rule-set review
date) and then one
`<pack reference> - <document title>.docx` per generated document. HTML and MD
copies are not included, and a document whose file has gone missing from disk is
skipped rather than failing the download.

```bash
curl -OJ http://localhost:3000/api/packs/afd913b4-…/bundle.zip
```

Statuses: `200`, `400` (`Generate some documents first, then download them
together.`), `404`.

## Runs

**`GET /api/packs/:id/runs`** — no body. Up to 20 runs, newest first, as saved by
`runAgent()`. Statuses: `200`, `404`.

```json
{ "runs": [{ "id": "e7a2…", "packId": "afd913b4-…", "kind": "chat", "model": "deepseek-chat",
    "promptTokens": 4120, "completionTokens": 388,
    "steps": [{ "index": 0, "tool": "set_fields", "args": { "fields": { "landlord.full_name": "Priya Raman" } },
      "ok": true, "summary": "Recorded 1 detail; 6 still needed." }],
    "summary": "I recorded the landlord. Please give me the property address.",
    "createdAt": "2026-10-19T09:20:31.442Z" }] }
```

`steps` holds tool calls only — name, arguments, success flag, one-line summary —
not the chat transcript. `summary` is the final assistant text cut to 500
characters.

## Assistant

**`POST /api/packs/:id/assistant`** — body
`{ "message": "The landlord is Priya Raman of 4 Beechwood Terrace, Leeds LS6 2AA" }`.

This route is unlike the others: after validating, it calls `reply.hijack()` and
writes the stream itself.

```ts
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
```

Each event is one line, then a blank line:

```ts
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
```

There are no `event:` names, ids or retry hints — switch on the `type` field inside
the JSON. The stream closes after `done` (or `fatal`). The browser keeps the
conversation in memory only: reload and it is gone, and no history is sent back to
the server.

Rejections happen **before** the stream opens, as ordinary JSON: `400` for a
missing or whitespace-only `message` (`{ "error": "Type a message first." }`),
`404` for an unknown pack, `503` when `OFFLINE_MODE` is on or no
`DEEPSEEK_API_KEY` is set (the message says which; this check runs before the
message check, so a key-less install answers `503` even for a blank message). Once
the stream is open the status is `200` and problems arrive as events.

| `type` | Fields | Meaning |
| --- | --- | --- |
| `start` | `model` | Run begun; sent once, before the first model call |
| `tool` | `name`, `detail` | A tool call is about to run; `detail` is a phrase such as `"Recording 2 details"` |
| `tool_result` | `name`, `ok`, `summary` | What the tool did, in one sentence, and whether it worked |
| `message` | `text` | The assistant's final reply |
| `usage` | `promptTokens`, `completionTokens` | Totals summed over every model call in the run |
| `error` | `message` | The run failed; `runAgent()` emits this and then rethrows |
| `done` | `text`, `steps`, `runId` | Run finished; `steps` counts tool calls, `runId` is `null` if logging failed |
| `fatal` | `message` | Unrecoverable: the route caught a throw from `runAgent()` and is closing |

`fatal` comes from the route, not `runAgent()`, so a failing run sends `error` then
`fatal` and never `done`. A normal run sends `start`, zero or more
`tool`/`tool_result` pairs, then `usage`, `message` and `done`.

```
data: {"type":"start","model":"deepseek-chat"}

data: {"type":"tool","name":"set_fields","detail":"Recording 2 details"}

data: {"type":"tool_result","name":"set_fields","ok":true,"summary":"Recorded 2 details; 6 still needed."}

data: {"type":"usage","promptTokens":4120,"completionTokens":388}

data: {"type":"message","text":"I have recorded the landlord's name and address. Next I need the postcode and the start date."}

data: {"type":"done","text":"I have recorded the landlord's name and address. Next I need the postcode and the start date.","steps":1,"runId":"e7a2…"}

```

Reading it with `fetch`, as `sendMessage()` in `public/app.js` does:

```js
async function ask(packId, message) {
  const response = await fetch(`/api/packs/${packId}/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `The assistant could not be reached (${response.status}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n'); // frames end with a blank line
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      const line = frame.split('\n').find((part) => part.startsWith('data: '));
      if (line === undefined) continue;
      let event;
      try { event = JSON.parse(line.slice(6)); } catch { continue; }
      if (event.type === 'tool_result') console.log(`${event.name}: ${event.summary}`);
      if (event.type === 'message') console.log(event.text);
      if (event.type === 'error' || event.type === 'fatal') console.error(event.message);
    }
  }
}
```

Buffer until you see `\n\n`: a read can end mid-frame, and splitting per chunk
loses events.

## Extending it

**Add a route.** Routes live in `buildApp()` in `src/app.ts`, grouped by banners
(`// --- meta ---`, `// --- packs ---`, `// --- documents ---`,
`// --- the assistant ---`). Reuse the helpers so responses stay uniform:
`notFound(reply, message)`, `badRequest(reply, message)`, `paramId(request)` for
`:id`, and `packDetail(pack)` when the route is pack-shaped. Return a plain object
for `200`, otherwise `reply.code(…)`. There is no schema validation layer, so cast
the body yourself — `(request.body ?? {}) as Record<string, unknown>` — then
type-check individual keys, as every existing route does.

**Add a detail to collect.** Add one entry to `FIELDS` in `src/docs/fields.ts`:

```ts
  { key: 'tenancy.parking_permit', label: 'Parking permit number', type: 'text', group: 'tenancy' },
```

The key is a flat string that only looks nested. `type` drives normalisation,
`group` picks the form section, `options` supplies a `select` list, and `core: true`
adds the key to `CORE_FIELDS`, and so to the missing-essentials errors and
`assessPack().missingCore`. Nothing else needs editing: the form, `GET
/api/fields`, the allow-list in `normaliseFields()` and the assistant's system
prompt all read that one array. Then use `{{tenancy.parking_permit}}` in a
template. If the value can come from `.env`, add it to `ENV_DEFAULTS` and to
`agencyFallback()` in `src/app.ts`.

**Add an agent tool.** In `src/agent/tools.ts`: (1) add an entry to
`TOOL_DEFINITIONS` with a `name`, a `description` written for the model and a
JSON-schema `parameters` object — `TOOL_NAMES` derives from that array, so
registration is automatic; (2) add a `case '<name>':` to the `switch` in
`executeTool()` returning `{ ok: true, result }` or
`{ ok: false, result: { error: '…' } }` (the surrounding `try/catch` turns a throw
into a failed outcome, which is fed back to the model rather than crashing the
run); (3) add a phrase to `describeToolCall()` for the activity feed and a case to
`summarise()` in `src/agent/loop.ts` for the one-line result. Update
`tests/agent.test.ts`, which asserts the exact sorted list of tool names. Keep the
rule that a tool writes only through `mergeFields()` or another allow-list — that
is what stops the model inventing fields.

**Add a template.** Drop a Markdown file into `templates/` with front matter:

```yaml
---
id: noise-nuisance-warning
title: Noise and Nuisance Warning Letter
category: compliance
jurisdiction: england-wales
version: "1.0"
updated: "2026-10-01"
description: A warning letter about antisocial behaviour.
required: [property.address_line1, tenants, tenancy.start_date]
---
```

`id` is used by the API, the assistant and the generated filenames; a missing or
duplicate `id` is skipped with a warning. `category` decides whether the document
is suggested — only `tenancy`, `deposit`, `inventory`, `compliance`, `welcome` and
`guarantee` are, in that order. `required` lists the placeholders that must be
filled before the document is complete and controls per-template `missing`
reporting. Placeholders not in `FIELDS` (and not `today`) produce a template
warning, shown at startup and on `/api/health`. Restart to pick up a new or edited
template: the registry is loaded once in `src/server.ts`.
