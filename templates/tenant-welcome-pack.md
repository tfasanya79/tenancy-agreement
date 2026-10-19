---
id: tenant-welcome-pack
title: Tenant Welcome Pack
category: welcome
jurisdiction: england-wales
version: "1.0"
updated: "2026-10-01"
description: A plain-English welcome letter for a new tenant covering contacts, paying rent, repairs, bills and what happens next.
required: [landlord.full_name, property.address_line1, tenancy.start_date, tenancy.rent_amount]
---
# Welcome to Your New Home

Hello {{#each tenants}}{{this.full_name}}, {{/each}}and welcome to {{property.address_line1}}, {{property.city}}, {{property.postcode}}. We are really pleased you have chosen this home, and we want your move to be as easy as possible. This letter explains who to contact, how to pay your rent, how to get a repair sorted and what happens next. There is no legal jargon here, so keep it somewhere handy.

## Who to Contact

{{#if agent.company_name}}Your main contact is {{agent.name}} at {{agent.company_name}}. You can call on {{agent.phone}} or email {{agent.email}}. The office address is {{agent.address}}.{{else}}Your main contact is {{landlord.full_name}}. You can call on {{landlord.phone}} or email {{landlord.email}}, or write to {{landlord.address}}.{{/if}}

For anything urgent outside office hours, such as a leak, a broken boiler in cold weather or a security problem, use the same number and say clearly that it is urgent.

## How to Pay Your Rent

Your rent is {{tenancy.rent_amount|money}} {{tenancy.rent_frequency}}, due on {{tenancy.rent_due_day}}. Please pay by {{tenancy.payment_method}} and always quote the reference {{tenancy.payment_reference}} so your payment reaches the right account. If you think you will have trouble paying on time, tell us before the due date. It is always easier to sort out a payment plan early.

Your deposit of {{tenancy.deposit_amount|money}} is protected with {{tenancy.deposit_scheme}}, and you will receive the paperwork confirming this.

## Reporting a Repair

Tell us as soon as something needs fixing, even if it seems small. A slow leak or a small damp patch is much cheaper to sort out early. When you report a repair, please tell us where it is, what has happened and how urgent you think it is, and send a photo if you can. We will confirm what will happen next and when.

You must let a contractor in to do the work, and we will always give you at least 24 hours' written notice before a visit unless there is a real emergency.

If you ever smell gas, do not touch any switches. Turn the gas off at the meter if you can safely reach it, open the windows and call the National Gas Emergency Service straight away. Then let us know.

## Your Bills

{{#if tenancy.utilities_included}}Included in your rent: {{tenancy.utilities_included}}. Everything else is yours to set up.{{else}}No bills are included in your rent.{{/if}} You will need to set up your own accounts for gas, electricity, water, broadband and council tax from {{tenancy.start_date|date}}. Current suppliers are gas: {{utilities.gas_supplier}}, electricity: {{utilities.electricity_supplier}}, water: {{utilities.water_supplier}}. The council tax band is {{property.council_tax_band}} and the council is {{property.council_name}}. Take meter readings on the day you move in and keep a note of them.

## Your Home and Your Rights

Your tenancy has no fixed end date. It carries on until you end it, and you can do that at any time by giving two months' written notice. Nobody can ask you to leave without a court order, and there is no "no fault" eviction any more.

Your rent can only go up once a year, using the section 13 procedure, with at least two months' written notice. You can challenge an increase at the First-tier Tribunal if you think it is too high.

You are welcome to have guests and to live here with your children. If you would like a pet, just ask in writing. We must reply within 28 days and can only say no for a valid reason, given in writing.

## Practical Bits

- the smoke alarms are on every storey and the carbon monoxide alarm is where there is a fuel-burning appliance; please test them every month
- your keys: please tell us straight away if you lose one
- bins and recycling are collected by {{property.council_name}}; check their website for collection days
- please do not change the locks without asking us first

## What Happens Next

We will check in with you about a week after you move in to see how things are going, and after that we will inspect the property about once every three months, with notice. At the end we will use the inventory and check-in report to agree the condition of the property, so keep it somewhere safe.

If anything in this pack is unclear, call or email us. We would much rather hear from you early than have a small problem become a big one.

With best wishes for your new home.

{{#if agent.company_name}}{{agent.name}}, {{agent.company_name}}{{else}}{{landlord.full_name}}{{/if}}

> *This document was assembled by TenancyDesk from a template. It is not legal advice. Always check the current law before signing.*
