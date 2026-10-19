---
id: written-statement-of-terms
title: Written Statement of Terms of Tenancy
category: tenancy
jurisdiction: england-wales
version: "1.0"
updated: "2026-10-01"
description: The statutory written statement of the key terms of an assured periodic tenancy, to be given to the tenant within 28 days of the start of the tenancy.
required: [landlord.full_name, property.address_line1, tenancy.start_date, tenancy.rent_amount, tenancy.rent_frequency]
---
# Written Statement of Terms of Tenancy

This statement is given to you under the Renters' Rights Act 2025. It sets out the key terms of your tenancy in clear language. The landlord must give you a written statement within 28 days of the start of the tenancy. It summarises your tenancy agreement: the agreement is the full contract, and where the law gives you a stronger right than either document, the law applies.

## 1. The Key Terms

| Term | Detail |
| --- | --- |
| Landlord | {{landlord.full_name}}, {{landlord.address}} |
| Agent | {{#if agent.company_name}}{{agent.company_name}}, {{agent.address}}, {{agent.phone}}{{else}}None appointed{{/if}} |
| Property | {{property.address_line1}}, {{property.address_line2}}, {{property.city}}, {{property.postcode}} |
| Tenancy type | Assured periodic tenancy, no fixed end date |
| Start date | {{tenancy.start_date|date}} |
| Rent | {{tenancy.rent_amount|money}} {{tenancy.rent_frequency}} |
| Rent due | {{tenancy.rent_due_day}} |
| Payment method | {{tenancy.payment_method}}, reference {{tenancy.payment_reference}} |
| Deposit | {{tenancy.deposit_amount|money}}, protected with {{tenancy.deposit_scheme}} |
| Council tax band | {{property.council_tax_band}} |
| Energy rating | Band {{property.epc_rating}} |
| Pets | {{tenancy.pets_allowed}}{{#if tenancy.pet_details}} — {{tenancy.pet_details}}{{/if}} |
| Smoking | {{tenancy.smoking_allowed}} |

## 2. The Tenants

{{#each tenants}}
- {{this.full_name}}, {{this.email}}, {{this.phone}}
{{/each}}

Where more than one person is named, each tenant is responsible for all of the rent and for keeping to all of the terms. Each tenant may live in the whole property.

## 3. How the Tenancy Works

Your tenancy has no fixed end date. It continues month to month until you end it or a court ends it. There is no section 21 notice any more, so the landlord cannot ask you to leave without going to court on a legal ground.

## 4. Rent and Rent Increases

You must pay your rent on time by the method in the table. The rent can go up no more than once in any 12-month period. The landlord must use the section 13 procedure and give you at least two months' written notice, with the increase starting on the first day of a rental period. You can challenge a proposed increase at the First-tier Tribunal if you think it is above the market rent for a similar home nearby.

## 5. Your Deposit

Your deposit is protected with a government-approved tenancy deposit scheme within 30 days of being paid, and you must be given the prescribed information about it within the same 30 days. You will get your deposit back within 10 days of you and the landlord agreeing what should be returned. If you disagree about a deduction, the scheme offers a free dispute resolution service.

## 6. Bills

{{#if tenancy.utilities_included}}Included in your rent: {{tenancy.utilities_included}}.{{else}}No bills are included in your rent.{{/if}} You are responsible for gas, electricity, water, broadband, telephone, the television licence and council tax unless your tenancy agreement says otherwise.

## 7. Living in the Property

You may live in the property with your children and have guests to stay. You must keep the property clean, report repairs promptly, avoid causing nuisance to neighbours, and not use the property for business without written consent. The landlord or agent may inspect the property no more than once every three months and must give you at least 24 hours' written notice, except in an emergency.

## 8. Pets

You have the right to ask for permission to keep a pet. The landlord must reply in writing within 28 days, may refuse only for a valid reason given in writing, and may not refuse unreasonably. Permission may come with reasonable conditions.

## 9. Repairs and Safety

The landlord must keep the structure, exterior, and the installations for water, gas, electricity, heating and sanitation in repair, and must make sure the property is fit for human habitation. The landlord must also keep the gas safety record, the electrical installation condition report, the energy certificate, and the smoke and carbon monoxide alarms in order. Report any repair to the contact below; in an emergency involving gas, call the National Gas Emergency Service.

## 10. Ending the Tenancy

You may end the tenancy at any time by giving at least two months' written notice. You may leave sooner only if the landlord agrees in writing. The landlord may only take the property back through the court, using one of the grounds in Schedule 2 to the Housing Act 1988, after serving a section 8 notice and allowing the notice period for that ground.

## 11. Your Rights in Summary

- no section 21 eviction, and no eviction without a court order
- rent increased no more than once a year, with two months' notice
- no bidding war: nobody may ask you to offer more than the advertised rent
- no more than one month's rent taken in advance
- no refusal of a tenancy because you have children or receive benefits
- a right to request a pet
- a written statement of your terms within 28 days

## 12. Who to Contact

{{#if agent.company_name}}Your day-to-day contact is {{agent.name}} at {{agent.company_name}}: telephone {{agent.phone}}, email {{agent.email}}.{{else}}Your contact is the landlord, {{landlord.full_name}}: telephone {{landlord.phone}}, email {{landlord.email}}.{{/if}}

## 13. Documents Given to You

You should have received this statement, your tenancy agreement, the current How to Rent guide, the Energy Performance Certificate, the gas safety record, the electrical installation condition report, the deposit prescribed information, and the inventory and check-in report. Keep them somewhere safe.

## 14. Acknowledgement

Please sign below to confirm that you have received this written statement. Keep your copy with your tenancy papers.

{{#each tenants}}
**Tenant** — {{this.full_name}}

Signature: ______________________________________  Date received: ____________________

{{/each}}

**Landlord** — {{landlord.full_name}}

Signature: ______________________________________  Date: ____________________

> *This document was assembled by TenancyDesk from a template. It is not legal advice. Always check the current law before signing.*
