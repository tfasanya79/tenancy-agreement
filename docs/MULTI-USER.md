# People, roles and the record of who did what

TenancyDesk holds tenant personal data, so it asks who you are before it will show
anything. This page is what that means in practice: who can do what, how somebody
is added, and what the app can and cannot tell you afterwards.

## The three roles

| Role | Can do | Cannot do |
| --- | --- | --- |
| **Owner** | Everything: every tenancy, the agency details, people, backup, uploads, tidying up | — |
| **Agent** | Every tenancy pack and back-office record: create, edit, generate, upload documents, use the assistant | Change the agency details, add or remove people, download a full backup |
| **Landlord** | Read their own properties' tenancies, open a pack, download documents and the ZIP, read the history | Change anything, generate anything, see another landlord's records, or reach the assistant, checks or back office |

One agency per installation. Several agencies sharing one copy would need every
table and query scoped by agency — a different design, not a setting. That design is
written up, unbuilt, in [docs/PLATFORM.md](PLATFORM.md).

## The first run

With no accounts, the app shows **Set up TenancyDesk**: name, email and a password.
That creates the owner and signs them in. The screen closes for good the moment the
first account exists — `/api/auth/setup` answers `409` from then on — so there is no
window in which an installation can be claimed by somebody else.

You need at least 12 characters. Length is the only rule: `letmein` is refused,
`correct horse battery` is not. A phrase beats a puzzle, and the app says so rather
than lecturing about symbols.

## Adding somebody

**Back office → People & access** (owner only).

1. Their name and email — that email is their login, so it has to be theirs.
2. Their role.
3. For a landlord, **which landlord record** — the account is tied to it, and that
   tie is what confines them to those properties.
4. A password. One is generated for you; copy it before you close the box, because
   it is stored only as a hash. Hand it over privately.

Each person gets their own login. Do not give two people one account: the History
tab records *who*, and a shared login makes that answer meaningless.

The same screen lists everyone with their role, whether they are switched off, and
when they last signed in. **Switch off** ends their sessions immediately;
**Set a password** resets one and signs them out everywhere.

## What a landlord sees

They sign in like anybody else, and the interface offers only what the server
would allow:

- the tenancy list, filtered to their own properties;
- each pack's Details tab, read-only, with the inputs disabled rather than
  pretending to accept a change;
- the Documents tab, to download what has been produced;
- the History tab.

Not the assistant, not the checks, not the back office. On the server side the rule
is applied once, in `src/auth/guard.ts`, to every route: a pack that is not theirs
answers **"not found"** rather than "not allowed", so the reply reveals nothing
about what exists.

## Sessions

- A session lasts **twelve hours**, sliding with use, and never more than **seven
  days** from when it began.
- The cookie is `HttpOnly` (script cannot read it), `SameSite=Lax` (another site
  cannot use it) and `Secure` when the request arrived over HTTPS.
- Changing your own password signs out every other browser.
- Ten wrong passwords per quarter hour from one address locks that address out for
  fifteen minutes. A failed login also waits 300 ms, which costs an honest person
  nothing and a script a great deal.

## The record of who did what

Every change that matters writes a row: who, what, on which pack, when.

| Where | What it shows |
| --- | --- |
| A pack's **History** tab | That tenancy's trail, newest first, with the person named: *"Ade Bello · Generated documents · 7 documents: …"* |
| **People & access → Recent activity** | The agency-wide trail, including sign-ins and account changes |
| `GET /api/packs/:id` | The same events as JSON, with `actorName` on each |
| The proxy access log (if configured) | Request-level detail: address, path and status, per person's credential |

What is recorded is the **kind** of change and the **field names** that changed —
not a copy of the values. The values are already on the pack; duplicating them into
an audit log doubles the places tenant data can leak from.

## Limits worth knowing

- **No second factor** and **no password reset by email** — the owner sets passwords.
  If you need a second factor, put it in front (SSO at a proxy, or a VPN like
  Tailscale) rather than waiting for it here.
- **No per-record permissions.** An agent can see every tenancy; if two staff
  members must be kept apart, this is not yet the tool for it.
- **Reading is not audited.** Opening a document does not write an event; only
  changes do. Request logs cover reads if they matter to you.
- **A landlord sees the tenancy, not the agency.** Their own landlord record and
  property details appear inside the pack they are reading.

## If somebody leaves

1. **Back office → People & access → Switch off.** Their sessions end immediately.
2. Leave the account in place, switched off: the History keeps its attribution, and
   the audit trail stays readable.
3. If their password may be known elsewhere, use **Set a password** first and then
   switch the account off — that invalidates every session and the old password in
   one step.
