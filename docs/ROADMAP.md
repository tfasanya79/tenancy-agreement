# Roadmap

What we are building next, in what order, and how we will know each step is done.
Every milestone here is small enough to ship on its own and useful on its own.

For what already works, see the status table in the [README](../README.md#status-and-roadmap).

---

## How this list was chosen

Three tests, applied in order:

1. **Does it remove work from the agent?** The product exists to stop retyping. Anything
   that does not reduce typing or searching is a distraction.
2. **Does it reduce legal risk?** A letting agent is buying certainty, not cleverness.
   Catching one defective clause is worth more than a dozen features.
3. **Can it be proved correct?** If a change cannot be covered by a test, it does not go
   in the core. The assistant may be unpredictable; the documents may not be.

Two principles run through everything: **deterministic code wherever the answer must be
right**, and **never lose the agency's formatting**.

---

## M1 · Back office and prefilling

*The foundation the rest of this list stands on. Design: [BACKOFFICE.md](BACKOFFICE.md).*

Today a pack is an island, so the property address, landlord, room and rent are
retyped for every tenant — and there is nowhere to ask "which certificates expire
this month?". The back office fixes both, and it is a prerequisite for M4 (bulk
rooms need rooms to exist) and for the prefilling that makes the form short.

**What it holds:** agency settings, landlords, properties, rooms, certificates,
tenants, and the tenancy as the link between them. The current pack becomes a
tenancy, and gains links instead of losing anything.

**What it buys:** in an already-set-up room, a new tenancy needs **three typed
details** — tenant name, tenant email, start date. Everything else is inherited or
derived.

