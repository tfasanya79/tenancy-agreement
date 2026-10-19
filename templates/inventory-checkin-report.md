---
id: inventory-checkin-report
title: Inventory and Check-In Report
category: inventory
jurisdiction: england-wales
version: "1.0"
updated: "2026-10-01"
description: Room-by-room record of the condition of the property, its contents, meter readings and keys at the start of the tenancy.
required: [property.address_line1, tenancy.start_date, tenants]
---
# Inventory and Check-In Report

| Item | Detail |
| --- | --- |
| Property | {{property.address_line1}}, {{property.address_line2}}, {{property.city}}, {{property.postcode}} |
| Tenancy start date | {{tenancy.start_date|date}} |
| Report prepared by | {{#if agent.company_name}}{{agent.name}}, {{agent.company_name}}{{else}}{{landlord.full_name}}{{/if}} |
| Tenant | {{#each tenants}}{{this.full_name}} {{/each}} |
| Furnishing | {{property.furnished_status}} |

This report records the condition of the Property and its contents on the date of check-in. It is evidence of the condition at the start of the tenancy and is used at check-out to decide whether any damage beyond fair wear and tear has occurred. Please read it, note anything you disagree with in the comments column of each room, and sign section 6.

## 1. How to Read the Condition Grades

| Grade | Meaning |
| --- | --- |
| A | New or as new, no defects |
| B | Good, minor wear consistent with careful use |
| C | Fair, noticeable wear but clean and working |
| D | Poor, damage or defect noted in the comments |
| E | Unusable or missing, replacement needed |

## 2. Room-by-Room Record

| Room | Item | Condition | Cleanliness | Comments |
| --- | --- | --- | --- | --- |
| Entrance and hall | Door, lock, floor, walls, ceiling, light fittings | | | |
| Living room | Walls, ceiling, floor, windows, curtains, furniture | | | |
| Kitchen | Units, worktops, sink, taps, oven, hob, extractor, fridge, freezer, washing machine | | | |
| Bedroom 1 | Walls, ceiling, floor, windows, curtains, bed, mattress, wardrobe, chest of drawers | | | |
| Bedroom 2 | Walls, ceiling, floor, windows, curtains, storage | | | |
| Bathroom | Bath or shower, screen, basin, toilet, tiles, sealant, extractor fan | | | |
| Separate WC | Toilet, cistern, seat, floor, walls | | | |
| Hall, stairs and landing | Walls, ceiling, floor, banister, smoke alarm | | | |
| Outside and garden | Paths, fences, gates, bins, external walls, guttering | | | |
| Parking and outbuildings | Parking space, garage, shed, access | | | |

## 3. Safety Equipment Check

| Item | Fitted | Tested | Working | Notes |
| --- | --- | --- | --- | --- |
| Smoke alarms (every storey) | {{safety.smoke_alarms}} | | | |
| Carbon monoxide alarms | {{safety.co_alarms}} | | | |
| Gas safety record given | {{safety.gas_safety_date|dateshort}} | | | |
| Electrical report given | {{safety.eicr_date|dateshort}} | | | |
| Energy certificate given | Band {{property.epc_rating}} | | | |
| How to Rent guide given | {{safety.how_to_rent_date|dateshort}} | | | |

## 4. Meter Readings

| Meter | Reading | Serial number | Supplier |
| --- | --- | --- | --- |
| Electricity | | | {{utilities.electricity_supplier}} |
| Gas | | | {{utilities.gas_supplier}} |
| Water | | | {{utilities.water_supplier}} |

## 5. Keys and Access

| Item | Number supplied | Notes |
| --- | --- | --- |
| Front door key | | |
| Back door key | | |
| Window or patio keys | | |
| Meter box or cupboard key | | |
| Fobs or entry devices | | |
| Bin store or gate key | | |

All keys listed must be returned at the end of the tenancy. A charge may be made for replacing keys, locks or fobs that are not returned, at the landlord's reasonable cost.

## 6. Tenant Comments and Agreement

Tenant comments and any agreed variations to this report:

| Room or item | Comment |
| --- | --- |
| | |

By signing below, the Tenant confirms that this report is an accurate record of the condition of the Property and its contents at the start of the tenancy, except for any comments recorded above. The Landlord confirms that the items listed were present and in the stated condition.

{{#each tenants}}
**Tenant** — {{this.full_name}}

Signature: ______________________________________  Date: ____________________

{{/each}}

**Landlord or agent** — {{#if agent.company_name}}{{agent.name}} for {{agent.company_name}}{{else}}{{landlord.full_name}}{{/if}}

Signature: ______________________________________  Date: ____________________

A copy of this signed report has been given to the Tenant and should be kept with the tenancy papers.

> *This document was assembled by TenancyDesk from a template. It is not legal advice. Always check the current law before signing.*
