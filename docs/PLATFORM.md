# TenancyDesk as a platform

> **Status: a design for review. Nothing in this document is built.** It exists so the
> decisions can be argued with before there is code to unpick.

This describes turning the single-agency tool in this repository into a platform where
many agencies and landlords each have their own space, with one narrow, link-based
door for tenants.

## 1. What this is, and what it is not

It **is**:

- one installation serving many organisations, each completely separate;
- an agent/landlord product — the paying customer, with accounts, roles and an audit
  trail (already built, see [docs/MULTI-USER.md](MULTI-USER.md));
- one read-only, link-based page per tenancy for tenants, with no tenant accounts.

It is **not**:

- a tenant portal, a marketplace, or a place to introduce tenants to landlords;
- a deposit scheme, an e-signature service, or a right-to-rent checking service;
- a place any money passes through.

## 2. The two surfaces, and the one customer

> The agency is the customer with an account. **A tenant is a person with a tenancy,
> not a user of the product.**

A tenant touches a tenancy a handful of times: confirming details, receiving the
documents, the deposit information, check-in, check-out. Giving each of them a
password, a profile and a support relationship buys the agency almost nothing and
costs the platform a great deal: account lifecycle, password resets, dormant logins,
a much longer personal-data footprint, and data that cannot be deleted when asked
because the tenancy record has to survive.

So the tenant surface is **a capability link**: one long random URL per tenancy,
issued by the agent, opening exactly that tenancy and nothing else.

## 3. The regulatory frame

The platform is a **tool the agent uses**. It does not do letting agency work, and
nothing in it should drift towards doing so:

| Not built, ever | Why |
| --- | --- |
| Protecting a deposit | Only a government-authorised scheme (TDS, DPS, mydeposits) can. We hold the scheme reference and produce the prescribed information, as today |
| Checking right to rent | A home-grown ID upload grants **no statutory excuse** and is worse than nothing. Record that a check was done, and by what route |
| Click-to-sign on a deed | Deeds need a witness who is physically present. Ordinary agreements sign electronically; deeds do not |
| Moving money | Rent, deposits and holding deposits bring client money, and payment-services regulation, with them |
| Matching tenants to landlords for a fee | This is the one that would change what the business *is* — it can amount to regulated letting agency work, with redress scheme membership, client money protection and AML supervision attached |

The middle column is a legal question, not an engineering one. Nothing in the design
below depends on the answer, but the marketing, pricing and terms do.

## 4. The big decision: one database per organisation

**Recommended: each organisation gets its own SQLite file. A small control database
holds identities and memberships, and no tenancy data at all.**

```
data/
  control.db                  organisations, memberships, plans — no tenant data
  orgs/
    <organisation-id>/
      tenancydesk.db          tenancies, documents, events, uploads, links
      documents/<tenancy>/…
      uploads/<template>.docx
```

This is the correction to the sketch given earlier, and it is worth saying why
plainly: the existing `Store` is **already parameterised by its data directory**, so
file-per-organisation reuses everything and turns "one forgotten `WHERE`" from a
breach into an impossibility. There is no query that can reach another agency's
tenant because there is no such row in that file.

| | One file per organisation (recommended) | Shared tables + organisation column |
| --- | --- | --- |
| Cross-agency leak by a forgotten filter | **Structurally impossible** | One missed predicate away |
| Isolation proof | The filesystem and the org resolver | A lint on every SQL string, for ever |
| Existing code | Reuses `Store` unchanged | Every table, query and test changes |
| Delete one organisation | Delete a folder | Cascade rules across eleven tables |
| Export or restore one organisation | Copy a file | A script that must not miss a table |
| Migrations | Loop over the folders | One migration |
| Cross-agency reporting | Explicit loop, by design | Free, which is the hazard |
| Ceiling | Hundreds of agencies on one host | Thousands |

