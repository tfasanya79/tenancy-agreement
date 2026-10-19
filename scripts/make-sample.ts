/**
 * `pnpm sample` — build a demo pack from the shipped templates.
 *
 * The details below are entirely fictional. The point is to show what the output
 * looks like without connecting to DeepSeek and without entering anything.
 * Files land in `samples/`, ready to open in Word or a browser.
 */

import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { loadConfig } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { generateDocuments } from '../src/docs/generate.ts';
import { TemplateRegistry } from '../src/docs/registry.ts';
import { runComplianceChecks } from '../src/docs/compliance.ts';

/** A fictional but complete tenancy, correct for the post-May-2026 regime. */
const SAMPLE_FIELDS: Record<string, unknown> = {
  'agent.company_name': 'Bridge Street Lettings Ltd',
  'agent.name': 'Jordan Fielding',
  'agent.email': 'jordan@bridgestreetlettings.example',
  'agent.phone': '0161 496 0000',
  'agent.address': '8 Bridge Street, Manchester M1 1AA',
  'agent.client_money_scheme': 'Propertymark Client Money Protection',
  'agent.redress_scheme': 'The Property Ombudsman',

  'landlord.full_name': 'Priya Raman',
  'landlord.address': '4 Oak Lane, Leeds LS1 4AB',
  'landlord.email': 'priya.raman@example.com',
  'landlord.phone': '07700 900456',

  'property.address_line1': '12 Bridge Street',
  'property.address_line2': 'Flat 3',
  'property.city': 'Manchester',
  'property.postcode': 'M1 2AB',
  'property.property_type': 'Flat',
  'property.bedrooms': 2,
  'property.furnished_status': 'Unfurnished',
  'property.garden': 'No outside space',
  'property.parking': 'One allocated space to the rear',
  'property.epc_rating': 'C',
  'property.epc_reference': 'EPC-2026-004512',
  'property.council_tax_band': 'B',
  'property.council_name': 'Manchester City Council',

  tenants: [
    {
      full_name: 'Alex Morgan',
      email: 'alex.morgan@example.com',
      phone: '07700 900123',
      dob: '1994-03-02',
      current_address: '22 Hawthorn Road, Stockport SK2 6HH',
      id_type: 'Passport',
      id_reference: 'P1234567',
    },
    {
      full_name: 'Sam Okafor',
      email: 'sam.okafor@example.com',
      phone: '07700 900789',
      dob: '1990-11-19',
      current_address: '22 Hawthorn Road, Stockport SK2 6HH',
      id_type: 'Driving licence',
      id_reference: 'MORGA901194SM9IJ',
    },
  ],

  'tenancy.start_date': '2026-11-01',
  'tenancy.rent_amount': 1250,
  'tenancy.rent_frequency': 'Monthly',
  'tenancy.rent_due_day': '1st of each month',
  'tenancy.payment_method': 'Standing order',
  'tenancy.payment_reference': 'M1 2AB',
  'tenancy.rent_in_advance': 1250,
  'tenancy.holding_deposit_amount': 288,
  'tenancy.deposit_amount': 1442,
  'tenancy.deposit_scheme': 'Deposit Protection Service (DPS)',
  'tenancy.deposit_scheme_ref': 'DPS-4471962',
  'tenancy.deposit_received_date': '2026-10-20',
  'tenancy.notice_period_tenant': '2 months',
  'tenancy.pets_allowed': 'By written request',
  'tenancy.pet_details': 'One cat, neutered',
  'tenancy.smoking_allowed': 'No',
  'tenancy.utilities_included': '',
  'tenancy.bills_responsibility': 'Tenant pays gas, electricity, water, broadband and council tax.',

  'utilities.gas_supplier': 'Octopus Energy',
  'utilities.electricity_supplier': 'Octopus Energy',
  'utilities.water_supplier': 'United Utilities',
  'utilities.broadband': 'Tenant to arrange',

  'safety.gas_safety_date': '2026-09-15',
  'safety.gas_safety_engineer': 'Gas Safe registered engineer 123456',
  'safety.eicr_date': '2026-02-01',
  'safety.eicr_next_due': '2031-02-01',
  'safety.smoke_alarms': 'Hallway, landing and living room — tested 01/11/2026',
  'safety.co_alarms': 'Next to the boiler — tested 01/11/2026',
  'safety.how_to_rent_date': '2026-10-25',
  'safety.right_to_rent_check_date': '2026-10-18',

  'doc.issue_date': '2026-10-19',
};

async function main() {
  const config = loadConfig();
  const registry = await TemplateRegistry.load(config.templatesDir);

  const buildDir = resolve('samples', '.build');
  await rm(buildDir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });

  const store = new Store(join(buildDir, 'data'));
  const pack = store.createPack(SAMPLE_FIELDS);

  const generated = await generateDocuments({
    store,
    registry,
    packId: pack.id,
    fields: pack.fields,
    fallbackFields: {
      'agent.company_name': config.agency.name || SAMPLE_FIELDS['agent.company_name'],
    },
  });

  const samplesDir = resolve('samples');
  await mkdir(samplesDir, { recursive: true });

  const written: string[] = [];
  let index = 1;
  for (const document of generated) {
    const stem = `${String(index).padStart(2, '0')}-${document.templateId}`;
    for (const [kind, path] of [
      ['docx', document.docxPath],
      ['html', document.htmlPath],
      ['md', document.mdPath],
    ] as const) {
      if (path === null) continue;
      const target = join(samplesDir, `${stem}.${kind}`);
      await copyFile(join(store.dataDir, path), target);
      written.push(target);
    }
    index += 1;
  }

  const report = runComplianceChecks(pack.fields);
  const summary = [
    'Sample document pack',
    '===================',
    '',
    'These files were generated by `pnpm sample` from the templates in `templates/`.',
    'The landlord, tenant and property are fictional. Every value was typed by the',
    'sample script — no AI was involved — so this shows the rendering, not a live run.',
    '',
    `Reference: ${pack.reference}`,
    'Tenant(s): Alex Morgan & Sam Okafor',
    'Property:  Flat 3, 12 Bridge Street, Manchester M1 2AB',
    '',
    'Documents:',
    ...generated.map((document, position) => `  ${position + 1}. ${document.title}`),
    '',
    `Compliance checks: ${report.counts.error} errors, ${report.counts.warning} warnings, ${report.counts.info} notes`,
    '',
    'How to look at these:',
    '  · Open the .docx files in Word, Pages or Google Docs.',
    '  · Open the .html files in a browser and press Print → Save as PDF.',
    '  · The .md files are the expanded source, useful for checking wording.',
    '',
    'This is not legal advice. Check every detail, and the current law, before signing.',
    '',
  ].join('\n');

  await writeFile(join(samplesDir, 'README.md'), summary, 'utf8');

  store.close();
  await rm(buildDir, { recursive: true, force: true });

  console.log('');
  console.log(`  Built ${generated.length} documents from ${registry.size} templates.`);
  console.log(`  Written to ${samplesDir}`);
  console.log('');
  console.log(`  Checks: ${report.counts.error} errors, ${report.counts.warning} warnings.`);
  for (const finding of report.findings.filter((item) => item.severity !== 'info')) {
    console.log(`    [${finding.severity}] ${finding.title}`);
  }
  console.log('');
}

await main();
