---
id: apt-agreement
title: Assured Periodic Tenancy Agreement
category: tenancy
jurisdiction: england-wales
version: "2.0"
updated: "2026-10-01"
description: The core tenancy contract for a new letting of a self-contained home in England under the assured periodic tenancy regime.
required: [landlord.full_name, landlord.address, property.address_line1, property.postcode, tenancy.start_date, tenancy.rent_amount, tenancy.rent_frequency, tenancy.deposit_amount]
---
# Assured Periodic Tenancy Agreement

Reference {{doc.reference}}, issued {{doc.issue_date|date}}. This is an assured periodic tenancy with no fixed end date. Since 1 May 2026 section 21 of the Housing Act 1988 is abolished: no section 21 notice may be served, and nothing here creates a fixed term.

## 1. The Parties

**1.1 The Landlord** is {{landlord.full_name}} of {{landlord.address}}, telephone {{landlord.phone}}, email {{landlord.email}}, being the address for service of notices unless the Landlord notifies another address in England or Wales.

**1.2 The Agent.** {{#if agent.company_name}}The Landlord is represented by {{agent.company_name}} of {{agent.address}}, telephone {{agent.phone}}, email {{agent.email}}, through {{agent.name}}, a member of the {{agent.redress_scheme}} redress scheme and the {{agent.client_money_scheme}} client money protection scheme.{{else}}No agent is appointed and the Tenant should deal directly with the Landlord.{{/if}}

**1.3 The Tenant** or Tenants are:

{{#each tenants}}
- {{this.full_name}}, born {{this.dob|date}}, of {{this.current_address}}, email {{this.email}}, telephone {{this.phone}}, identity verified by {{this.id_type}} reference {{this.id_reference}}
{{/each}}

**1.4 Joint and several liability.** Each named Tenant is jointly and severally liable for the whole rent and every obligation, and may occupy the whole Property.

**1.5 The Guarantor.** {{#if guarantor.full_name}}{{guarantor.full_name}} of {{guarantor.address}} has guaranteed the Tenant's obligations by a separate deed of guarantee, to be read with this agreement.{{else}}No guarantor is a party to this tenancy.{{/if}}

## 2. The Property

| Item | Detail |
| --- | --- |
| Address | {{property.address_line1}}, {{property.address_line2}}, {{property.city}}, {{property.postcode}} |
| Type | {{property.property_type}} |
| Bedrooms | {{property.bedrooms}} |
| Furnishing | {{property.furnished_status}} |
| Energy performance | Band {{property.epc_rating}}, reference {{property.epc_reference}} |
| Council tax | Band {{property.council_tax_band}}, {{property.council_name}} |

{{#if property.garden}}
- **Garden or outside space:** {{property.garden}}
{{/if}}

{{#if property.parking}}
- **Parking:** {{property.parking}}
{{/if}}

**2.1** The Property is let with the Landlord's fixtures, fittings and the items in the inventory, in the condition recorded there. It is self-contained and the Tenant shares no living accommodation with the Landlord.

## 3. The Grant of the Tenancy

**3.1** The Landlord lets and the Tenant takes the Property as an assured periodic tenancy beginning on {{tenancy.start_date|date}} and continuing until ended under clause 14.

**3.2 No fixed end date.** The tenancy runs from one rental period to the next, with no fixed term or expiry date. It cannot be ended on a pre-agreed date, although the Tenant may leave earlier by agreement.

**3.3 Statutory basis and possession.** This is an assured tenancy under section 1 of the Housing Act 1988 as amended by the Renters' Rights Act 2025, whose statutory rights prevail over any inconsistent term. The Landlord may regain possession only by a section 8 notice on one or more Schedule 2 grounds and a court order, and will not evict, change the locks or cut utilities without one.

**3.4 Written statement of terms.** The Landlord has given, or will give within 28 days of the start of the tenancy, the statutory written statement of terms, which summarises these terms and does not replace this agreement.

## 4. Rent

**4.1** The rent is {{tenancy.rent_amount|money}} payable {{tenancy.rent_frequency}}, due on {{tenancy.rent_due_day}} of each rental period by {{tenancy.payment_method}} quoting reference {{tenancy.payment_reference}}.

**4.2 Payment.** Rent must be paid in cleared funds without deduction or set-off, except where statute requires. Payment is not conditional on repairs, but the Tenant keeps every statutory remedy for disrepair.

**4.3 Advance rent.** No more than one month's rent, or one rental period where that is shorter than a month, may be required or accepted in advance. Rent in advance is held against the periods it covers and is not a fee.

{{#if tenancy.rent_in_advance}}
**4.4 Rent in advance.** {{tenancy.rent_in_advance}} has been paid in advance and applied to the periods it covers, as receipted to the Tenant.
{{/if}}

**4.5 No rental bidding.** Neither the Landlord nor the Agent may ask for, invite, encourage or accept an offer of rent above the rent advertised for the Property. Such a request is unlawful and may be reported to the local authority trading standards service.

**4.6 Fees and late rent.** Only the rent, deposit, any holding deposit, a payment for a variation, assignment or early termination requested by the Tenant, and utilities, council tax and communications may be required. No charge arises for rent less than 14 days overdue; after that interest at 3 per cent above the Bank of England base rate may be charged.

## 5. Rent Review

**5.1 Once a year only.** The rent may be increased no more than once in any 12-month period, and not within 12 months of the last increase or of the start of the tenancy.

**5.2 Section 13 procedure.** An increase must be by a section 13 notice in the prescribed form, given at least two months before the new rent takes effect on the first day of a rental period. The Tenant may refer it to the First-tier Tribunal (Property Chamber) before then if it exceeds open market rent for a comparable property; otherwise the new rent is payable from the stated date.

## 6. Deposit and Holding Deposit

**6.1 Deposit.** The tenancy deposit is {{tenancy.deposit_amount|money}}, held as security for the Tenant's obligations and for loss, damage or unpaid sums for which the Tenant is responsible, other than fair wear and tear.

**6.2 Protection within 30 days.** The deposit is protected with {{tenancy.deposit_scheme}}{{#if tenancy.deposit_scheme_ref}}, scheme reference {{tenancy.deposit_scheme_ref}}{{/if}}. It was received on {{tenancy.deposit_received_date|date}} and must be protected with a government-approved tenancy deposit scheme within 30 days.

**6.3 Prescribed information.** Within those 30 days the Landlord must give the Tenant, and any relevant person who paid the deposit, the prescribed information about the scheme, the protection of the deposit and its free dispute resolution service, provided separately.

**6.4 Return.** The deposit, less any amount properly agreed as due, must be returned within 10 days of the parties agreeing the sum. Disagreement goes to the scheme's free dispute service.

**6.5 Cap and protection.** A deposit may not exceed five weeks' rent where annual rent is below £50,000, or six weeks' where it is £50,000 or more. If the Landlord fails to protect it or give the prescribed information in time, the county court may order its return plus one to three times its amount.

{{#if tenancy.holding_deposit_amount}}
**6.6 Holding deposit.** A holding deposit of {{tenancy.holding_deposit_amount|money}} was paid. It may not exceed one week's rent and is applied to rent or the deposit, or refunded, within seven days of entering the tenancy, and may be kept only in the circumstances the law allows.
{{/if}}

## 7. Utilities and Council Tax

**7.1** The Tenant pays all charges for gas, electricity, water and sewerage, broadband, telephone and the television licence, except anything included in the rent under clause 7.2. Readings are recorded in the check-in report and again at the end.

**7.2 Included in the rent.** {{#if tenancy.utilities_included}}{{tenancy.utilities_included}}{{else}}No utilities or other outgoings are included in the rent.{{/if}}

**7.3 Council tax.** The Tenant is responsible for council tax unless an exemption applies. Band {{property.council_tax_band}}, billed by {{property.council_name}}.

| Utility | Supplier at the start of the tenancy |
| --- | --- |
| Gas | {{utilities.gas_supplier}} |
| Electricity | {{utilities.electricity_supplier}} |
| Water and sewerage | {{utilities.water_supplier}} |
| Broadband | {{utilities.broadband}} |

**7.4 Responsibility.** {{#if tenancy.bills_responsibility}}{{tenancy.bills_responsibility}}{{else}}The Tenant holds these accounts in the Tenant's own name from the start, and the Landlord pays charges for an earlier period.{{/if}}

## 8. Use and Occupancy

**8.1** The Tenant may use the Property as the Tenant's only or main home, with the Tenant's children, and may have visitors including overnight guests. The Tenant must not use it for trade without written consent or for any illegal purpose, must not cause nuisance to neighbours, and must not overcrowd it.

**8.2 No discrimination.** Neither the Landlord nor the Agent may refuse to let to, or treat less favourably, any person because that person has children or receives benefits. Any term with that effect is void.

**8.3** The Tenant must tell the Landlord in writing if anyone other than the named Tenants is to live at the Property as their main home.

## 9. Pets

**9.1 Right to request a pet.** The Tenant may ask the Landlord in writing for permission to keep a pet at the Property.

**9.2 Response.** The Landlord must reply in writing within 28 days, may refuse only for a valid reason stated in writing, and may not refuse unreasonably.

**9.3 Conditions.** Consent may be conditional on pet insurance, flea treatment and professional cleaning at the end, and repair of damage caused by the pet.

**9.4 Current position.** The position recorded for this tenancy is: {{tenancy.pets_allowed}}.

{{#if tenancy.pet_details}}
Pets are permitted at the Property on this basis: {{tenancy.pet_details}}. The Tenant remains responsible for any damage caused by the pet beyond fair wear and tear.
{{/if}}

Where no pet is currently authorised, a written request will be dealt with under this clause, and the absence of consent does not prevent the Tenant from making one.

**9.5 Smoking and assistance dogs.** The position recorded on smoking is: {{tenancy.smoking_allowed}}. The Tenant must not smoke in a way that causes damage, nuisance or a fire risk, must keep the Property well ventilated, and must ensure guests follow the same position. Assistance dogs are unaffected by this clause and need no consent.

## 10. Repairs, Safety and the Landlord's Obligations

**10.1 Section 11 repairs.** The Landlord must keep in repair the structure and exterior, including drains and external pipes, and keep in repair and proper working order the installations for water, gas, electricity, sanitation, space heating, heating water and ventilation. These duties cannot be excluded.

**10.2 Habitation.** The Property must be fit for human habitation at the start of the tenancy and throughout it, under the Homes (Fitness for Human Habitation) Act 2018.

| Obligation | Requirement | Recorded |
| --- | --- | --- |
| Gas safety | Annual Gas Safe check, record given before the tenancy and within 28 days of each check | {{safety.gas_safety_date|dateshort}}, {{safety.gas_safety_engineer}} |
| Electrical safety | EICR every five years, report given to the Tenant | {{safety.eicr_date|dateshort}}, next {{safety.eicr_next_due|dateshort}} |
| Energy performance | Valid EPC, minimum band E, given to the Tenant | Band {{property.epc_rating}} |
| Smoke alarms | Working alarm on every storey | {{safety.smoke_alarms}} |
| Carbon monoxide | Working alarm in any room with a fixed combustion appliance or flue | {{safety.co_alarms}} |
| How to Rent guide | Current version given at the start | {{safety.how_to_rent_date|dateshort}} |
| Right to rent | Checks on every adult occupier before the tenancy starts | {{safety.right_to_rent_check_date|dateshort}} |

**10.3** The Tenant must not do work that is the Landlord's responsibility, but may carry out minor repairs and decoration with written consent, not unreasonably withheld.

**10.4 Retaliation.** The Landlord will not seek possession or take any other step in retaliation for a repair request, a complaint about the Property's condition, or a report to the local authority.

## 11. The Tenant's Obligations

The Tenant agrees to:

- pay the rent on time and the outgoings for which the Tenant is responsible under clause 7
- keep the interior clean and tidy and decorated as reasonably necessary, allowing for fair wear and tear
- report any defect, damage or disrepair without delay, and ventilate and heat the Property to prevent damp
- test the smoke and carbon monoxide alarms and report a faulty alarm at once
- make no alteration or redecoration, and change no lock, without written consent
- remove none of the Landlord's furniture or fittings
- keep the Property secure and give notice before leaving it empty for more than 30 consecutive days
- assign, sublet or part with possession only as clause 13 permits
- give a forwarding address at the end and return all keys

## 12. Access and Inspections

**12.1 Quiet enjoyment.** The Tenant is entitled to quiet enjoyment of the Property and the Landlord will not interfere with that right.

**12.2 Access.** The Landlord, the Agent or a contractor may enter to inspect or repair only after at least 24 hours' written notice and at a reasonable time of day. Routine inspections take place no more than once every three months, and the Tenant may be present.

**12.3 Emergency.** The Landlord may enter without notice in an emergency risking people or the Property, such as fire, flood or a gas leak.

## 13. Assignment and Subletting

**13.1** The Tenant must not assign this tenancy, sublet the whole of the Property or part with possession without the Landlord's prior written consent, not unreasonably refused and possibly conditional.

**13.2** The Tenant may take in a lodger or sublet part only with prior written consent, and remains fully liable for the whole Property and the rent. A joint Tenant who wants to leave needs a variation signed by the Landlord and every Tenant, staying liable until it is signed.

{{#if tenancy.break_clause}}
**13.3 Agreed arrangements.** {{tenancy.break_clause}} This creates no fixed term and does not affect clause 14.1.
{{/if}}

## 14. Ending the Tenancy

**14.1 Tenant's notice.** The Tenant may end this tenancy by giving at least two months' written notice. That statutory period is not shortened here; the tenancy ends at the end of the notice period, with rent payable to that date.

**14.2 Leaving earlier.** The Tenant may leave earlier only if the Landlord agrees in writing. That is a surrender, and the Landlord may not impose a charge the law prohibits.

**14.3 Landlord's notice.** The Landlord may not end this tenancy without a court order, and may regain possession only by a section 8 notice on one or more Schedule 2 grounds, allowing the notice period for each, and then a possession order. Section 21 no longer exists.

**14.4 Proceedings.** A section 8 notice does not end the tenancy or entitle the Landlord to possession. Until a court order is enforced the Tenant may remain and may ask the court to adjourn or suspend proceedings.

**14.5 Death or departure of a joint Tenant.** If a sole Tenant dies the tenancy ends two months after the date of death. A joint Tenant who gives two months' notice ends that Tenant's own interest, and the tenancy continues for the others.

**14.6 At the end.** The Tenant must give up the Property in the condition it was let, allowing for fair wear and tear, return every key, and leave it clean and clear of belongings.

## 15. Data Protection and Notices

**15.1** The Landlord and the Agent process the Tenant's personal data to perform this agreement and meet legal duties: deposit protection, safety checks, right to rent checks, fraud prevention and recovery of unpaid sums.

**15.2** Data may be shared with the deposit scheme, utility providers, the council, contractors, identity verification providers, professional advisers and a public authority where the law requires, and kept no longer than necessary. The Tenant may request a copy, ask for corrections or object, or complain to the Information Commissioner's Office.

**15.3** A notice must be in writing and may be delivered by hand, posted to the addresses in clauses 1.1 and 1.3, or emailed to the address last notified. A statutory notice must be served in the form and manner the statute requires.

## 16. General

**16.1** This agreement is governed by the law of England and Wales. It may be varied only in writing signed by the Landlord and every Tenant; a variation reducing a statutory right has no effect, and if a term is invalid the rest continues.

\newpage

## 17. Signatures

The parties sign on the date shown and confirm that they have read and understood this agreement, that the Tenant has had the opportunity to take advice, and that the information in it is accurate.

**Landlord**

Name: {{landlord.full_name}}

Signature: ______________________________________  Date: ____________________

{{#each tenants}}
**Tenant**

Name: {{this.full_name}}

Signature: ______________________________________  Date: ____________________

{{/each}}

**Guarantor** — {{#if guarantor.full_name}}{{guarantor.full_name}}{{else}}not applicable to this tenancy{{/if}}

Signature: ______________________________________  Date: ____________________

{{#if agent.company_name}}
**Signed for and on behalf of the Landlord** by {{agent.name}} of {{agent.company_name}}

Signature: ______________________________________  Date: ____________________
{{/if}}

> *This document was assembled by TenancyDesk from a template. It is not legal advice. Always check the current law before signing.*
