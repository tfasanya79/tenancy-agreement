# The rule set

These are the England & Wales rules that TenancyDesk checks against and that the assistant
is allowed to rely on. They live in `src/knowledge/rules.ts`; this page is generated from
that file by `pnpm rules`, so the two cannot drift apart.

**Last reviewed:** 2026-10-19

> This is a summary written for software, not legal advice. Tenancy law changes, and
> several parts of the Renters’ Rights Act 2025 are still being phased in. Always confirm
> the current position at the source before you rely on it.

## How these are used

| Where | What it does |
| --- | --- |
| `src/docs/compliance.ts` | Deterministic checks — arithmetic and date comparisons, no AI. These produce the errors that block document generation. |
| `src/agent/tools.ts` → `lookup_rules` | The assistant searches this set instead of answering from memory. |
| `src/agent/prompts.ts` | Reminds the model to use `lookup_rules` rather than recall law. |

## What changed in May 2026

Phase 1 of the Renters’ Rights Act 2025 came into force on **1 May 2026**. The documents in
`templates/` are written for the position after that date:

- Section 21 “no fault” eviction is abolished. Possession is section 8 only.
- Fixed-term assured shorthold tenancies are replaced by **assured periodic tenancies**.
- Rent may rise once a year, on two months’ notice, under section 13.
- No more than one month’s rent may be taken in advance, and rental bidding is banned.
- Discrimination against tenants with children or receiving benefits is illegal.
- Tenants have a right to request a pet, with a 28-day decision period.

Phase 2 (from late 2026) brings the PRS Database and the Landlord Ombudsman. Phase 3
covers the Decent Homes Standard and Awaab’s Law, with timetables still being consulted on.

## The rules

