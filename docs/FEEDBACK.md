# The feedback engine — plan for review

> **Status: built.** Phases F1–F4 are implemented and tested (`tests/feedback.test.ts`).
> Three details differ from the original plan and are marked **[as built]** below: the
> conversation answers with JSON rather than a stream, the assistant's schema arrives as
> a *proposal* the interface files (so confirmation sits in the code path, not the
> prompt), and the operator is named by `OPERATOR_EMAILS` at startup.

A button that says **FEEDBACK**, a short conversation with an assistant that
understands what is being asked for, and a queue the product owner works through.
This document is the plan: what gets stored, who may see it, what the assistant is and
is not allowed to do, and the four phases it is built in.

## 1. Decisions already taken

| Question | Answer |
| --- | --- |
| Who sees the FEEDBACK button? | **Everybody with an account** — owners, agents and landlords. No tester flag, no beta list |
| Do a landlord's words reach their agency? | **No.** Feedback is product feedback, addressed to the platform, not to the agency. An agency owner cannot see it, cannot filter it and must not be told it exists |
| Who reads the queue? | **The operator** — the person who owns the product. In today's single-agency installation that is the same human as the agency owner, but the permission is modelled separately, so the day a second agency exists, its owner does not inherit the queue |

That second row is the reason this is more than a form: it decides the permission
model. The mechanism is a small flag on the user (`is_operator`), set once for the
product owner, not a new role in the agency's hierarchy.

## 2. What it is

> **The feature is the structured record and the queue. The conversation is one way
> to fill the record in.**

A chat that ends in "thank you" is a void. So the plan builds the record first, with a
plain form as the way in, and puts the assistant on top as a better front door. If the
model is unavailable — no API key, `OFFLINE_MODE`, DeepSeek down — the form still
works, and the feature is still useful.

Three outcomes matter, in this order:

1. The tester is **understood correctly** before they press send.
2. The owner gets a **queue that can be worked**, not a wall of text.
3. The tester **sees what happened to it**, so they keep testing.

## 3. The flow

```
[FEEDBACK pill, bottom right, always there]
        │
        ▼
"What could be better on this screen?"        ← context already captured:
        │                                        Documents tab · TD-2026-0001
        ▼
tester types
        │
        ▼
assistant reflects it back, in one or two sentences,
and asks one question only if it genuinely needs to
        │
        ▼
tester confirms  →  file_feedback tool call  →  {kind, title, summary, area}
        │
        ▼
"Filed as an improvement: 'Deposit date should pre-fill'."
+ "This goes to the TenancyDesk team — not your agency."
        │
        ▼
tester can open their own list, and see the status change later
```

Three rules bind that conversation:

- **Reflect before filing.** The assistant may not file until the tester has seen the
  summary and agreed with it, or revised it. Misunderstanding caught here is worth
  more than any amount of triage later.
- **One question, at most two.** A clarification that becomes an interrogation loses
  the tester, which is the only thing this feature cannot afford.
- **No promises.** Not "we'll fix that", not "next release", not "I've told the
  developers". The assistant files and thanks; commitments come from a human, in the
  queue.

## 4. What the assistant does, and what it may not

| Does | Does not |
| --- | --- |
| Reflects the request back in plain English | Touch a tenancy — it has no pack tools and no store access |
| Files a structured record via one tool call | Read documents, change fields, or generate anything |
| Asks one clarifying question when the report is vague | Ask three |
| Spots that the idea is already possible ("that is in Back office → Our documents") and says so, clearly marked as a suggestion | Close the feedback, or refuse to file it, on that basis |
| Notices it is a bug rather than an idea, and says which it filed as | Promise a fix, a date or a priority |
| Suggests a real problem belongs with the agency: *"for a fault in the tenancy itself, contact your agent — this button only reaches the TenancyDesk team"* | Act as a support desk |

Structured filing means a **tool call with a schema**, not prose to be re-read later:

