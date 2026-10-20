---
id: key-facts
title: Your tenancy at a glance
category: welcome
jurisdiction: england-wales
version: "1.0"
updated: "2026-10-20"
description: A one-page plain-English summary of the tenancy, for the tenant to keep.
required: [tenants, property.address_line1, tenancy.start_date, tenancy.rent_amount]
---
# Your tenancy at a glance

A short summary of what has been agreed, written to be read. The signed agreement is the document that actually binds you, and nothing on this page changes it.

## Where you are living

This tenancy is in the name of:

{{#each tenants}}
- {{this.full_name}}
{{/each}}

The address is {{property.address_line1}}{{#if property.address_line2}}, {{property.address_line2}}{{/if}}, {{property.city}} {{property.postcode}}.

{{#if property.room_number}}
Your room is {{property.room_number}}. The shared parts of the building come with it.
{{/if}}

## What you pay, and when

|  |  |
| --- | --- |
| Rent | {{tenancy.rent_amount|money}} {{tenancy.rent_frequency}} |
| Due | {{tenancy.rent_due_day}} |
| First payment | {{tenancy.payment_date|date}} |
| Tenancy started | {{tenancy.start_date|date}} |
| Deposit | {{tenancy.deposit_amount|money}} |
| Protected with | {{tenancy.deposit_scheme}} |
| Payment reference | {{tenancy.payment_reference}} |

{{#if tenancy.payment_method}}
Please pay by **{{tenancy.payment_method}}**.
{{/if}}

{{#if agent.rent_account}}
The account to pay into is {{agent.rent_account}}.
{{/if}}

## Ending the tenancy

If you want to leave, write to us. In England a tenant of this kind of tenancy gives **two months' notice**, and you may leave on the date the notice runs out. You do not pay a fee for giving notice.

## Who to contact

{{#if agent.company_name}}
Your point of contact is **{{agent.company_name}}**{{#if agent.phone}}, on {{agent.phone}}{{/if}}{{#if agent.email}}, or by email at {{agent.email}}{{/if}}.
{{/if}}

{{#if agent.name}}
The person dealing with your tenancy is {{agent.name}}.
{{/if}}

{{#if landlord.full_name}}
The landlord is {{landlord.full_name}}.
{{/if}}

## If something needs fixing

Tell us as soon as you notice it, in writing, so there is a record on both sides. Do not arrange a repair yourself unless it is an emergency — if it is, make it safe and tell us straight away.

{{#if utilities.gas_supplier}}
Your utilities are: gas {{utilities.gas_supplier}}, electricity {{utilities.electricity_supplier}}, water {{utilities.water_supplier}}. Please put the accounts in your own name from the start of the tenancy.
{{/if}}

## A note on this page

This summary was put together from the details recorded for your tenancy. If anything here looks different from what you agreed, tell us before you sign — the signed documents are what count.

> *This document was assembled by TenancyDesk from a template. It is not legal advice. Always check the current law before signing.*