| # | Topic | Rule |
| --- | --- | --- |
| 1 | tenancy type | [All new private tenancies in England are assured periodic tenancies](#tenancy-type) |
| 2 | possession | [Section 21 "no fault" notices are abolished in England](#section-21) |
| 3 | ending the tenancy | [A tenant can end an assured periodic tenancy with two months’ notice](#tenant-notice) |
| 4 | written statement of terms | [The tenant must be given a written statement of terms](#written-statement) |
| 5 | rent increase | [Rent may be increased once a year, with two months’ notice](#rent-increase) |
| 6 | deposit | [Deposits must be protected within 30 days, with prescribed information](#deposit-protection) |
| 7 | deposit | [Deposits are capped at five weeks’ rent](#deposit-cap) |
| 8 | rent in advance | [No more than one month’s rent may be taken in advance](#rent-in-advance) |
| 9 | fair letting | [You cannot discriminate against tenants with children or on benefits](#discrimination) |
| 10 | pets | [Tenants have a right to request a pet](#pets) |
| 11 | gas safety | [Gas safety check before move-in and every 12 months](#gas-safety) |
| 12 | electrical safety | [Electrical installation condition report every five years](#eicr) |
| 13 | energy performance | [A valid EPC of band E or better is required](#epc) |
| 14 | alarms | [Smoke alarms on every storey, carbon monoxide where needed](#alarms) |
| 15 | right to rent | [Right to rent checks are required before the tenancy starts](#right-to-rent) |
| 16 | how to rent | [Give the tenant the How to Rent guide](#how-to-rent) |
| 17 | landlord registration | [The PRS Database and Landlord Ombudsman are coming](#prs-database) |
| 18 | agency compliance | [Agencies must display client money protection and redress scheme membership](#client-money) |
| 19 | fees | [Only permitted payments may be charged to a tenant](#prohibited-payments) |
| 20 | holding deposit | [A holding deposit is capped at one week’s rent and is refundable](#holding-deposit) |

---

<a id="tenancy-type"></a>

### All new private tenancies in England are assured periodic tenancies

**Topic:** tenancy type · **Rule id:** `tenancy-type`

From 1 May 2026 fixed-term assured shorthold tenancies no longer exist for new lettings in England. New and existing tenancies became assured periodic tenancies.

- There is no fixed end date: the tenancy rolls on until the tenant ends it or a court orders possession.
- Avoid drafting a fixed term or an "end date" for a new tenancy — it is no longer the correct model.
- Existing fixed-term tenancies converted, so old AST paperwork should not be reused for new lettings.

Source: [GOV.UK — Renters’ Rights Act implementation roadmap](https://www.gov.uk/government/publications/renters-rights-act-2025-implementation-roadmap/implementing-the-renters-rights-act-2025-our-roadmap-for-reforming-the-private-rented-sector)

---

<a id="section-21"></a>

### Section 21 "no fault" notices are abolished in England

**Topic:** possession · **Rule id:** `section-21`

Landlords can no longer serve a section 21 notice. Possession must be sought on a section 8 ground, through the court.

- Do not use or send a section 21 notice for a tenancy in England.
- Section 8 grounds were reformed and expanded at the same time; notice periods vary by ground.
- A court order is still required before a tenant can be evicted.

Source: [GOV.UK — Renters’ Rights Act implementation roadmap](https://www.gov.uk/government/publications/renters-rights-act-2025-implementation-roadmap/implementing-the-renters-rights-act-2025-our-roadmap-for-reforming-the-private-rented-sector)

---

<a id="tenant-notice"></a>

### A tenant can end an assured periodic tenancy with two months’ notice

**Topic:** ending the tenancy · **Rule id:** `tenant-notice`

Tenants may end the tenancy by giving two months’ written notice. They can leave sooner only if the landlord agrees (a surrender).

- Put the two-month notice right in the agreement so it is unambiguous.
- A landlord cannot charge a fee or penalty for the tenant exercising this right.

Source: [GOV.UK — Renters’ Rights Act implementation roadmap](https://www.gov.uk/government/publications/renters-rights-act-2025-implementation-roadmap/implementing-the-renters-rights-act-2025-our-roadmap-for-reforming-the-private-rented-sector)

---

<a id="written-statement"></a>

### The tenant must be given a written statement of terms

**Topic:** written statement of terms · **Rule id:** `written-statement`

A written statement of the key terms of the tenancy must be provided to the tenant, and promptly — treat 28 days from the start of the tenancy as your deadline.

- It must include the parties, the rent, the rent period, the deposit and how it is protected, and the notice periods.
- The landlord’s name and an address in England or Wales for serving notices must appear on the agreement.
- Keep evidence of the date it was given.

Source: [GOV.UK — Renters’ Rights Act implementation roadmap](https://www.gov.uk/government/publications/renters-rights-act-2025-implementation-roadmap/implementing-the-renters-rights-act-2025-our-roadmap-for-reforming-the-private-rented-sector)

---

<a id="rent-increase"></a>

### Rent may be increased once a year, with two months’ notice

**Topic:** rent increase · **Rule id:** `rent-increase`

Rent increases must follow the section 13 procedure: no more than once in any 12-month period, with at least two months’ written notice on the prescribed form.

- You cannot increase rent more than once a year, even by agreement outside the procedure.
- The notice must state the new rent and the date it takes effect (at least two months ahead).
- The tenant can challenge a proposed increase at the tribunal.

Source: [GOV.UK — Renters’ Rights Act implementation roadmap](https://www.gov.uk/government/publications/renters-rights-act-2025-implementation-roadmap/implementing-the-renters-rights-act-2025-our-roadmap-for-reforming-the-private-rented-sector)

---

<a id="deposit-protection"></a>

### Deposits must be protected within 30 days, with prescribed information

**Topic:** deposit · **Rule id:** `deposit-protection`

A tenancy deposit must be protected in a government-approved scheme within 30 days of receipt, and the tenant must be given the prescribed information for that scheme.

- Keep the certificate and the date the prescribed information was served.
- Failing to protect or to serve the prescribed information can expose the landlord to a penalty of up to three times the deposit and can block a possession claim.
- The prescribed information must be re-served if the tenancy is renewed or the deposit is re-protected.

Source: [GOV.UK — Tenancy deposit protection guidance](https://www.gov.uk/tenancy-deposit-protection)

---

<a id="deposit-cap"></a>

### Deposits are capped at five weeks’ rent

**Topic:** deposit · **Rule id:** `deposit-cap`

Under the Tenant Fees Act 2019 a deposit is capped at five weeks’ rent where the annual rent is under £50,000, and six weeks’ rent where it is £50,000 or more.

- Weekly rent = monthly rent × 12 ÷ 52.
- Holding deposits are capped separately at one week’s rent and must be refunded or put towards the tenancy.
- A deposit above the cap is a prohibited payment, and the excess is repayable.

Source: [GOV.UK — Tenant Fees Act 2019 guidance](https://www.gov.uk/government/collections/tenant-fees-act)

---

<a id="rent-in-advance"></a>

### No more than one month’s rent may be taken in advance

**Topic:** rent in advance · **Rule id:** `rent-in-advance`

Taking more than one month’s rent in advance is no longer allowed. Rental bidding is also banned: you cannot ask for, encourage or accept more than the advertised rent.

- This applies to lettings agents as well as landlords.
- Both practices were banned as part of the first phase of the Renters’ Rights Act reforms.

Source: [GOV.UK — Renters’ Rights Act implementation roadmap](https://www.gov.uk/government/publications/renters-rights-act-2025-implementation-roadmap/implementing-the-renters-rights-act-2025-our-roadmap-for-reforming-the-private-rented-sector)

---

<a id="discrimination"></a>

### You cannot discriminate against tenants with children or on benefits

**Topic:** fair letting · **Rule id:** `discrimination`

It is illegal for a landlord or agent to do anything that makes it less likely that someone with children or in receipt of benefits will rent a property.

- This includes withholding availability, refusing a viewing, or refusing to grant a tenancy.
- The practical effect is that "no DSS" and "no children" policies are not acceptable.

Source: [GOV.UK — Renters’ Rights Act implementation roadmap](https://www.gov.uk/government/publications/renters-rights-act-2025-implementation-roadmap/implementing-the-renters-rights-act-2025-our-roadmap-for-reforming-the-private-rented-sector)

---

<a id="pets"></a>

### Tenants have a right to request a pet

**Topic:** pets · **Rule id:** `pets`

A landlord must consider a written request to keep a pet within 28 days and must give a valid reason in writing if refusing.

- Record requests and responses in writing.
- Where a pet is allowed, the agreement should say what is permitted and who is responsible for damage.

Source: [GOV.UK — Renters’ Rights Act implementation roadmap](https://www.gov.uk/government/publications/renters-rights-act-2025-implementation-roadmap/implementing-the-renters-rights-act-2025-our-roadmap-for-reforming-the-private-rented-sector)

---

<a id="gas-safety"></a>

### Gas safety check before move-in and every 12 months

**Topic:** gas safety · **Rule id:** `gas-safety`

Every gas appliance and flue must be checked by a Gas Safe registered engineer before the tenant moves in, then at least every 12 months. The tenant must get a copy of the certificate.

- The record must be given to the tenant before they move in and within 28 days of each later check.
- Keep the certificate — it is needed for a possession claim.

Source: [HSE — Gas safety in rented accommodation](https://www.hse.gov.uk/gas/domestic/landlords.htm)

---

<a id="eicr"></a>

### Electrical installation condition report every five years

**Topic:** electrical safety · **Rule id:** `eicr`

The electrical installation must be inspected and tested at least every five years by a qualified person, and the report given to the tenant before move-in.

- The report must show the installation is satisfactory, or you must do the remedial work within 28 days.
- Also check any portable appliances you supply.

Source: [GOV.UK — Electrical safety standards in the private rented sector](https://www.gov.uk/government/publications/electrical-safety-standards-in-the-private-rented-sector-guidance-for-landlords-tenants-and-local-authorities)

---

<a id="epc"></a>

### A valid EPC of band E or better is required

**Topic:** energy performance · **Rule id:** `epc`

You need a valid Energy Performance Certificate, and you cannot let a property rated F or G without a registered exemption. Band C is proposed for 2030.

- Give the tenant a copy of the EPC before they move in.
- The government has consulted on raising the minimum to band C by 2030.

Source: [GOV.UK — Energy Performance Certificates for landlords](https://www.gov.uk/guidance/energy-performance-certificates-what-landlords-need-to-know)

---

<a id="alarms"></a>

### Smoke alarms on every storey, carbon monoxide where needed

**Topic:** alarms · **Rule id:** `alarms`

Smoke alarms must be fitted on every storey of the property used as living accommodation, and carbon monoxide alarms where there is a solid fuel appliance or a relevant gas appliance.

- They must be tested on the day the tenancy starts.
- Record in the inventory that they were tested and working.

Source: [GOV.UK — Smoke and carbon monoxide alarm requirements](https://www.gov.uk/government/publications/smoke-and-carbon-monoxide-alarms-guidance-for-landlords)

---

<a id="right-to-rent"></a>

### Right to rent checks are required before the tenancy starts

**Topic:** right to rent · **Rule id:** `right-to-rent`

You must check that every adult tenant has the right to rent in England, and keep evidence of the check.

- Use the Home Office right to rent service to check a share code, or inspect original documents in person.
- Keep copies for the duration of the tenancy and two years afterwards.

Source: [GOV.UK — Right to rent checks](https://www.gov.uk/check-tenant-right-to-rent-documents)

---

<a id="how-to-rent"></a>

### Give the tenant the How to Rent guide

**Topic:** how to rent · **Rule id:** `how-to-rent`

The current How to Rent guide must be given to the tenant at the start of the tenancy. It is needed later if the landlord wants to serve notice.

- Give the latest version, and record the date you gave it.
- For a new tenancy starting after 1 May 2026, give the current version in force on that date.

Source: [GOV.UK — How to rent: the checklist for renting in England](https://www.gov.uk/government/publications/how-to-rent)

---

<a id="prs-database"></a>

### The PRS Database and Landlord Ombudsman are coming

**Topic:** landlord registration · **Rule id:** `prs-database`

From late 2026 landlords must register with the government PRS Database. Membership of the PRS Landlord Ombudsman is expected to become mandatory later.

- Registration will require landlord contact details, property details and safety certificates.
- Watch for the fee and the registration route being confirmed.

Source: [GOV.UK — Renters’ Rights Act implementation roadmap](https://www.gov.uk/government/publications/renters-rights-act-2025-implementation-roadmap/implementing-the-renters-rights-act-2025-our-roadmap-for-reforming-the-private-rented-sector)

---

<a id="client-money"></a>

### Agencies must display client money protection and redress scheme membership

**Topic:** agency compliance · **Rule id:** `client-money`

If you hold client money — deposits or rent — you must belong to a government-approved client money protection scheme and a redress scheme, and say so on your paperwork.

- Your scheme names should appear on agreements, invoices and your website.
- Check your professional body’s rules for the exact wording.

Source: [GOV.UK — Client money protection schemes for property agents](https://www.gov.uk/government/publications/client-money-protection-schemes-for-property-agents)

---

<a id="prohibited-payments"></a>

### Only permitted payments may be charged to a tenant

**Topic:** fees · **Rule id:** `prohibited-payments`

The Tenant Fees Act 2019 bans fees beyond the rent, a refundable deposit, a holding deposit and a short list of permitted payments.

- A charge for late rent is limited to interest at 3% above the Bank of England base rate, and only once the rent is 14 days overdue.
- A flat “admin fee” for a late payment is a prohibited payment, however small the amount.
- A prohibited payment must be repaid, and a council can impose a financial penalty — up to £5,000, and more for repeat breaches.
- The other permitted payments are narrow: a lost key at reasonable cost, a variation the tenant asks for (capped at £50), and an early-termination payment where the tenant requests it.

Source: [GOV.UK — Tenant Fees Act 2019 guidance](https://www.gov.uk/government/collections/tenant-fees-act)

---

<a id="holding-deposit"></a>

### A holding deposit is capped at one week’s rent and is refundable

**Topic:** holding deposit · **Rule id:** `holding-deposit`

A holding deposit may not exceed one week’s rent (annual rent ÷ 52), only one may be held at a time, and it must normally be refunded within 7 days.

- Give the applicant written terms before they pay: the amount, what it is for, when it is refundable, and the deadline for agreeing the tenancy.
- The deadline for agreement is normally 15 days, extendable by written agreement.
- Refund it within 7 days if the tenancy is not entered into, or if the landlord or agent decides not to proceed.
- It may be retained only on the limited grounds in Schedule 2 — false or misleading information, a failed right to rent check, or the applicant withdrawing — and the reason must be given in writing within 7 days.
- If the tenancy goes ahead, the holding deposit must be credited in full towards the rent or the deposit.

Source: [GOV.UK — Tenant Fees Act 2019 guidance](https://www.gov.uk/government/collections/tenant-fees-act)

---

## Adding or changing a rule

1. Edit `src/knowledge/rules.ts` — keep the `id` stable if the rule already exists.
2. If the rule affects a check, update `src/docs/compliance.ts` as well.
3. Update the “Phase 1 / 2 / 3” summary above if the change is a timing change.
4. Run `pnpm rules` to regenerate this page, then `pnpm test`.
5. Change `RULES_REVIEWED_ON` so readers know how fresh the advice is.