```
file_feedback({
  kind:     "improvement" | "new_feature" | "bug" | "confusion" | "praise",
  title:    one line, the tester's own words where possible,
  summary:  two sentences, plain English, what they want and why,
  area:     "documents" | "details" | "checks" | "assistant" | "back office" | "sign-in" | "other",
  sentiment:"positive" | "neutral" | "frustrated"
})
```

## 5. The record

```
feedback       id, user_id, organisation_id, role,        -- who, where, as what
               kind, title, summary, area, sentiment,
               screen, pack_reference,                    -- where they were standing
               status, cluster_id, needs_review,          -- triage
               operator_note, public_note,                -- what we said back
               created_at, updated_at, done_at

feedback_msgs  id, feedback_id, role ("tester" | "agent"), text, at
```

Notes that matter:

- **The conversation is kept verbatim.** The summary is a digest for the queue; the
  original words are where the detail lives, and the detail is often the whole point.
- **`status`** is a small fixed list so counts mean something:
  `new → triaged → planned → done` or `declined`.
- **`needs_review`** is set when the text looks like it contains personal data (a name,
  an email, a postcode, a phone number) or a promise. It does not remove anything; it
  puts the record at the top with a warning for a human to read properly.
- **`pack_reference`, never the pack.** The screen and the reference are enough to
  reproduce a report; the tenancy's contents have no business being involved.

## 6. Where it is stored — and why that has to change

Feedback lives in **the tenancy database**, `data/tenancydesk.db`, in the `feedback` and
`feedback_messages` tables, beside the packs. Everything else in that file is an agency's
tenant data, and feedback is not: it is the product's own record, addressed to the person
who owns the product rather than to the agency it was written about.

Three things follow, and none of them are accidental:

- **It is covered by the backup that already runs.** The hourly snapshot copies the whole
  database, so feedback is in every archive alongside the tenancies. Nothing extra to
  maintain, and one place to restore from.
- **It is in the file an agency's data lives in.** Today that is harmless — there is one
  agency, and the person who owns the product is the person who owns the agency. It stops
  being harmless the moment a second agency exists.
- **It must move when the platform arrives.** In the design in
  [docs/PLATFORM.md](PLATFORM.md) each organisation gets its own database file and the
  control database holds what belongs to the platform — identities, memberships, plans.
  **Feedback belongs in the control database**, for exactly the reason the operator flag
  exists: if it stayed in an agency's file, the day that file is exported, copied for a
  backup or handed to the agency, their landlord's words about them go with it.

Until then, two rules hold: the queue is a route the operator alone may call (§5), and the
backup archives must be treated as containing both — which they already are, being
root-only and 600.

## 7. Retention: nothing is deleted until somebody resolves it

- **A record is kept indefinitely.** There is no expiry, no purge job, and **no delete
  route**: not for the tester, not for the operator. `DELETE /api/feedback/:id` does not
  exist, and a test asserts that it stays that way.
- **Marking something `done` or `declined` is a status, not a deletion.** The record stays
  in the queue afterwards, with its date, its tester, the conversation and the outcome, so
  "we said no to this in March, and here is why" survives. The tester keeps seeing it in
  their own list, with the outcome and any note.
- **Declining does not recycle it either.** A declined ask is excluded from duplicate
  clustering — a refused idea must not gather apparent support for a new one — but the
  record itself is untouched.
- **The only thing that removes feedback is dropping the database**, which is the same act
  as removing every tenancy.

That is deliberate policy, not an omission: a feedback list that quietly forgets is a list
nobody trusts, and the value of the queue is in the pattern across months, not the items in
it today. If a purge is ever wanted, it should be an explicit, dated action that writes an
event — not a background job.

## 8. Rate limits

Five submissions per person per hour, and forty conversation turns. Both are **in memory**:
a restart clears them, which is the right trade for a first version — the limit exists to
stop a stuck client or a bored one, not to police a team. A person who hits it is told so
in plain words, and their earlier submissions are unaffected.

## 9. Routes