Hundreds is far beyond the plausible first years of this business, and the isolation
guarantee is worth more than the ceiling. If the product ever needs the ceiling, the
control database is already the migration path: organisations move behind a server
rather than a file.

### What lives in the control database

```
organisations   id, name, legal_name, company_number, vat_number, address, phone,
                email, logo_path, jurisdiction, redress_scheme, cmp_scheme,
                ico_number, aml_supervisor, plan, read_only_at, created_at
users           id, email (unique), name, password_hash, created_at, disabled_at
memberships     id, organisation_id, user_id, role, landlord_id, created_at, disabled_at
sessions        as today, but a session names the organisation it was opened for
feedback        the FEEDBACK records — deliberately here and not in an agency's file,
                because a landlord's words about their agency must not travel with it
                (see docs/FEEDBACK.md §6)
```

- **Identity is global, authorisation is per organisation.** One person may work for
  two agencies, or own property let through two different agents, with one password
  and two memberships. That is why `users` and `memberships` are separate: today's
  `users.role` and `users.landlord_id` move onto the membership.
- Signing in resolves **one organisation per session** (the user picks when they have
  more than one). A session never carries two.
- The organisation's letterhead, redress scheme, client money protection and ICO
  number live here, because they brand and constrain every document it produces.

### What stays inside each organisation's file

