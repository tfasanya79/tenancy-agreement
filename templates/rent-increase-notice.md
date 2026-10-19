---
id: rent-increase-notice
title: Section 13 Rent Increase Notice
category: rent-review
jurisdiction: england-wales
version: "1.0"
updated: "2026-10-01"
description: Notice under section 13 of the Housing Act 1988 proposing a new rent for an assured periodic tenancy, with at least two months' notice and not more than once in twelve months.
required: [landlord.full_name, property.address_line1, tenants, tenancy.rent_amount, tenancy.rent_due_day]
---
# Section 13 Rent Increase Notice

> This notice is served under section 13 of the Housing Act 1988 as amended by the Renters' Rights Act 2025. An increase that does not follow this procedure has no effect, and the rent may be increased no more than once in any 12-month period.

## 1. The Parties and the Property

| Item | Detail |
| --- | --- |
| Landlord | {{landlord.full_name}}, {{landlord.address}} |
| Agent | {{#if agent.company_name}}{{agent.company_name}}, {{agent.address}}, {{agent.phone}}, {{agent.email}}{{else}}None appointed{{/if}} |
| Tenant | {{#each tenants}}{{this.full_name}} {{/each}} |
| Property | {{property.address_line1}}, {{property.address_line2}}, {{property.city}}, {{property.postcode}} |
| Tenancy | Assured periodic tenancy beginning {{tenancy.start_date|date}} |

## 2. The Proposed New Rent

| Item | Detail |
| --- | --- |
| Current rent | {{tenancy.rent_amount|money}} {{tenancy.rent_frequency}} |
| Proposed new rent | |
| Rent period | {{tenancy.rent_frequency}} |
| Date of this notice | {{doc.issue_date|date}} |
| Date the new rent takes effect | |
| Date of the last increase | |

The proposed new rent, the effective date and the date of the last increase are completed before service. The effective date must be at least two months after the date of this notice and must be the first day of a rental period.

## 3. Statement of the Landlord's Proposal

**3.1** The Landlord proposes to increase the rent for the Property to the amount shown in section 2, with effect from the date shown in that section.

**3.2** The date on which the new rent takes effect is at least two months after the date of this notice, and is the first day of a rental period. The rent is due on {{tenancy.rent_due_day}} under the tenancy.

**3.3** The rent has not been increased during the 12 months before the date on which the new rent takes effect, and no further increase may take effect within 12 months of that date.

**3.4** All other terms of the tenancy remain unchanged. This notice does not vary the tenancy agreement and does not create a new tenancy.

## 4. Your Right to Challenge This Increase

**4.1** If you think the proposed new rent is higher than the rent that would be payable for a comparable property in the same area under a new tenancy, you may refer this notice to the First-tier Tribunal (Property Chamber).

**4.2** You must make the referral before the date on which the new rent is due to take effect. The referral is free and you do not need the Landlord's agreement to make it.

**4.3** The Tribunal will decide what the rent should be. Its decision replaces the amount in this notice and takes effect from the date in section 2, or from such other date as the Tribunal directs.

**4.4** If you do not refer this notice to the Tribunal before that date, the new rent becomes payable from the date in section 2 without further notice.

**4.5** Before deciding whether to refer the notice, you may wish to get advice from a local authority housing advice service, Citizens Advice or a housing solicitor, and to look at the rents currently advertised for similar homes nearby.

## 5. Service

**5.1** This notice is served on the Tenant on the date shown in section 2. It must be served in the form prescribed by regulations, and a copy should be kept by the Landlord together with proof of service.

**5.2** Service was effected by: hand delivery / first class post / electronic communication (delete as applicable).

## 6. Signature

**Landlord** — {{landlord.full_name}}

Signature: ______________________________________  Date: ____________________

{{#if agent.company_name}}
**Agent for the Landlord** — {{agent.name}} for {{agent.company_name}}

Signature: ______________________________________  Date: ____________________
{{/if}}

> *This document was assembled by TenancyDesk from a template. It is not legal advice. Always check the current law before signing.*
