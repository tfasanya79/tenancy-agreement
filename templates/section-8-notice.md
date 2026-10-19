---
id: section-8-notice
title: Section 8 Notice Seeking Possession
category: possession
jurisdiction: england-wales
version: "1.0"
updated: "2026-10-01"
description: Notice under section 8 of the Housing Act 1988 seeking possession of a property let on an assured periodic tenancy, specifying the grounds relied on.
required: [landlord.full_name, landlord.address, property.address_line1, tenancy.start_date, tenants]
---
# Section 8 Notice Seeking Possession

> This notice is served under section 8 of the Housing Act 1988. Section 21 has been abolished in England, so there is no "no fault" notice and this document creates no right to possession on its own.

To the Tenants named below, and to the Property:

| Item | Detail |
| --- | --- |
| Property | {{property.address_line1}}, {{property.address_line2}}, {{property.city}}, {{property.postcode}} |
| Tenant | {{#each tenants}}{{this.full_name}} {{/each}} |
| Landlord | {{landlord.full_name}}, {{landlord.address}} |
| Agent serving the notice | {{#if agent.company_name}}{{agent.company_name}}, {{agent.address}}, {{agent.phone}}{{else}}None appointed{{/if}} |
| Tenancy | Assured periodic tenancy beginning {{tenancy.start_date|date}} |
| Current rent | {{tenancy.rent_amount|money}} {{tenancy.rent_frequency}} |

## 1. Notice of Intention to Seek Possession

**1.1** The Landlord gives you notice that the Landlord intends to apply to the court for an order for possession of the Property under section 8 of the Housing Act 1988, on the ground or grounds set out in section 2 of this notice.

**1.2** Court proceedings will not begin before the date stated in section 3. The tenancy continues until the court makes an order and that order is enforced, and the Landlord is not entitled to possession, and must not take possession, before then.

**1.3** This notice must be served in the form prescribed by the Assured Tenancies and Agricultural Occupancies (Forms) (England) Regulations 2015, as amended by the Renters' Rights Act 2025. Where the prescribed form requires details or wording not contained in this document, those details are added before service.

## 2. The Grounds Relied On

| Ground | Description | Minimum notice period | Relied on | Particulars |
| --- | --- | --- | --- | --- |
| Ground 1 | Landlord or family member intends to occupy the Property | Two months | | |
| Ground 2 | Property subject to a mortgage and lender wishes to sell | Two months | | |
| Ground 6 | Landlord intends to demolish, reconstruct or carry out substantial works | Two months | | |
| Ground 7A | Serious antisocial behaviour or conviction for a specified offence | Two weeks | | |
| Ground 8 | At least eight weeks' rent unpaid at the date of service and at the date of the hearing | Two weeks | | |
| Ground 10 | Rent unpaid at the date of service and at the date of the hearing | Two weeks | | |
| Ground 11 | Persistent delay in paying rent | Two weeks | | |
| Ground 12 | Breach of an obligation of the tenancy other than rent | Two weeks | | |
| Ground 13 | Deterioration of the Property or common parts due to the tenant's conduct | Two weeks | | |
| Ground 14 | Nuisance or annoyance to neighbours, or use of the Property for illegal purposes | Two weeks | | |
| Ground 17 | Tenant gave false information to obtain the tenancy | Two weeks | | |

**2.1** The minimum notice periods in the table are those set by section 8 of, and Schedule 2 to, the Housing Act 1988 as amended. Grounds added or amended by the Renters' Rights Act 2025, including the ground for sale of the Property and the ground for the Landlord or a family member moving in, carry their own notice periods and eligibility restrictions, and the prescribed form must be checked before service.

**2.2** The particulars for each ground relied on must be complete and accurate. For a rent arrears ground, the notice must state the amount of rent owed at the date of the notice, and the arrears must also exist at the date of the hearing for Ground 8.

## 3. Date After Which Proceedings May Begin

| Item | Detail |
| --- | --- |
| Date this notice is served | |
| Ground or grounds relied on | |
| Date after which the Landlord may apply to the court | |
| Earliest date proceedings may be issued | |

The date of service is completed before service. The date after which the Landlord may apply to the court is calculated from the longest minimum notice period applying to any ground relied on, and proceedings must not be issued before that date and before the requirements of section 8 have been met.

## 4. What You Should Do

**4.1** If you do not agree with this notice, or you think the ground does not apply, you should get advice straight away. Free advice is available from a local authority housing advice service, Citizens Advice or a housing solicitor.

**4.2** If the ground is rent arrears, paying the arrears may end the Landlord's ability to rely on Ground 8 at the hearing, although other grounds may still apply.

**4.3** The court can adjourn proceedings, give you time to pay, or suspend a possession order on terms. You should tell the court about any relevant circumstances, including vulnerability, illness or the effect on children in the household.

**4.4** The Landlord will consider any reasonable request from you, including a request for more time or for a payment plan, before starting proceedings.

## 5. Declaration and Signature

The Landlord confirms that the information in this notice is correct, that the notice is served in accordance with section 8 of the Housing Act 1988 and that the ground or grounds specified were satisfied at the date of service.

**Landlord** — {{landlord.full_name}}

Signature: ______________________________________  Date of service: ____________________

{{#if agent.company_name}}
**Agent for the Landlord** — {{agent.name}} for {{agent.company_name}}

Signature: ______________________________________  Date of service: ____________________
{{/if}}

Service was effected by: hand delivery / first class post / electronic communication (delete as applicable).

> *This document was assembled by TenancyDesk from a template. It is not legal advice. Always check the current law before signing.*
