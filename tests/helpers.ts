/**
 * Shared test fixtures.
 *
 * Tests never touch the project's real `data/` folder or the real templates, so
 * running the suite can never damage a working copy.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempDir(prefix = 'tenancydesk-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeTemplate(dir: string, filename: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);
  writeFileSync(path, body, 'utf8');
  return path;
}

export const AGREEMENT_TEMPLATE = `---
id: test-agreement
title: Test Tenancy Agreement
category: tenancy
jurisdiction: england-wales
version: "1.0"
updated: "2026-10-01"
description: A small template used by the automated tests.
required: [landlord.full_name, property.address_line1, tenancy.start_date]
---
# Test Tenancy Agreement

This tenancy is between **{{landlord.full_name}}** and the tenant(s) below.

{{#each tenants}}
- {{this.full_name}} ({{this.email}})
{{/each}}

The property is at {{property.address_line1}}, {{property.postcode}}.

The tenancy starts on {{tenancy.start_date|date}}.

{{#if tenancy.deposit_amount}}
The deposit is {{tenancy.deposit_amount|money}}.
{{else}}
No deposit is held.
{{/if}}

{{#if tenancy.pets_allowed}}
A pet is permitted: {{tenancy.pet_details}}.
{{/if}}

| Item | Value |
| --- | --- |
| Rent | {{tenancy.rent_amount|money}} |
| Period | {{tenancy.rent_frequency}} |
`;

export const DEPOSIT_TEMPLATE = `---
id: test-deposit
title: Test Deposit Information
category: deposit
jurisdiction: england-wales
version: "1.0"
updated: "2026-10-01"
description: Deposit paperwork for the tests.
required: [tenancy.deposit_amount]
---
# Deposit Information

The deposit of {{tenancy.deposit_amount|money}} is protected with {{tenancy.deposit_scheme}}.

\\newpage

## Scheme details

Reference {{tenancy.deposit_scheme_ref}}.

> This is a test callout.
`;

export const GUARANTOR_TEMPLATE = `---
id: test-guarantee
title: Test Guarantor Deed
category: guarantee
jurisdiction: england-wales
version: "1.0"
updated: "2026-10-01"
description: Guarantee document for the tests.
required: [guarantor.full_name]
---
# Guarantee

The guarantor is {{guarantor.full_name}}.
`;

/** A pack that passes every check. */
export function completeFields(): Record<string, unknown> {
  return {
    'agent.company_name': 'Example Lettings Ltd',
    'agent.email': 'hello@example-lettings.test',
    'agent.phone': '0161 000 0000',
    'agent.client_money_scheme': 'Propertymark Client Money Protection',
    'agent.redress_scheme': 'The Property Ombudsman',
    'landlord.full_name': 'Priya Raman',
    'landlord.address': '4 Oak Lane, Leeds, LS1 4AB',
    'property.address_line1': '12 Bridge Street',
    'property.address_line2': 'Flat 3',
    'property.city': 'Manchester',
    'property.postcode': 'M1 2AB',
    'property.property_type': 'Flat',
    'property.bedrooms': 2,
    'property.furnished_status': 'Unfurnished',
    'property.epc_rating': 'C',
    'property.council_tax_band': 'B',
    tenants: [
      { full_name: 'Alex Morgan', email: 'alex@example.test', phone: '07700 900123', dob: '1994-03-02' },
    ],
    'tenancy.start_date': '2026-11-01',
    'tenancy.rent_amount': 1250,
    'tenancy.rent_frequency': 'Monthly',
    'tenancy.rent_due_day': '1st of each month',
    'tenancy.payment_method': 'Standing order',
    'tenancy.rent_in_advance': 1250,
    'tenancy.holding_deposit_amount': 288,
    'tenancy.deposit_amount': 1442,
    'tenancy.deposit_scheme': 'Deposit Protection Service (DPS)',
    'tenancy.deposit_scheme_ref': 'DPS-1234567',
    'tenancy.deposit_received_date': '2026-10-20',
    'tenancy.notice_period_tenant': '2 months',
    'tenancy.pets_allowed': 'No',
    'tenancy.smoking_allowed': 'No',
    'safety.gas_safety_date': '2026-09-15',
    'safety.gas_safety_engineer': 'Gas Safe 123456',
    'safety.eicr_date': '2026-02-01',
    'safety.smoke_alarms': 'Hallway and landing, tested 01/11/2026',
    'safety.co_alarms': 'Next to boiler',
    'safety.how_to_rent_date': '2026-10-25',
    'safety.right_to_rent_check_date': '2026-10-18',
  };
}
