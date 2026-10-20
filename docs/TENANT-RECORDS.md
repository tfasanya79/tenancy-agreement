# What their documents actually record

The field list for this app comes from **their paperwork**, not from our idea of what
an agreement ought to contain. This page is the evidence for that list: what each of
their three documents records, what it merely refers to, and what it never mentions.

Method: read each file, then separate text that **records a value** (a blank, or a
previous tenant's details typed in) from text that **states an obligation** ("we will
provide…", "you must check…"). Only the first is something the app should ask for.

Last checked against the three files in `received from the client/`, 20 October 2026.

---

## 1. The tenancy agreement (room-only and whole-house share one structure)

| What changes | Where it appears in the document | The value in the file we were given |
| --- | --- | --- |
| Agreement date | "The Agreement is dated above" | — |
| Landlord name(s) | Section A, Main Terms | Haven Bricks Properties |
| Landlord service address | "Service Address of the Landlord" | — |
| Tenant name(s) | "…placed upon you **Yusuf Olamilekan Odelade**, and us …" | one tenant |
| Tenant email | contact block | — |
| House address and postcode | "We will let out the Property at …" | — |
| **Room number** | "Room: 1" | `1` |
| Tenancy commencement date | "commencing on 5th September 2026" | 5 Sep 2026 |
| Rent amount | "You must pay £628" | £628 |
| Rent due day | "rent in advance on the 4th of each month" | 4th |
| First payment deadline | "must be paid before 5th September 2026" | 5 Sep 2026 |
| **Schedule of condition & inventory date** | "provided to you on or before 17th September 2026" | 17 Sep 2026 |
| Deposit scheme name | "namely: My deposits" | My deposits |
| Deposit amount | "The Deposit of **two weeks rents**" | a formula, not a figure |
| Rent payment destination | "Rental payment should be paid to:" | bank details |

That is **fifteen values**, and it matches the list the client sent by hand — eight of
them, plus the scheme name, the bank details and the agreement date which they would
otherwise fill in silently.

## 2. The holding deposit form

A blank form, so every value is a visible blank:

| What changes | How it appears |
| --- | --- |
| Date the deposit was received | `on ___________________` |
| Landlord / agent name | "Name of Landlord/Agent(s):" |
| Landlord / agent contact | "Contact details…" |
| Applicant full name(s) | "Full name(s) (include all joint applicants):" |
| Applicant contact | "Contact details…" |
| Rent and period | "Rent is £_________________ per ________" |
| Property address | "Property Address:" |
| Deadline to agree the tenancy | `____________` (15 days from receipt) |
| Holding deposit amount | `£ ______` ("no more than 1/52 of the annual rent") |
| Security deposit amount | `£____________` |
| Signatures and date | "Signed by … Date of agreement:" |

Note the different shape: the form has **blanks to fill**, while the contracts have the
previous tenant's details **typed in**. Both are fillable, but by different means — see
M2 in the [ROADMAP](ROADMAP.md).

## 3. What they do **not** record — so the app must not ask

This is the part that matters. Each of these appears in their contract only as an
obligation or a reference, never as a value:

| Topic | What the document actually says | Ask for it? |
| --- | --- | --- |
| Gas safety **date** | Mentioned only in clause 10.4 as a document that "may be served on you" electronically | **No** |
| EICR **date** | Same clause 10.4 — the report is named, no date or reference recorded | **No** |
| EPC **rating** | Same clause 10.4 | **No** |
| How to Rent guide **date** | Same clause 10.4 | **No** |
| Smoke / CO alarm **records** | Only obligations to check and to replace batteries (1.25b, 1.42) — no record kept | **No** |
| Right to rent **check date** | A condition of the tenancy (section 22, Immigration Act 2014) — the check is required, no date field | **No** |
| Council tax band | Never mentioned anywhere in any of the three documents | **No** |
| Property type, bedrooms, furnished status | Not recorded — the room is identified by its number | **No** |
| Pets, smoking | Obligations and permissions only, nothing to fill in | **No** |

An earlier version of this design proposed a "compliance records" section asking for
exactly these. That was wrong: it is not how the agency works, and their own documents
do not contain it. Asking for it would add friction to every tenancy for information
nothing in their process uses.

## 4. What this means for the app

- A tenancy form is **about fifteen fields, most of them inherited** from the property,
  room and agency records. In an existing room, three of them are typed.
- A holding deposit form is a separate, shorter document with its own blanks.
- The **legal checks remain**, but they are silent: they advise and never block. What
  blocks generation is a value the *document* needs and does not have.
- No certificate register, no compliance section, no council tax field.

## 5. Where the checks now sit

| Severity | Meaning | Examples |
| --- | --- | --- |
| **Error** — blocks | The document cannot be produced correctly | A detail the contract needs is missing; a postcode that is not UK-shaped; the deposit protection deadline already passed |
| **Warning** — visible | Worth a look before sending | Deposit above the statutory cap; the property rated F or G; a scheme field that is not a scheme name |
| **Note** — quiet | Background only, never in the way | Gas safety, EICR, EPC, right to rent, How to Rent, alarms |

The notes exist because the agency may find them useful. They are not a checklist the
app imposes, and nothing in the workflow waits on them.