**Deliberately excluded:** rent ledger, arrears, applications pipeline — see the
"not building" list in [BACKOFFICE.md](BACKOFFICE.md#what-i-would-deliberately-not-build).

- [ ] Settings screen for the agency's own details, so they stop editing `.env` by hand.
- [ ] Landlord, Property, Room, Tenant and Certificate records in SQLite, with a
      migration that derives them from the packs that already exist — previewed and
      confirmed, never silently merged.
- [ ] The tenancy form prefilled by inheritance, with provenance shown on every
      inherited field ("from Room 2"), and an explicit way to override.
- [ ] Editing a shared value asks before it changes existing tenancies.
- [ ] A deterministic check that the property is in England or Wales. The assistant
      already spotted a Swedish address; the code should catch it too.

**Done when:** setting up a second tenant in a room that already exists takes three
typed details, and no existing pack has lost a value.

**Effort:** 3–4 sessions. **Depends on:** nothing. **Blocks:** M4.

---

## M2 · Finish "bring your own document"

*The differentiator. Two thirds of it is already built and tested.*

| Already done | Where |
| --- | --- |
| Read a `.docx` and extract its text | `src/docs/docxFill.ts` |
| Substitute values without touching formatting, across split Word runs | `src/docs/docxFill.ts` |
| Write new values in the document's own style (`£980` → `£1,450`) | `formatLike()` |
| Flag an agreement that is out of date with the law | `src/docs/templateAudit.ts` |
| Room-by-room details and the derived first payment date | `src/docs/fields.ts` |

**What is left**

- [ ] Storage for uploaded documents: a `templates_custom` table, files under
      `data/uploads/`, one row per uploaded document.
- [ ] `POST /api/uploads` — accept a `.docx`, extract its text, audit it, propose links.
- [ ] Link proposal: the assistant reads the document and suggests, for each of the
      agreed details, the exact text currently in the file. Deterministic verification
      that every proposed `find` string really occurs, so a bad suggestion is rejected
      rather than silently skipped.
- [ ] Review screen: a table of "this text → this detail", with a preview of the filled
      result before it is saved. One minute, once.
- [ ] **Two fill modes**, because the documents differ:
      *value replacement* for the contracts (the previous tenant's details are typed in),
      *blank filling* for the holding deposit form (it has `________` placeholders).
- [ ] Fill and download: choose the uploaded document, fill from the pack, get a `.docx`
      that is byte-identical apart from the substitutions.
- [ ] Wire the audit into the upload: a document that still says "assured shorthold" or
      "section 21" is shown as a warning before it is ever used.

**Done when:** a pack produces a filled copy of the client's own room-only contract and of
their holding deposit form, with formatting intact, and the documents' legal defects are
reported at upload time. A demo pack renders from the documents in
`received from the client/` (which stays out of git).

**Effort:** 2–3 sessions. **Depends on:** nothing.

---

## M3 · Deadlines that chase you

*You already compute the dates; nobody is told about them.*

- [ ] Export the pack's deadlines as an `.ics` file — imports into Outlook, Google or
      Apple Calendar with one click.
- [ ] Include the renewal dates that are not yet due (gas safety +12 months, EICR +5 years)
      so a year's diary fills in at once.
- [ ] A **cross-pack view**: every tenancy, sorted by what is due. Deposits not yet
      protected, written statements due, certificates expiring.
- [ ] Surface the same information on the pack list in the sidebar (a count of overdue items).

**Done when:** opening the app answers "what do I have to do this week?" without clicking
into a single pack, and one button puts those dates in the agent's calendar.

**Effort:** 1–2 sessions. **Depends on:** nothing. **Highest value per hour on this list.**

---

## M4 · Bulk room lets

*The client lets room by room. Four rooms should not mean four identical rounds of typing.*

- [ ] "Add another room" on a property: clone the tenancy details, changing only the room
      number, tenant and dates.
- [ ] Generate one pack per room from a single screen, each with its own tenant.
- [ ] Keep each room's documents separate — one tenant must never see another's paperwork.

**Done when:** filling a four-room house takes one form and one click, and produces four
independent packs and eight documents.

**Effort:** 2 sessions. **Depends on:** M1 for the rooms, and M2 for the client's own contract.

---

## M5 · Evidence and explanation

*What an agent needs three months later, and what a tenant is entitled to understand.*

- [ ] **Timeline per pack**: what was given, when, to whom, downloadable as a one-page PDF.
      Wins deposit disputes.
- [ ] **"Why?" on every check**: click a finding, see the rule and its GOV.UK source. The
      rule set already carries a citation per entry.
- [ ] **Tenant summary**: a plain-English page generated from the pack — what is due, when,
      who to call. Optionally translated.

**Done when:** a dispute can be answered from the app in under a minute, and every warning
the app shows can be traced to a published source.

**Effort:** 2 sessions. **Depends on:** M1 for the register, and M3 for the deadline data.

---

## M6 · Prove it stays correct

*Quality work. Invisible when done well; expensive when skipped.*

- [ ] **Consistency checks** on an uploaded document — the errors found in the client's
      contract on day one:
      - a weekday that contradicts its date ("Wednesday 5th September 2026" was a Saturday);
      - two different rent due days in one document ("the 1st" then "the 4th");
      - fees that the Tenant Fees Act 2019 does not allow ("a £15 admin fee for late rent" —
        only interest at 3% above base rate, and only after 14 days);
      - arithmetic typos ("the 1stth of each month").
- [ ] **Golden-file tests**: hash the rendered text of each shipped template, so a wording
      edit that changes every future agreement is caught in review.
- [ ] A test that every documented command, path and test count matches the code —
      already shipped as `pnpm docs:check`, wired into CI.

**Done when:** re-uploading the client's current contract reports the weekday and rent-day
errors automatically, without being told where to look.

**Effort:** 1–2 sessions. **Depends on:** M2.

---

## M7 · Make it safe for a non-technical owner

- [ ] **Backup button**: one click downloads a ZIP of `data/`. Nobody is going to run `rsync`.
- [ ] **Health panel** in the interface: templates loaded, key present, disk space, last
      backup.
- [ ] Restore instructions that a non-developer can follow.

**Done when:** losing the laptop is survivable without a developer.

**Effort:** 1 session. **Depends on:** nothing.

---

## Order and why

```
M1  back office + prefilling   ← unblocks everything else; kills the retyping
M7  backup                     ← cheap insurance, do it before real use
M2  bring your own document    ← the differentiator
M3  deadlines + dashboard      ← best value once the register exists
M4  bulk rooms                 ← needs M1's rooms
M6  consistency checks         ← turns the audit into a proofreader
M5  evidence + tenant summary  ← polish that sells
```

M1 first because the client asked for exactly that — a back office and forms that
fill themselves — and because M4 cannot be built without rooms. M7 second because
real tenant data is already in `data/` and should be recoverable before it matters.
M2 third because the client has now supplied the documents and the repaired versions
are ready to become their reference template. M3 follows naturally once tenancies,
rooms and certificates are real records rather than isolated packs.

---

## Definition of done, for every milestone

- [ ] Tests cover the new behaviour; `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm docs:check` passes — documented commands, paths and counts match the code.
- [ ] The README status table and `CHANGELOG.md` are updated in the same commit.
- [ ] Anything legal cites a source in `src/knowledge/rules.ts`, and `pnpm rules` is re-run.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Their document changes after the links are mapped, so fills silently miss | Every fill reports what it could not find; re-check the document's checksum on upload |
| A model proposes a link that does not exist in the file | Links are verified against the document text before they are saved |
| The law changes again (Phases 2 and 3 are still landing) | The rule set is dated, cited, and checked by the audit; `RULES.md` is generated from it |
| Real tenant personal data leaks into git | `data/`, `.incoming/` and `received from the client/` are all git-ignored |
| The agency's own wording contains an error nobody notices | M6 consistency checks; the audit; and the app never claims a document is legally correct |

---

## Deliberately not planned

- Accounts, logins, multi-user permissions — a single-user tool is the honest scope.
- Sending email or collecting signatures — [docs/TOOLBOX.md](TOOLBOX.md) names the tools that
  do this well.
- Rewriting PDFs — a PDF cannot be edited without losing its layout or looking tampered with.
  Ask for the `.docx`.
- Becoming a case-management system.

---

## Open questions for the client

1. The client's room-only contract says rent is due "on the 1st" in one clause and "on the
   4th" in another — which is correct? (The repair used the 4th.)
2. Is the £15 late-payment "admin fee" still charged? Under the Tenant Fees Act 2019 a flat
   fee of that kind is very likely a prohibited payment. (The repair replaced it with
   statutory interest.)
3. Are the holding deposit and the security deposit both taken before the tenancy starts, and
   is the holding deposit always one week's rent?
4. Does the whole-house contract and the room-only contract need to stay separate, or should
   one document adapt to both cases?
5. **Is any of the portfolio outside England and Wales?** A pack shows a Birmingham postcode
   beside what looks like a Swedish address. If property abroad is genuinely let, the app must
   refuse to produce an England & Wales agreement rather than warn and carry on.
6. **Does "manage tenants" mean the full lifecycle** — upcoming, active, ending, ended, with an
   end-of-tenancy pack — or only the paperwork at the start of a tenancy?
7. **Should the register hold money** (deposits received and returned), or only the scheme
   details needed for the prescribed information? The line between "record" and "accounting"
   is worth drawing deliberately.
