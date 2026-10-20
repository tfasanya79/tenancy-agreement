import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { Document, Packer, Paragraph, TextRun } from 'docx';

import { buildReplacements, extractDocxText, fillDocx, formatLike, replaceInDocumentXml, type SlotLink } from '../src/docs/docxFill.ts';
import { createZip, readZip } from '../src/util/zip.ts';

async function sampleDocx(): Promise<Buffer> {
  const document = new Document({
    sections: [
      {
        headers: {
          default: undefined,
        },
        children: [
          new Paragraph({ children: [new TextRun({ text: 'Assured Periodic Tenancy Agreement', bold: true, size: 32 })] }),
          new Paragraph({ children: [new TextRun('The Landlord lets Flat 3, 14 Beech Road, Walthamstow E17 3NU.')] }),
          new Paragraph({
            children: [
              new TextRun('The Rent is '),
              new TextRun({ text: '£980', bold: true }),
              new TextRun(' per calendar month, payable in advance.'),
            ],
          }),
          new Paragraph({ children: [new TextRun('The Tenant is Angela Anyanwu, email a@example.com.')] }),
          new Paragraph({ children: [new TextRun('The tenancy starts on 30 October 2026.')] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(document);
}

describe('zip round trip', () => {
  it('reads back what it wrote', () => {
    const zip = createZip([
      { name: 'a.txt', data: 'hello' },
      { name: 'b/c.bin', data: Buffer.from([1, 2, 3, 250]) },
    ]);
    const entries = readZip(zip);
    assert.equal(entries.get('a.txt')?.toString('utf8'), 'hello');
    assert.deepEqual([...(entries.get('b/c.bin') ?? [])], [1, 2, 3, 250]);
  });

  it('rejects a file that is not a zip', () => {
    assert.throws(() => readZip(Buffer.from('not a zip at all, definitely not')), /not a valid/);
  });

  it('compresses XML instead of storing it, so a document does not grow', () => {
    // A realistic slice of Word XML: highly repetitive, compresses well.
    const xml = `<w:p><w:r><w:t>${'The Landlord lets the Property to the Tenant. '.repeat(400)}</w:t></w:r></w:p>`;
    const archive = createZip([{ name: 'word/document.xml', data: xml }]);

    assert.ok(
      archive.length < Buffer.byteLength(xml) / 2,
      `expected compression: ${archive.length} bytes for ${Buffer.byteLength(xml)}`,
    );
    assert.equal(readZip(archive).get('word/document.xml')?.toString('utf8'), xml);
  });

  it('stores an entry that does not compress well', () => {
    // Random bytes do not deflate; the writer must fall back to storing them.
    const random = Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 37 + 11) % 251));
    const archive = createZip([{ name: 'blob.bin', data: random }]);
    assert.deepEqual([...(readZip(archive).get('blob.bin') ?? [])], [...random]);
  });
});

describe('reading a Word document', () => {
  it('extracts the visible text', async () => {
    const { text, paragraphs } = extractDocxText(await sampleDocx());
    assert.ok(paragraphs.length >= 5);
    assert.match(text, /Assured Periodic Tenancy Agreement/);
    assert.match(text, /£980/);
    assert.match(text, /E17 3NU/);
  });
});

describe('filling a Word document', () => {
  it('replaces values and reports what it did', async () => {
    const result = fillDocx(await sampleDocx(), [
      { find: 'Flat 3', replace: 'Room 2', label: 'Room' },
      { find: '£980', replace: '£1,450', label: 'Monthly payment' },
      { find: 'Angela Anyanwu', replace: 'Alex Morgan', label: 'Tenant' },
      { find: '30 October 2026', replace: '1 November 2026', label: 'Start date' },
    ]);

    assert.equal(result.notFound.length, 0, JSON.stringify(result.notFound));
    assert.equal(result.applied.length, 4);

    const text = extractDocxText(result.buffer).text;
    assert.match(text, /Room 2/);
    assert.match(text, /£1,450/);
    assert.match(text, /Alex Morgan/);
    assert.match(text, /1 November 2026/);
    assert.match(text, /E17 3NU/, 'untouched text survives');
    assert.doesNotMatch(text, /Angela/);
  });

  it('keeps the formatting of the value it replaced', async () => {
    const original = await sampleDocx();
    const result = fillDocx(original, [{ find: '£980', replace: '£1,450' }]);
    const xml = readZip(result.buffer).get('word/document.xml')?.toString('utf8') ?? '';

    // The rent run was bold before; it must still be bold afterwards.
    const around = xml.slice(Math.max(0, xml.indexOf('£1,450') - 400), xml.indexOf('£1,450'));
    assert.match(around, /<w:b\/>/, 'bold should survive the substitution');
  });

  it('still produces a valid document Word can open', async () => {
    const result = fillDocx(await sampleDocx(), [{ find: '£980', replace: '£1,450' }]);
    const entries = readZip(result.buffer);
    assert.ok(entries.has('[Content_Types].xml'), 'docx must keep its manifest');
    assert.ok(entries.has('word/document.xml'));
    assert.match(entries.get('[Content_Types].xml')?.toString('utf8') ?? '', /wordprocessingml/);
  });

  it('reports a value it could not find instead of failing silently', async () => {
    const result = fillDocx(await sampleDocx(), [{ find: '£5,000', replace: '£6,000', label: 'Old rent' }]);
    assert.equal(result.applied.length, 0);
    assert.equal(result.notFound.length, 1);
    assert.equal(result.notFound[0]?.label, 'Old rent');
  });

  it('replaces every occurrence when asked', async () => {
    const result = fillDocx(await sampleDocx(), [{ find: 'The ', replace: 'Our ', all: true }]);
    const text = extractDocxText(result.buffer).text;
    assert.doesNotMatch(text, /\bThe Landlord\b/);
    assert.ok(result.applied[0]!.count >= 3);
  });
});

describe('matching the document’s own formatting', () => {
  it('keeps the pound sign and thousands separators', () => {
    assert.equal(formatLike('£980', 1450), '£1,450');
    assert.equal(formatLike('£ 980', '1450'), '£1,450');
  });

  it('keeps pence when the original showed pence', () => {
    assert.equal(formatLike('£980.00', 1450), '£1,450.00');
  });

  it('writes dates in the style already used', () => {
    assert.equal(formatLike('30 October 2026', '2026-11-01'), '1 November 2026');
    assert.equal(formatLike('30th October 2026', '2026-11-01'), '1st November 2026');
    assert.equal(formatLike('30/10/2026', '2026-11-01'), '01/11/2026');
  });

  it('leaves ordinary text alone', () => {
    assert.equal(formatLike('Room 1', 'Room 2'), 'Room 2');
    assert.equal(formatLike('Angela Anyanwu', 'Alex Morgan'), 'Alex Morgan');
  });

  it('returns nothing for an empty value', () => {
    assert.equal(formatLike('£980', ''), '');
    assert.equal(formatLike('£980', undefined), '');
  });
});

describe('building replacements from a pack', () => {
  const links: SlotLink[] = [
    { field: 'tenants[0].full_name', sample: 'Angela Anyanwu', label: 'Tenant name' },
    { field: 'tenants[0].email', sample: 'angela@example.com', label: 'Tenant email' },
    { field: 'property.room_number', sample: 'Room 1', label: 'Room' },
    { field: 'tenancy.rent_amount', sample: '£980', label: 'Monthly payment' },
    { field: 'tenancy.start_date', sample: '30 October 2026', label: 'Start date' },
    { field: 'tenancy.payment_date', sample: '29 October 2026', label: 'Payment date' },
    { field: 'inventory.scheduled_date', sample: '30 October 2026', label: 'Inventory date', near: 'inventory was agreed' },
  ];

  const fields = {
    tenants: [{ full_name: 'Alex Morgan', email: 'alex.morgan@example.com' }],
    'property.room_number': 'Room 2',
    'tenancy.rent_amount': 1450,
    'tenancy.start_date': '2026-11-01',
    'tenancy.payment_date': '2026-10-31',
    'inventory.scheduled_date': '2026-10-31',
  };

  it('resolves the eight values a letting agent actually changes', () => {
    const replacements = buildReplacements(fields, links);
    const byLabel = new Map(replacements.map((r) => [r.label, r]));
    assert.equal(byLabel.get('Tenant name')?.replace, 'Alex Morgan');
    assert.equal(byLabel.get('Tenant email')?.replace, 'alex.morgan@example.com');
    assert.equal(byLabel.get('Room')?.replace, 'Room 2');
    assert.equal(byLabel.get('Monthly payment')?.replace, '£1,450');
    assert.equal(byLabel.get('Start date')?.replace, '1 November 2026');
    assert.equal(byLabel.get('Payment date')?.replace, '31 October 2026');
    assert.equal(byLabel.get('Inventory date')?.replace, '31 October 2026');
  });

  it('puts a targeted link first so it is not swallowed by a wider one', () => {
    const replacements = buildReplacements(fields, links);
    assert.equal(replacements[0]?.label, 'Inventory date');
    assert.equal(replacements[0]?.near, 'inventory was agreed');
  });

  it('skips a field with no value', () => {
    const partial = { ...fields, 'property.room_number': '' };
    const labels = buildReplacements(partial, links).map((r) => r.label);
    assert.equal(labels.includes('Room'), false);
  });

  it('skips a value that would not change anything', () => {
    const same = { ...fields, 'property.room_number': 'Room 1' };
    const labels = buildReplacements(same, links).map((r) => r.label);
    assert.equal(labels.includes('Room'), false);
  });
});

describe('two details holding the same old value', () => {
  it('only fills the paragraph the link points at', () => {
    const xml =
      '<w:p><w:r><w:t>The tenancy starts on 30 October 2026.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>The inventory was agreed on 30 October 2026.</w:t></w:r></w:p>';

    const counts = new Map<string, number>();
    const out = replaceInDocumentXml(
      xml,
      [{ find: '30 October 2026', replace: '31 October 2026', near: 'inventory was agreed', label: 'inventory' }],
      counts,
    );

    assert.match(out, /starts on 30 October 2026/, 'the start date must be left alone');
    assert.match(out, /agreed on 31 October 2026/, 'the inventory date must change');
    assert.equal(counts.get('inventory'), 1);
  });
});

describe('values split across Word runs', () => {
  it('finds a value that Word has broken into two runs', () => {
    const xml = '<w:p><w:r><w:t>Rent is £9</w:t></w:r><w:r><w:t>80 per month</w:t></w:r></w:p>';
    const out = replaceInDocumentXml(xml, [{ find: '£980', replace: '£1,450' }]);
    assert.match(out, /£1,450/, 'the value should be substituted despite the split');
    assert.doesNotMatch(out, /£980/);
    assert.match(out, /per month/, 'the rest of the sentence survives');
  });

  it('keeps the surrounding text when the match starts mid-run', () => {
    const xml = '<w:p><w:r><w:t>Flat 3, 14 Beech Road</w:t></w:r></w:p>';
    const out = replaceInDocumentXml(xml, [{ find: 'Flat 3', replace: 'Room 12' }]);
    assert.match(out, /Room 12, 14 Beech Road/);
  });

  it('preserves spaces by marking the run as space-preserving', () => {
    const xml = '<w:p><w:r><w:t>Paid on the 1st.</w:t></w:r></w:p>';
    const out = replaceInDocumentXml(xml, [{ find: '1st', replace: ' 29th ' }]);
    assert.match(out, /xml:space="preserve"/);
    assert.match(out, / 29th /);
  });

  it('ignores a paragraph that does not contain the value', () => {
    const xml = '<w:p><w:r><w:t>Nothing to change here.</w:t></w:r></w:p>';
    assert.equal(replaceInDocumentXml(xml, [{ find: '£980', replace: '£1,450' }]), xml);
  });

  it('counts each substitution', () => {
    const counts = new Map<string, number>();
    const xml = '<w:p><w:r><w:t>£980 and £980</w:t></w:r></w:p>';
    replaceInDocumentXml(xml, [{ find: '£980', replace: '£1,450', all: true }], counts);
    assert.equal(counts.get('£980'), 2);
  });
});