| Method | Path | Who |
| --- | --- | --- |
| `POST` | `/api/feedback/chat` | any signed-in user — one turn of the conversation. **[as built]** answers with JSON, not a stream: the replies are two sentences, and one round trip is simpler to test than an event stream |
| `POST` | `/api/feedback` | any signed-in user — the form, and the fallback when the model is unavailable |
| `GET` | `/api/feedback/mine` | any signed-in user — their own submissions and statuses |
| `GET` | `/api/feedback/queue` | **operator only** — the queue |
| `PATCH` | `/api/feedback/:id` | **operator only** — status, operator note, public note |
| `GET` | `/api/feedback/export` | **operator only** — markdown, for a file or a ticket |

This needed one extension to `src/auth/guard.ts`, since done: access rules are
**method-aware** now — a `{ methods, pattern }` list rather than a pattern list — because
`POST /api/feedback` (everyone) sits beside `GET /api/feedback/queue` (operator only).
Landlords keep their read-only rule with one exception: `POST /api/feedback` and
`POST /api/feedback/chat`. A person who may not change a tenancy may still complain about
the software.

**[as built]** The operator is a flag (`users.is_operator`) set at startup from
`OPERATOR_EMAILS`, and applied to each account as it is created. It is not an agency role:
an agency owner is not an operator, and the tests assert exactly that.

## 10. The tester's view

A panel, not a page: their last few submissions with status words a person understands
(*Sent · Being looked at · On the list · Done*), the public note if there is one, and
the button again. No history of the conversation reopened by default; the record is
theirs, so it can be read, but the point of the panel is "it went somewhere".

## 11. The operator queue

A **Feedback** tab, visible only to the operator, with:

- counts by status in the tab title, so an unread pile announces itself;
- filters: kind, status, area, and "needs a look";
- each row: kind, title, the tester's summary, who and what role, the screen, when, and
  **how many others asked for the same thing** (§12);
- actions: set status, write the operator note (private) and the public note (shown to
  the tester);
- export to markdown, so an idea can go into an issue tracker, a roadmap or a
  conversation without re-typing it.

Working through a queue is the whole point: a list you cannot change state on is a
museum.

## 12. Duplicates

The same idea arrives four times from four people, and the fifth is the one that makes
you build it. So at filing time, compare the new record against the last few hundred
using the cheap nearest-word similarity the document mapper already uses (no embeddings,
no new dependency). Above a threshold, attach it to the existing cluster and add a
count.

- The queue shows *"asked 4 times"* and lists the four people, so the weight is visible.
- Clustering never merges records — each keeps its own words, and its own tester can
  still see it and its status.
- Consolidation is a human act: the operator can mark a cluster as the canonical one.

## 13. When the model is not there

`OFFLINE_MODE`, no API key or a DeepSeek failure must not remove the feature:

- the pill opens a **form** — three fields (what were you trying to do, what happened,
  what would be better) plus the captured context;
- the record is identical in shape, with `kind` guessed from the form's wording by a
  simple keyword pass, and `needs_review` set, because no summary was written;
- the tester is told plainly: *"saved; the assistant is switched off today"*.

That fallback is also the first phase, so the queue is useful before any AI exists.

## 14. Privacy

- **Nothing about the tenancy goes to DeepSeek.** The question to the model is the
  tester's words plus the screen name. Not the pack, not the fields, not the documents.
  This keeps the promise already made in `SECURITY.md` about what leaves the machine.
- **People paste personal data anyway**, so the app asks them not to, flags records that
  look like they contain it, and puts those in front of a human. That is cheaper than
  pretending it will not happen, and it is the same stance as the rest of the product:
  record it, do not silently lose it.
- **Retention**: kept until somebody resolves it, and then kept anyway — see §7. That is
  the policy, so the privacy notice should say it plainly rather than promise a tidy
  expiry that does not exist.
- **A landlord's words never reach the agency.** This is a promise made in the
  interface, so it needs to be true in the code: organisation-scoped queries for
  everything else, and no route that returns feedback to an agency owner.

