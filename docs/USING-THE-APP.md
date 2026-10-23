# Using TenancyDesk

A guide for the letting agent. No technical knowledge needed.

If something is broken, jump to [When something goes wrong](#when-something-goes-wrong).
For the one-time setup, see the [README](../README.md#quick-start).

---

## What this does for you

Every new tenancy needs the same pile of paperwork. TenancyDesk takes the details
once — from an email you paste in, or typed by you — and produces the whole pack,
in Word, ready to sign.

The AI assistant is there to save you retyping. **Everything it does, you can do by
hand** on the Details tab, and everything except the assistant works with no API key
at all.

---

## Signing in

TenancyDesk asks who you are before it shows anything, because the packs inside it
are tenant personal data. Your agency's owner sets you up in **Back office → People
& access** and gives you a password; you sign in with your email address and that
password.

There are three kinds of account:

- **Owner** — everything, including adding people and changing the agency details.
- **Agent** — every tenancy and record, but not people or the agency settings.
- **Landlord** — read-only, and only their own properties' tenancies.

The first time the app runs there are no accounts, so it asks you to create the
owner. That screen closes permanently once the first account exists.

What you can do is decided by the app, not just hidden in the page: a landlord's
write is refused by the server, and a pack that is not theirs simply does not
exist as far as they can tell. The **History** tab on each pack names the person who
did each thing.

You stay signed in for twelve hours of use, and at most a week. **Sign out** is at
the top right. If you change your password, every other browser signed in as you is
signed out too — which is the point of changing it.

Details of roles, adding people and what a landlord can see: [docs/MULTI-USER.md](MULTI-USER.md).

## The screen

One screen. A list of packs down the left, four tabs across the top.

```
┌──────────────────────────────────────────────────────────────┐
│  TenancyDesk                          [Assistant ready]      │
│                                       [ + New tenant pack ]  │
├───────────────┬──────────────────────────────────────────────┤
│ TENANT PACKS  │  Alex Morgan & Sam Okafor                    │
│               │  Flat 3, 12 Bridge Street, Manchester        │
│ ▸ Alex Morgan │  TD-2026-0001   0 to fix   6 documents       │
│   Incomplete  │                                              │
│               │  [Assistant] [Details] [Documents] [Checks]  │
│ ▸ Sarah Bell  │  ┌────────────────────────────────────────┐  │
│   2 documents │  │                                        │  │
└───────────────┴──┴────────────────────────────────────────┴──┘
```

A **pack** is one tenancy. One tenant group, one property, one set of documents.

---

## Making a new pack

### The quick way — paste an email

1. Press **New tenant pack**.
2. On the **Assistant** tab, paste the landlord's email, your WhatsApp thread, or
   the details from a phone call.
3. Press **Send**.

The assistant reads it, records what it found, and tells you what is still missing.
You will see the steps it took listed above its reply — "Recording 6 details",
"Checking the rules on deposit deadline" — so you can see exactly what it did.

Then answer its questions. It will ask one at a time, plainly: *"What is the
deposit amount?"* Just reply in the box.

### The careful way — type it in

1. Press **New tenant pack**.
2. Go to the **Details** tab.
3. Fill in the sections. The three that matter most are open by default: tenants,
   property, tenancy.
4. Details marked **needed** are the ones the agreement asks for — the app will still generate without them, but it will ask you first
   documents without them.

It saves as you type. There is a **Save details** button at the bottom if you
prefer to be certain.

### Mixing the two

Perfectly normal, and probably the best way to work: paste the email to get 80% of
it, then correct and complete it on the Details tab. The assistant never
overwrites something you typed with a blank.

---

## The four tabs

### Assistant

Opening the Assistant does not give you an empty box and a guess at what to type. It
reads the pack and offers the **next few things worth doing**, best first:

| What it offers | When |
| --- | --- |
| **Start from the landlord's email** | the pack is empty — paste the email or WhatsApp thread and it pulls out the dates, rent, names and addresses |
| **Get this pack ready to send** | there is a tenant: it works through the essentials, the checks, producing the documents, the download, and the message to the tenant |
| **Fix what the checks flagged** | details are in, but something needs a look first |
| **Write the message to the tenant** | the pack is produced and the tenant has not been written to |
| **Use our own document** | you have not uploaded your own agreement yet |

Each card says *why* it is being offered — "3 details are still needed before the
agreement can be produced" — and picking one shows the steps as a rail: finished ones
ticked, the current one highlighted, one button to do it, and **I'll do it myself** to
leave the guide and use the tabs.

Two things worth knowing about the guides:

- **The ticks are facts, not encouragement.** A step is ticked because the pack has
  changed — the details are complete, the documents exist — not because the conversation
  said so. The only exception is the download, which the app cannot see: it ticks when you
  take the file.
- **A guide never skips a question.** Producing documents through the guide asks the same
  "carry on anyway?" question the Documents tab asks.

You can also ignore all of it and type. Useful things to type:

| What you want | What to type |
| --- | --- |
| Fill in the rest | *"What is still missing? Ask me for anything you need."* |
| Check the paperwork | *"Run the compliance checks and tell me if anything needs fixing."* |
| Produce the documents | *"Generate every document this tenant needs for move-in."* |
| A message to the tenant | *"Draft the covering email and a short WhatsApp message for the tenant."* |
| A question about the law | *"Does the deposit have to be protected within 30 days?"* |

A landlord sees a shorter list — what they can read, and what is outstanding — because
their access is read-only.
**The draft appears in the chat**, ready to read and copy — not just a note saying it was saved. It is also kept on the pack: you will find it again under **Documents → Message to the tenant**, with a Copy button for each version.

**Replies are laid out properly.** A heading like *Email* appears as a heading, a list
as a list, and the lines of a letter stay on their own lines. Hover over a reply for a
**Copy** button: it copies the words without the formatting, so they paste straight
into an email.

**It will not make things up.** If it does not have a date or an amount, it asks.
If you tell it something that is not in a document, it will suggest a note rather
than quietly editing legal wording.

**It will not rewrite your clauses.** If you want a clause changed, that is an edit
to the template file — see [docs/TEMPLATES.md](TEMPLATES.md).

### Details

The pack list on the left is grouped by where each tenancy sits — **Active**, **Starting soon**, **Ending**, **Ended** — and the dropdown next to the pack reference moves it between them.

Everything the pack knows, in a form. Correct anything here, any time. Blank
fields are simply blank; the app tells you which ones are essential.

- **Tenants** — one card per person. Use **Add another tenant** for joint
  tenancies; they appear in order on the agreement.
- **The property** — the address, and the **room number** if you let a house room
  by room. Leave the room blank for a whole property.
- **The tenancy** — the start date and the rent. The **first payment date** fills
  itself in as the day before the start date, then monthly; change it only if an
  agreement says something different.
- **Deposit** — the amount, which scheme, the reference, and the date you received
  it. That date starts the 30-day clock.
- **Inventory & condition** — the date the schedule of condition was agreed.
- **Safety & compliance** — the certificate dates. You cannot produce a defensible
  pack without them, and the app will tell you if one is out of date.
- **Guarantor** — fill it in only if there is one. The guarantor deed appears in
  the document list automatically when you do.

### Documents

Tick what you need and press **Generate selected documents**. The move-in set is
already ticked.

For each document you get:

| Button | What it is for |
| --- | --- |
| **Word** | The `.docx` to send, sign, and file. Upload this to your e-signature service. |
| **Print / PDF** | Opens a clean page in a new tab — press **Print**, then choose *Save as PDF*. This is how you make a PDF. |
| **Source** | The expanded text, exactly as it went into the document. Use it to check wording. |
| **Preview** (on any template) | See what a document looks like before generating it. |

**Download all (ZIP)** at the top right gives you every generated document in one
file, plus a contents sheet listing what is in the pack, the key dates, and
anything the checks flagged. That ZIP is the thing to drop into the tenancy folder
in your file storage.

Documents regenerate cleanly: generate again and the old version of that document
is replaced, not duplicated.

### Your own documents

At the bottom of the Documents tab the app asks the question worth asking once:
**do you already have your own versions?** If you send tenants your own agreement,
inventory report or notice, you do not have to use ours.

1. Press **Upload our documents** — it opens **Back office → Our documents**.
2. Choose the Word file and give it a name. Upload one document at a time.
3. The app reads it and shows you each value it found next to a box: pick the detail
   that belongs there (`agent.company_name`, `tenancy.rent_amount`, and so on). Where it
   guessed, the guess is already in the box — check the ones marked **choose**. A
   person's details are offered as *Full name (first tenant)*, *Email (first tenant)* and
   so on, because a joint tenancy keeps each person's details in its own list.
4. From then on the document appears on every tenancy's Documents tab with a
   **Fill for this tenant** button. The file it produces is your layout, your
   wording, your letterhead, with this tenant's details in place of the old ones.

A blank form — a paper-style agreement with lines to fill in — is handled too: the
app finds the blank spaces, in order, and asks which detail goes in each.

If you only have a PDF, open it in Word and save it as `.docx` first: the app
cannot see inside a PDF. Uploaded files stay in your own data folder, and their
contents are never sent to the AI.

### Checks

Three groups, in this order of seriousness:

- **Worth fixing before you send** — the app still lets you generate; it asks first and records that you chose to carry on. A deposit over
  the legal cap, a gas certificate that will be out of date, an EPC rated F.
- **Worth checking** — usually fine. A missing right-to-rent check date, an
  agency redress scheme not filled in.
- **For your information** — e.g. pets are allowed but not described.

Below the findings are the **statutory deadlines** for this tenancy, with a
countdown:

- Protect the deposit and serve the prescribed information — **30 days** from
  receipt
- Give the tenant the written statement of terms — **28 days** from the start
- Next gas safety check
- Next EICR

Anything due within a month is highlighted. These are the dates to put in your
diary. TenancyDesk does not send reminders — it shows you, you act.

At the bottom of the Checks tab is a **notes** box. The assistant adds notes here
when there is something it cannot do itself, like *"Protect the deposit with the
scheme by 19 November"*. You can add and delete your own.

---

## The back office

**Back office** is not a settings page — it opens on an **Overview** of the installation,
because that is what you want when you press it:

- **Tenancies** — how many, how many are active or starting soon, how many documents have
  been produced, and two things worth acting on: tenancies with no documents yet, and
  tenancies not linked to a property (which therefore inherit nothing).
- **Deadlines** — how many are past their date and how many fall due in the next 30 days.
- **Records** — landlords, properties, rooms, tenants, and how many of your own documents
  you have uploaded.
- **People** — accounts by role, and which account reads the feedback queue.
- **The installation** — database size, free disk, and when the last backup was taken.
- **Feedback** — how many reports are waiting, if you are the product owner.
- **Recent activity** — the last few things that happened, and who did them.

Every number is a button to the screen that changes it. Underneath are the tabs, which are
the filing cabinet: **Properties & rooms**, **Landlords & tenants**, **Our documents**,
**People & access**, **Health & backup**, **Tidy up**, and **Agency settings** (the details
that print on every document).
## A normal week

**Monday — new tenancy agreed**

1. New pack, paste the landlord's email, answer two questions.
2. Details tab: check the rent, dates and deposit against the agreed terms. This
   is the important human step — the assistant is fast, not infallible.
3. Checks tab: fix anything red, note the deadlines.
4. Documents tab: Generate, then Download all. Send the agreement for signature.

**Same week**

5. Protect the deposit in your scheme. Put the scheme reference on the Details tab.
6. Serve the prescribed information, the How to Rent guide, the EPC and the gas
   certificate. Record the dates on the Safety section.
7. Send the tenant the welcome pack.

**Later**

8. When the gas check or EICR comes round, the Checks tab tells you when.
9. For a rent increase, use the section 13 notice in the document list — and
   remember it is once a year, on two months' notice.
10. When a tenant leaves, the pack is your record of what was given, when.

---

## Things this app does not do

Setting expectations early saves a support call later.

- It does **not** send email or messages. It drafts the wording; you send it.
- It does **not** sign anything. Upload the Word file to your e-signature service.
- It does **not** protect deposits. That happens at the scheme — TenancyDesk tells
  you the deadline and produces the prescribed information.
- It does **not** remind you. Put the deadlines in your calendar.
- It does **not** reference tenants or run right-to-rent checks. Record the date
  when you have done it.
- It does **not** replace your accountant, your CRM, or your solicitor.

The things that fill those gaps — mostly free or cheap — are listed in
[TOOLBOX.md](TOOLBOX.md).

---

## When something goes wrong

| What you see | What to do |
| --- | --- |
| Top right says **Assistant off** | There is no API key. Put `DEEPSEEK_API_KEY=sk-...` in the `.env` file and restart. You can still do everything by hand. |
| *"DeepSeek rejected the API key"* | The key is wrong or expired. Make a new one at platform.deepseek.com. |
| *"Your DeepSeek account has no remaining balance"* | Top up the account, or fill packs in by hand meanwhile. |
| Assistant says it cannot reach DeepSeek | No internet, or a company firewall. Check you can open platform.deepseek.com. |
| A field in a Word document is blank | That detail was never entered. On the Details tab, fields the agreement asks for are marked **needed**. |
| The app asks before generating | Something is outstanding. You can fix it, or choose **Carry on and generate** — the pack is produced and the choice is noted on the pack. |
| Print / PDF did nothing | Allow pop-ups for this site, then try again. |
| Something is badly broken | Close it and run `pnpm doctor` in the folder — it checks everything and says what to fix. |

---

## Words you will see

| Term | What it means here |
| --- | --- |
| **Pack** | All the paperwork for one tenancy. |
| **Template** | A document in `templates/` with blanks in it. |
| **Assured periodic tenancy** | The type of tenancy used in England since 1 May 2026 — no fixed end date. |
| **Section 8** | The only route to possession now that section 21 is abolished. |
| **Section 13** | The procedure for a rent increase: once a year, two months' notice. |
| **Prescribed information** | The deposit paperwork the tenant must be given, within 30 days. |
| **EICR** | Electrical Installation Condition Report — every five years. |
| **EPC** | Energy Performance Certificate. F and G cannot be let. |
| **Right to rent** | The check that an adult tenant may legally rent in England. |

---

## A word about the AI

The assistant is genuinely useful for reading a messy email and spotting what is
missing. It is not a solicitor and it is not an authority on the law. It is
configured so that it:

- cannot change the wording of a document,
- cannot invent a fact — it asks instead,
- must look the law up in a fixed rule set rather than remember it,
- shows you every step it took.

That is a lot of protection, and it is not a guarantee. Read what you are about to
sign. That is true of any software, and doubly true of anything with a tenant's
name on it.