Everything about tenancies, and nothing that needs to be shared: properties, rooms,
landlords, tenants-as-people, tenancies (today's packs), documents, agent runs, notes,
custom-template uploads, capability links, and the events trail.

The schema is the one that exists today, unchanged. That is the point.

## 5. How a request finds its organisation — and the three tests

1. The session cookie resolves to a user and **one membership**.
2. An organisation **cache** in the app maps organisation id to an open `Store`,
   opening it on first use.
3. Every route calls `scope(request)`, which returns that organisation's `Store`. A
   route that needs another organisation's data cannot get one: there is no API for it.

Three tests carry the weight, and they are cheap because the boundary is a file:

- **Resolver test** — an organisation id is a UUID validated against the control
  database before it is ever used to build a path. A request cannot introduce a path
  segment; `/api/packs/../../control.db` must be impossible by construction, not by
  sanitising.
- **Membership test** — table-driven over every route: a session for organisation A,
  asking for organisation B's rows by id, must answer `404` for each. This generalises
  the landlord test in `tests/auth.test.ts` to organisations.
- **Tenant-payload test** — the tenant-facing endpoint's response is asserted to contain
  *only* whitelisted keys (§7). A new internal field on a tenancy must not be able to
  appear on the tenant page by default.

## 6. Roles

Inside an organisation, unchanged from today: **owner**, **agent**, **landlord**
(read-only, their own properties). See [docs/MULTI-USER.md](MULTI-USER.md).

New, and deliberately small: a **platform operator** (you), who can create, suspend and
inspect *organisations* — plans, billing state, disk use — and **cannot read tenancy
data by default**. Support access to an organisation's data is granted by that
organisation's owner, is time-boxed, and is recorded in that organisation's own audit
trail. It is the only credible answer to "who can see our tenants' paperwork?", and it
needs to exist before the first customer asks.

## 7. Capability links

### The token

- 32 random bytes, base64url, **stored only as a SHA-256 hash**, exactly as session
  tokens are today. A copy of the database cannot mint a working link.
- Delivered in the **URL fragment**: `…/t#<token>`. Browsers never put a fragment in
  the request line, so the credential is absent from the proxy access log, the
  `Referer` header and link previews. The page exchanges it immediately for a
  short-lived `HttpOnly` cookie scoped to that tenancy.
- The link is labelled by tenancy, not by person — "your tenancy at 3a Fourier Grove".
  A forwarded WhatsApp message then discloses no name.

### The lifecycle

| Event | Effect |
| --- | --- |
| Issued | expiry = issued + 13 months |
| Opened | recorded as an event (§7, delivery) |
| Tenancy marked ended | expiry = end date + 90 days (the scheme dispute window) |
| Change of parties | old link revoked, a new one issued — a departed tenant's copy stops working |
| Renewal, or new documents | reissue; **What's due** already has a place to remind the agent |
| Agency's plan lapses | **the link keeps working.** Validity derives from the tenancy, never from billing |
| Revoked by the agent | stops immediately |

Thirteen months, not twelve, so a link issued mid-term does not die the week before
its anniversary — and because assured periodic tenancies have no end date to compute
from, the expiry has to be a refreshed value rather than a permanent one.

### What the tenant page may show

Read and download only. Whitelisted, and asserted by test:

- the parties named on the tenancy: full names, phone and email (a joint tenant may
  see the others — they are jointly liable for the same rent);
- the property, including the room if the tenancy is room-only;
- the dates, the rent, the deposit amount, the scheme and its reference;
- the documents produced for that tenancy, as downloads;
- what is still outstanding for them, if the agent chose to show it.

**Never**: internal notes, compliance findings, staff names from the history, the
agency's settings, other tenancies, or the agency's other landlords. The page must be
its own endpoint returning its own shape — not the agent's pack payload with fields
hidden in the interface, which leaves them in the JSON.

### The delivery record

When the link is issued and when it is opened, that is recorded and shown where the
agent already looks:

- the tenancy's **History** tab: *"Link opened by the tenant, 28 Oct 19:40"*;
- the printed history, so it can sit in the file;
- a **not opened yet** line, which is the agent's cue to chase.

Called a **delivery record**, never "proof of service". An open timestamp is evidence
that the documents were made accessible; it is not a defence on its own, and the
wording on the page should say what is true.

No separate product, no separate price: this is the reason to use links at all, and
putting it behind an upgrade would push agents back to emailing a ZIP, which loses the
very evidence the upgrade was for.

## 8. Letterheads

Asked for, never assumed: *"Shall we set up a letterhead for you?"*

- **Generated**: a Word file assembled from the organisation's own details — legal
  entity name, registered office and company number, phone, email, and the redress and
  client-money statements where they apply — in three or four layouts. The `docx`
  dependency and the fill engine already do this work.
- **Never invented**: a blank company number stays blank and the app says so. A
  letterhead that flatters the business by guessing is a document that misrepresents it.
- **Never AI-generated artwork**: a logo cannot be reliably protected, may be derivative,
  and has no business on a legal document. Ask for an upload, or offer a plain wordmark
  in a chosen typeface.
- Once made, the letterhead is attached to that organisation's documents in place of the
  built-in one, and changing it re-brands future documents without touching signed ones.

## 9. England only

Jurisdiction is **asked for, and stored on the organisation and the property** — never
inferred from a postcode, because Welsh and English postcodes overlap (CF, NP, SY, LL,
SA).

If a property is outside England, the England rule set does not apply to it, and the
platform must say so rather than quietly producing English notices for a Welsh
occupation contract. Wales has its own regime since the Renting Homes (Wales) Act 2016;
supporting it is a second rule set, not a configuration flag.

## 10. Data, retention and deletion

- **Minimisation.** The organisation needs its legal identity and its scheme
  memberships. A tenant needs name, email, phone, current address and date of birth in
  the tenancy record; the *date and route* of a right-to-rent check is recorded — the
  documents themselves are not collected. Nothing else, and no field without a document
  and a rule that needs it.
- **Two kinds of data, two lifetimes.** Account data (a person's login) can be deleted
  on request. A tenancy record cannot: deposit disputes, tax and contract claims mean it
  is retained to the organisation's stated policy — six years is the common answer. The
  interface must explain that difference at the point somebody asks, instead of
  appearing to refuse.
- **Who is the controller.** For tenancy data the platform is a **processor** acting for
  each organisation: a written data-processing agreement is part of onboarding, and the
  organisation sets retention. For its own account data the platform is a **controller**.
  That split needs writing into the terms, not discovering later.
- **Leaving.** An organisation can export everything (its database file and documents in
  one archive) and can ask for it to be deleted. Both are properties of the file-per-
  organisation design, which is another reason to choose it.

## 11. What we deliberately do not build

Tenant accounts and profiles · messaging between tenants and agents · ID uploads ·
referencing · e-signature of deeds · deposit protection · rent collection or statements ·
maintenance tickets · matching tenants to landlords · anything that makes the platform a
party to the tenancy.

## 12. Moving today's installation onto the platform

The current single-agency deployment becomes the first organisation:

1. Create `control.db`, one organisation row, one membership for the existing owner.
2. Move `data/tenancydesk.db` to `data/orgs/<id>/tenancydesk.db`; move uploads alongside.
3. Move `users` rows into the control database; `role` and `landlord_id` become the
   membership.
4. The existing `sessions` are invalidated — everyone signs in once more.

No tenancy schema changes at all. The migration is a script that runs once, and it is
reversible by moving the file back, which is the whole benefit of the layout.

## 13. Phases

Each phase is usable on its own, and nothing should be built before its "done when".

**M8 — Organisation foundation.** Control database, memberships, organisation resolver
with a cache, per-organisation `Store`, the first organisation migrated as above, and
the three tests of §5.

*Done when:* two organisations exist in one installation, neither can name a row of the
other on any route, an organisation can be exported by copying a folder, and the current
customer is running on it with no loss of data.

**M9 — Capability links.** Tokens, fragment exchange, the tenant endpoint and its tested
whitelist, the lifecycle of §7, delivery events in the History tab and the printed page.

*Done when:* a link opens only its own tenancy, the token appears in no log or `Referer`,
the tenant payload contains no key outside the whitelist (asserted), a change of parties
kills the old link, and an ended tenancy's link expires 90 days later.

**M10 — Organisation branding.** Letterhead generation and adoption, organisation logo,
organisation-level document defaults.

*Done when:* an organisation without a letterhead can generate one, adopt it, and see it
on every document it produces afterwards.

**M11 — Plans and lifecycle.** Plan state, read-only after a lapse (with links still
resolving), disk usage per organisation, and an onboarding wizard that collects exactly
the fields in §10.

*Done when:* a lapsed organisation keeps its links and its documents readable while
writes are refused, and a new organisation can be created and produce a pack without a
developer present.

## 14. Risks

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| The platform drifts into doing letting agency work | Redress membership, client money protection, AML supervision, PI insurance become mandatory; the trading entity changes | Written scope (§3); a solicitor's answer before marketing makes any claim about introducing tenants |
| A capability link is forwarded to the wrong person | One tenancy's paperwork disclosed | Fragment delivery, hashed tokens, honest expiry, revocation, and a page that names the tenancy rather than the tenant |
| Nobody trusts the platform operator's access | The first serious objection from a customer with real tenants | Operator cannot read tenancy data by default; support access is granted, time-boxed and logged (§6) |
| Retention and deletion are handled as one thing | Either evidence destroyed or a deletion request silently refused | Two lifetimes, stated in the interface and the terms (§10) |
| England-only rules applied to a Welsh property | Wrong notices, quietly | Jurisdiction asked for and stored; a mismatch refuses rather than guesses (§9) |
| Growth beyond one host | The file-per-organisation ceiling | The control database is already the migration path (§4) |

## 15. Open questions

1. Does the platform ever introduce a tenant to a landlord for a fee? If yes, the
   regulatory frame in §3 changes materially, and so does the business.
2. Which entity contracts with the organisations, and who carries professional indemnity
   insurance for documents produced at scale?
3. What is the default retention period offered to organisations — six years, or whatever
   their own policy says?
4. Is one organisation per session enough, or do staff genuinely need two open at once
   (an agent who works for two agencies)? The design assumes one, which is simpler and
   safer.