## 15. What we deliberately do not do

Auto-create tickets in an external tracker · email notifications (in-app first) ·
promise timelines · let the assistant change anything in a tenancy · anonymous
feedback · sentiment dashboards · let a tester see anyone else's feedback, even
counted · treat the button as a support channel.

## 16. Phases

Each phase is shippable and testable on its own.

**F1 — Record, form and queue.** Table, `POST /api/feedback`, the form panel, the
operator queue with statuses, the tester's own list, the operator flag, the method-aware
guard.

*Done when:* anyone with an account can file feedback through the form, the operator can
move it through `new → triaged → planned → done`, the tester sees the change, an agency
owner gets `403` on the queue, and one landlord cannot see another's submission. **Done.**

**F2 — The conversation.** The chat panel, streaming, the reflect-back, the
`file_feedback` schema, the one-question rule, the no-promise and support-diversion
behaviour, and the fallback to the form whenever the model is unavailable.

*Done when:* a vague report ("it doesn't work") becomes a filed record with a title, a
summary and the right kind, after at most two questions; a promise never appears in the
filed text (checked by test against the commitment detector); and with `OFFLINE_MODE`
the form appears instead. **Done** — the `propose_feedback` schema is the contract, and
`reviewFlags` catches both personal data and promises.

**F3 — Reaching the tester.** Statuses surfaced to the submitter, public notes, and the
"asked N times" count in the queue.

*Done when:* a tester sees *On the list* the same day the operator sets it, and five
similar submissions show as one row with a count of five and five names. **Done** for
status and count; the five names are in the queue each on their own row, which turned out
to read better than one row pretending to be five.

**F4 — Working the queue.** Clustering with a canonical record, filters and counts,
markdown export, `needs_review` warnings for personal data and promises, retention.

*Done when:* the operator can clear a week of feedback without opening any other tool,
and the export can be pasted into a tracker without editing. **Done** — clustering
(`similarity`), filters by status and kind, counts in the heading, `needs_review` flags,
and markdown export including private notes on request.

## 17. How it is tested

| Area | Test |
| --- | --- |
| Filing | a signed-in user files; it appears in their own list and in the queue |
| Privacy of the queue | an agency owner gets `403`; a landlord sees only their own |
| The conversation | a mocked client drives reflect-back → file; the filed record has kind and title |
| Vagueness | "it doesn't work" produces one clarifying question, not a filed record |
| Promises | text containing "we will have that done by…" sets `needs_review` |
| Personal data | a name plus postcode sets `needs_review` |
| Fallback | `OFFLINE_MODE` → the form, and the record is still created |
| Duplicates | four similar submissions produce one cluster with a count of four |
| Rate limit | a fifth submission in a minute from one user is refused with an honest message |
| Status loop | `PATCH` to `done` shows as Done on the tester's own list |

## 18. Risks

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| It fills with duplicates and never gets read | The feature becomes theatre; testers stop writing | Clustering and statuses from phase F1; the queue is the product (§8) |
| The assistant promises something | A tester expects a fix that never comes | No-promise rule in the prompt, a commitment flag on the record, and a human in the loop |
| It becomes a support channel | Landlords report tenancy faults and expect the agent to answer | The diversion line, and a kind of `confusion` for exactly that |
| Personal data lands in feedback | Tenant data in a model call, or in a queue | Context-light calls, a PII flag, guidance in the panel, retention |
| The agency sees what its landlord said | A promise broken in code | Operator-only routes, tested; organisation-scoped everything else |

## 19. Open questions

1. Should a tester be able to **edit or withdraw** a submission? I would allow withdraw
   and not edit — an edited record loses the original words that made it useful.
2. Who is the operator **after** the platform arrives — the same person, presumably, but
   the flag needs a home in the control database rather than one row in `users`.
3. Do we want the queue to inform the roadmap by itself (tag a phase, count asks), or is
   export to a tracker enough for now? I would start with export.
