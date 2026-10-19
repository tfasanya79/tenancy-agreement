---
id: deposit-prescribed-information
title: Tenancy Deposit Prescribed Information
category: deposit
jurisdiction: england-wales
version: "1.0"
updated: "2026-10-01"
description: The prescribed information about a protected tenancy deposit that must be given to the tenant and any relevant person within 30 days of the deposit being received.
required: [landlord.full_name, landlord.address, property.address_line1, tenancy.deposit_amount, tenancy.deposit_scheme, tenancy.deposit_received_date]
---
# Tenancy Deposit Prescribed Information

This information is given under section 213 of the Housing Act 1988 and the Housing (Tenancy Deposits) (Prescribed Information) Order 2007. It must be given to the tenant, and to any relevant person who paid the deposit on the tenant's behalf, within 30 days of the deposit being received.

## 1. The Deposit

| Item | Detail |
| --- | --- |
| Amount of deposit | {{tenancy.deposit_amount|money}} |
| Date received | {{tenancy.deposit_received_date|date}} |
| Property | {{property.address_line1}}, {{property.address_line2}}, {{property.city}}, {{property.postcode}} |
| Tenant | {{#each tenants}}{{this.full_name}} {{/each}} |
| Landlord | {{landlord.full_name}}, {{landlord.address}} |
| Agent | {{#if agent.company_name}}{{agent.company_name}}, {{agent.address}}, {{agent.phone}}, {{agent.email}}{{else}}None appointed{{/if}} |

## 2. The Scheme

| Item | Detail |
| --- | --- |
| Scheme name | {{tenancy.deposit_scheme}} |
| Scheme reference | {{tenancy.deposit_scheme_ref}} |
| Date deposit protected | {{tenancy.deposit_received_date|date}} |
| Landlord's contact for the deposit | {{landlord.full_name}}, {{landlord.address}}, {{landlord.phone}}, {{landlord.email}} |

The scheme named above is a government-approved tenancy deposit scheme. It holds contact details for the landlord and the tenant, and it operates a free dispute resolution service for disputes about the deposit.

## 3. The Prescribed Statements

The following statements form part of this information and are given to the tenant and to any relevant person.

- The deposit of {{tenancy.deposit_amount|money}} has been paid and is protected with {{tenancy.deposit_scheme}} under the reference above.
- The deposit is held as security for the performance of the tenant's obligations under the tenancy and for any loss, damage or unpaid sum for which the tenant is responsible at the end of the tenancy, other than fair wear and tear.
- The scheme is a government-approved tenancy deposit scheme and the deposit is registered with it.
- If the landlord fails to protect the deposit, or fails to give this prescribed information, within 30 days of receiving the deposit, the tenant may apply to the county court. The court may order the landlord to repay the deposit and to pay the tenant a sum of between one and three times the amount of the deposit.
- The scheme offers a free dispute resolution service, and the tenant may use it if a dispute about the deposit cannot be resolved with the landlord. The service is free to the tenant and does not need the landlord's agreement to be used.
- The tenant may contact the scheme at any time for information about the protection of the deposit, the scheme's procedures and the dispute resolution service.
- Where a relevant person paid the deposit on the tenant's behalf, or where a guarantor is a party to the tenancy, that person is also entitled to receive this information and may use the scheme's dispute resolution service.
- The information in this document is accurate to the best of the landlord's knowledge and belief.

## 4. When the Deposit May Be Retained

The landlord may keep part or all of the deposit only where the tenant agrees in writing, or where the scheme's dispute resolution service or a court decides that a deduction is due. Circumstances in which a deduction may be claimed include:

- rent owed at the end of the tenancy
- damage to the property, its fixtures, fittings or contents beyond fair wear and tear
- missing items that were listed in the inventory
- cleaning needed to return the property to the standard recorded at check-in, allowing for fair wear and tear
- unpaid bills or council tax that the tenant was responsible for under the tenancy agreement
- any other loss caused by a breach of the tenancy agreement

## 5. How the Deposit Is Returned

At the end of the tenancy the landlord must return the deposit, or the balance of it, within 10 days of the tenant and the landlord agreeing how much should be returned. If the parties cannot agree, either may refer the matter to the scheme's free dispute resolution service. The scheme will ask both parties for evidence, such as the tenancy agreement, the inventory and check-in report, the check-out report and photographs, and will decide how the deposit should be divided.

## 6. If You Cannot Contact the Landlord

If the tenant cannot contact the landlord, or the landlord does not respond, the tenant should contact the scheme named in section 2. The scheme holds the landlord's contact details and can help the tenant to recover the deposit. If the deposit is held by the scheme under a custodial arrangement, the scheme can release it in accordance with its procedures.

## 7. Declarations and Signature

The landlord confirms that the information in this document is accurate and that it has been given to the tenant, and to every relevant person, within 30 days of the deposit being received.

**Landlord** — {{landlord.full_name}}

Signature: ______________________________________  Date: ____________________

{{#if agent.company_name}}
**Agent** — {{agent.name}} for {{agent.company_name}}

Signature: ______________________________________  Date: ____________________
{{/if}}

{{#each tenants}}
**Tenant (receipt of this information acknowledged)** — {{this.full_name}}

Signature: ______________________________________  Date: ____________________

{{/each}}

{{#if guarantor.full_name}}
**Relevant person** — {{guarantor.full_name}}

Signature: ______________________________________  Date: ____________________
{{/if}}

> *This document was assembled by TenancyDesk from a template. It is not legal advice. Always check the current law before signing.*
