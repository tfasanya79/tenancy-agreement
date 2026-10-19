---
id: right-to-rent-checklist
title: Right to Rent and Pre-Tenancy Compliance Checklist
category: compliance
jurisdiction: england-wales
version: "1.0"
updated: "2026-10-01"
description: A checklist of the right to rent and pre-tenancy compliance steps that must be completed before a new tenancy starts.
required: [property.address_line1, tenancy.start_date, tenants]
---
# Right to Rent and Pre-Tenancy Compliance Checklist

This checklist records the right to rent check and the other pre-tenancy compliance steps for a new letting. Right to rent checks must be carried out before the tenancy starts, for every adult who will live at the Property, and copies must be kept for the duration of the tenancy and for at least two years afterwards. A landlord who lets to someone who does not have the right to rent may face a civil penalty for each illegal occupier, and repeat breaches are penalised more heavily.

Complete every row before the tenancy starts and record the date and the initials of the person who completed the check.

## 1. The Letting

| Item | Detail |
| --- | --- |
| Property | {{property.address_line1}}, {{property.address_line2}}, {{property.city}}, {{property.postcode}} |
| Tenancy starts | {{tenancy.start_date|date}} |
| Landlord | {{landlord.full_name}} |
| Adult occupiers to be checked | {{#each tenants}}{{this.full_name}}; {{/each}} |
| Check completed by | {{#if agent.company_name}}{{agent.name}}, {{agent.company_name}}{{else}}{{landlord.full_name}}{{/if}} |
| Reference | {{doc.reference}} |

## 2. Right to Rent Checks

| Check | Requirement | Status | Date | Initials |
| --- | --- | --- | --- | --- |
| Identity document seen | Original document checked in the presence of the occupier, or verified through a Home Office approved identity service | | | |
| Document is genuine | Photograph and details match the person, dates are valid, document not tampered with | | | |
| Right to rent confirmed | Occupier has an unlimited or time-limited right to rent in England | | | |
| Copy retained | Copy of the document retained securely, with the date of the check recorded | | | |
| Follow-up check diarised | Where permission is time-limited, the follow-up date is recorded and diarised | | | |
| Every adult occupier checked | Including any adult who is not a named Tenant | | | |
| Occupier list agreed | Names of all adults who will live at the Property recorded | | | |

## 3. Pre-Tenancy Compliance

| Check | Requirement | Status | Date | Initials |
| --- | --- | --- | --- | --- |
| Written statement of terms | Prepared and due within 28 days of the start date | | | |
| Tenancy agreement | Signed by every Tenant, and by any Guarantor by deed | | | |
| Deposit cap checked | No more than five weeks' rent where annual rent is below £50,000 | | | |
| Rent in advance | No more than one month's rent taken in advance | | | |
| Holding deposit | No more than one week's rent, receipted, applied or refunded within seven days | | | |
| Deposit protected | Protected with a government-approved scheme within 30 days of receipt | | | |
| Prescribed information | Given to the Tenant and any relevant person within 30 days | | | |
| How to Rent guide | Current version given to the Tenant | {{safety.how_to_rent_date|dateshort}} | | |
| Energy Performance Certificate | Valid certificate, minimum band E, given to the Tenant | {{property.epc_rating}} | | |
| Gas safety record | Current record given, and a copy left at the Property | {{safety.gas_safety_date|dateshort}} | | |
| Electrical report | EICR in date and given to the Tenant | {{safety.eicr_date|dateshort}} | | |
| Smoke alarms | Working alarm on every storey | {{safety.smoke_alarms}} | | |
| Carbon monoxide alarms | Working alarm where required | {{safety.co_alarms}} | | |
| Appliance and furniture checks | Any soft furnishings and appliances compliant and in working order | | | |
| Landlord identity and address | Landlord's name and address recorded in the agreement, and any change notified to the Tenant | | | |
| Rental bidding | No offer above the advertised rent requested, invited or accepted | | | |
| Advertising wording | No wording excluding people with children or people receiving benefits | | | |
| Privacy notice | Data protection information given to the Tenant | | | |
| Inventory and check-in | Completed and signed, meter readings recorded | | | |
| Utilities and council tax | Suppliers and council recorded; council notified of the new tenancy | | | |
| Keys issued | Number of keys issued recorded and acknowledged by the Tenant | | | |

## 4. Notes and Follow-Up Actions

Record any gaps, missing documents or follow-up dates here.

| Item | Action required | Owner | Due date |
| --- | --- | --- | --- |
| | | | |

## 5. Declaration

The person completing this checklist confirms that the checks recorded above were carried out, that the copies of documents have been retained securely, and that any outstanding item has been noted with an action.

| Signatory | Name | Signature | Date |
| --- | --- | --- | --- |
| Check completed by | {{#if agent.company_name}}{{agent.name}}{{else}}{{landlord.full_name}}{{/if}} | | |
| Landlord | {{landlord.full_name}} | | |

> *This document was assembled by TenancyDesk from a template. It is not legal advice. Always check the current law before signing.*
