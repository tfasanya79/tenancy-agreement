/**
 * `pnpm demo:fill` — prove the "use their own document" path works.
 *
 * Builds a Word file resembling an agency's own agreement (with the previous
 * tenant's details typed in), then fills it for a new tenant using the eight
 * values a letting agent actually changes, and writes the result so it can be
 * opened in Word.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from 'docx';

import { buildReplacements, extractDocxText, fillDocx, type SlotLink } from '../src/docs/docxFill.ts';
import { mergeFields } from '../src/docs/fields.ts';

/** Stand-in for the agency's own agreement, with the *previous* tenant's details. */
const THEIR_DOCUMENT = {
  houseAddress: '14 Beech Road, Walthamstow, London E17 3NU',
  roomNumber: 'Room 1',
  monthlyPayment: '£980',
  startDate: '30 October 2026',
  paymentDate: '29 October 2026',
  inventoryDate: '30 October 2026',
  tenantName: 'Angela Anyanwu',
  tenantEmail: 'angela.anyanwu@example.com',
};

async function buildAgencyDocx(): Promise<Buffer> {
  const d = THEIR_DOCUMENT;
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'BUY TO LET ASSURED PERIODIC TENANCY AGREEMENT', heading: HeadingLevel.TITLE }),
          new Paragraph({ children: [new TextRun({ text: 'Room by room letting', italics: true, size: 20 })] }),
          new Paragraph({ text: '' }),
          new Paragraph({ text: '1. The Property', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [new TextRun('The Landlord lets '), new TextRun({ text: d.roomNumber, bold: true }), new TextRun(`, ${d.houseAddress}, to the Tenant.`)],
          }),
          new Paragraph({ text: '2. The Tenancy', heading: HeadingLevel.HEADING_1 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [new TableCell({ children: [new Paragraph('Tenant')] }), new TableCell({ children: [new Paragraph(d.tenantName)] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('Email')] }), new TableCell({ children: [new Paragraph(d.tenantEmail)] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('Monthly payment')] }), new TableCell({ children: [new Paragraph(d.monthlyPayment)] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('Contract start date')] }), new TableCell({ children: [new Paragraph(d.startDate)] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('Payment date')] }), new TableCell({ children: [new Paragraph(`${d.paymentDate}, then monthly`)] })] }),
            ],
          }),
          new Paragraph({ text: '' }),
          new Paragraph({ text: '3. Schedule of Condition', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun('The Schedule of Condition and inventory was agreed on '), new TextRun({ text: d.inventoryDate, bold: true }), new TextRun('.')] }),
          new Paragraph({ text: '' }),
          new Paragraph({ children: [new TextRun('Signed by the Tenant: '), new TextRun({ text: d.tenantName, bold: true }), new TextRun('  Date: ______________')] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(document);
}

/** What the agency would confirm once, on screen: which blank holds which detail. */
const LINKS: SlotLink[] = [
  { field: 'property.room_number', sample: THEIR_DOCUMENT.roomNumber, label: 'Room number' },
  { field: 'property.address_line1', sample: THEIR_DOCUMENT.houseAddress, label: 'House address' },
  { field: 'tenants[0].full_name', sample: THEIR_DOCUMENT.tenantName, label: 'Tenant name', all: true },
  { field: 'tenants[0].email', sample: THEIR_DOCUMENT.tenantEmail, label: "Tenant's email" },
  { field: 'tenancy.rent_amount', sample: THEIR_DOCUMENT.monthlyPayment, label: 'Monthly payment' },
  // The inventory date and the start date are the same in the old document, so
  // this link names the words around it to pick the right one.
  {
    field: 'inventory.scheduled_date',
    sample: THEIR_DOCUMENT.inventoryDate,
    label: 'Inventory date',
    near: 'inventory was agreed',
  },
  { field: 'tenancy.start_date', sample: THEIR_DOCUMENT.startDate, label: 'Contract start date' },
  { field: 'tenancy.payment_date', sample: THEIR_DOCUMENT.paymentDate, label: 'Payment date' },
];

/** The new tenant, entered through the form or the chat. */
const NEW_TENANT = {
  tenants: [{ full_name: 'Alex Morgan', email: 'alex.morgan@example.com' }],
  'property.room_number': 'Room 2',
  'property.address_line1': '14 Beech Road, Walthamstow, London E17 3NU',
  'tenancy.rent_amount': 1450,
  'tenancy.start_date': '2026-11-01',
  'tenancy.rent_frequency': 'Monthly',
  'inventory.scheduled_date': '2026-10-31',
};

async function main() {
  const outDir = join('.incoming', 'demo');
  await mkdir(outDir, { recursive: true });

  const original = await buildAgencyDocx();
  await writeFile(join(outDir, '01-their-agreement-before.docx'), original);

  const fields = mergeFields({}, NEW_TENANT).merged;
  const replacements = buildReplacements(fields, LINKS);

  console.log(`\nFirst payment date was derived as: ${String(fields['tenancy.payment_date'])} (day before the start date)`);

  const result = fillDocx(original, replacements);
  await writeFile(join(outDir, '02-filled-for-new-tenant.docx'), result.buffer);

  console.log(`\nSubstitutions made (${result.applied.length}):`);
  for (const change of result.applied) {
    console.log(`  ✓ ${(change.label ?? '').padEnd(20)} ${change.find} → ${change.replace}${change.count > 1 ? ` (×${change.count})` : ""}`);
  }
  if (result.notFound.length > 0) {
    console.log('\nNot found in the document:');
    for (const miss of result.notFound) console.log(`  ✗ ${miss.label ?? miss.find}: “${miss.find}”`);
  }

  console.log('\n--- text of the filled document ---');
  console.log(extractDocxText(result.buffer).text.split('\n').filter(Boolean).slice(0, 20).join('\n'));

  console.log(`\nWritten to ${outDir}`);
  console.log('Open 02-filled-for-new-tenant.docx in Word to see the formatting preserved.');
}

await main();
