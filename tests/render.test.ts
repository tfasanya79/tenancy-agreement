import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { Store } from '../src/db.ts';
import { generateDocuments } from '../src/docs/generate.ts';
import { renderTemplate, TemplateRegistry, assessPack } from '../src/docs/registry.ts';
import { RULES, searchRules } from '../src/knowledge/rules.ts';
import { AGREEMENT_TEMPLATE, DEPOSIT_TEMPLATE, GUARANTOR_TEMPLATE, completeFields, tempDir, writeTemplate } from './helpers.ts';

async function freshRegistry(): Promise<{ registry: TemplateRegistry; templatesDir: string }> {
  const templatesDir = join(tempDir('td-templates-'), 'templates');
  writeTemplate(templatesDir, 'agreement.md', AGREEMENT_TEMPLATE);
  writeTemplate(templatesDir, 'deposit.md', DEPOSIT_TEMPLATE);
  writeTemplate(templatesDir, 'guarantee.md', GUARANTOR_TEMPLATE);
  const registry = await TemplateRegistry.load(templatesDir);
  return { registry, templatesDir };
}

describe('template registry', () => {
  it('loads every template and its front matter', async () => {
    const { registry } = await freshRegistry();
    assert.equal(registry.size, 3);
    const doc = registry.get('test-agreement');
    assert.equal(doc.title, 'Test Tenancy Agreement');
    assert.equal(doc.category, 'tenancy');
    assert.deepEqual(doc.required, ['landlord.full_name', 'property.address_line1', 'tenancy.start_date']);
  });

  it('records the placeholders each document uses', async () => {
    const { registry } = await freshRegistry();
    const doc = registry.get('test-agreement');
    assert.ok(doc.placeholders.includes('landlord.full_name'));
    assert.ok(doc.placeholders.includes('tenants'));
    assert.deepEqual(doc.unknownPlaceholders, []);
  });

  it('names the missing fields for a pack', async () => {
    const { registry } = await freshRegistry();
    const listing = registry.list({});
    const agreement = listing.find((doc) => doc.id === 'test-agreement');
    assert.deepEqual(agreement?.missing.sort(), ['landlord.full_name', 'property.address_line1', 'tenancy.start_date']);
  });

  it('throws a helpful error for an unknown id', async () => {
    const { registry } = await freshRegistry();
    assert.throws(() => registry.get('nope'), /Unknown document "nope".*Available/);
  });

  it('suggests move-in documents and adds the guarantee only when needed', async () => {
    const { registry } = await freshRegistry();
    const withoutGuarantor = registry.suggestSelection(completeFields());
    assert.ok(withoutGuarantor.includes('test-agreement'));
    assert.ok(withoutGuarantor.includes('test-deposit'));
    assert.equal(withoutGuarantor.includes('test-guarantee'), false);

    const withGuarantor = registry.suggestSelection({ ...completeFields(), 'guarantor.full_name': 'Sam Raman' });
    assert.ok(withGuarantor.includes('test-guarantee'));
  });

  it('warns about a placeholder that is not in the catalogue', async () => {
    const templatesDir = join(tempDir('td-warn-'), 'templates');
    writeTemplate(templatesDir, 'bad.md', '---\nid: bad\ntitle: Bad\n---\nHello {{lanlord.full_name}}');
    const registry = await TemplateRegistry.load(templatesDir);
    assert.equal(registry.warnings.length, 1);
    assert.match(registry.warnings[0] ?? '', /unknown placeholders lanlord\.full_name/);
  });

  it('warns about duplicate ids', async () => {
    const templatesDir = join(tempDir('td-dup-'), 'templates');
    writeTemplate(templatesDir, 'a.md', '---\nid: same\ntitle: A\n---\nA');
    writeTemplate(templatesDir, 'b.md', '---\nid: same\ntitle: B\n---\nB');
    const registry = await TemplateRegistry.load(templatesDir);
    assert.equal(registry.size, 1);
    assert.match(registry.warnings.join('\n'), /duplicate id/);
  });
});

describe('rendering', () => {
  it('fills the template with the pack values', async () => {
    const { registry } = await freshRegistry();
    const rendered = renderTemplate(registry.get('test-agreement'), { fields: completeFields() });
    assert.match(rendered.markdown, /Priya Raman/);
    assert.match(rendered.markdown, /Alex Morgan/);
    assert.match(rendered.markdown, /£1,250/);
    assert.match(rendered.markdown, /1 November 2026/);
    assert.deepEqual(rendered.missing, []);
  });

  it('omits an optional block when the field is absent', async () => {
    const { registry } = await freshRegistry();
    const fields = completeFields();
    fields['tenancy.deposit_amount'] = '';
    const rendered = renderTemplate(registry.get('test-agreement'), { fields });
    assert.match(rendered.markdown, /No deposit is held/);
  });

  it('reports fields the document needed but did not get', async () => {
    const { registry } = await freshRegistry();
    const rendered = renderTemplate(registry.get('test-agreement'), { fields: {} });
    assert.ok(rendered.missing.includes('landlord.full_name'));
  });

  it('injects today and a default issue date', async () => {
    const templatesDir = join(tempDir('td-today-'), 'templates');
    writeTemplate(templatesDir, 't.md', '---\nid: t\ntitle: T\n---\nIssued {{today|dateshort}}');
    const registry = await TemplateRegistry.load(templatesDir);
    const rendered = renderTemplate(registry.get('t'), { fields: {}, today: new Date(2026, 9, 19) });
    assert.match(rendered.markdown, /19\/10\/2026/);
  });

  it('assesses readiness from the compliance report', () => {
    const ready = assessPack(completeFields());
    assert.equal(ready.ready, true);
    assert.deepEqual(ready.missingCore, []);

    const notReady = assessPack({});
    assert.equal(notReady.ready, false);
    assert.ok(notReady.missingLabels.length > 0);
  });
});

describe('document generation', () => {
  it('writes docx, html and markdown for each document', async () => {
    const { registry } = await freshRegistry();
    const store = new Store(tempDir('td-data-'));
    const pack = store.createPack(completeFields());

    const generated = await generateDocuments({
      store,
      registry,
      packId: pack.id,
      fields: pack.fields,
    });

    assert.ok(generated.length >= 2);

    for (const document of generated) {
      assert.ok(document.docxPath !== null && document.htmlPath !== null && document.mdPath !== null);

      const docx = readFileSync(join(store.dataDir, document.docxPath));
      assert.equal(docx.subarray(0, 2).toString('latin1'), 'PK', 'docx should be a zip archive');
      assert.ok(docx.byteLength > 2000, 'docx should have real content');

      const html = readFileSync(join(store.dataDir, document.htmlPath), 'utf8');
      assert.match(html, /<!doctype html>/i);
      assert.match(html, new RegExp(document.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      if (document.templateId === 'test-agreement') {
        assert.match(html, /Priya Raman/, 'the agreement must name the landlord');
      }

      const markdown = readFileSync(join(store.dataDir, document.mdPath), 'utf8');
      assert.match(markdown, /Test Tenancy Agreement|Deposit Information/);
    }

    const stored = store.listDocuments(pack.id);
    assert.equal(stored.length, generated.length);
    assert.equal(store.getPack(pack.id).status, 'generated');
    store.close();
  });

  it('replaces an earlier version of the same document', async () => {
    const { registry } = await freshRegistry();
    const store = new Store(tempDir('td-regen-'));
    const pack = store.createPack(completeFields());

    await generateDocuments({ store, registry, packId: pack.id, fields: pack.fields, templateIds: ['test-agreement'] });
    await generateDocuments({ store, registry, packId: pack.id, fields: pack.fields, templateIds: ['test-agreement'] });

    const stored = store.listDocuments(pack.id);
    assert.equal(stored.filter((document) => document.templateId === 'test-agreement').length, 1);
    store.close();
  });
});

describe('store', () => {
  it('issues sequential references for the current year', () => {
    const store = new Store(tempDir('td-ref-'));
    const first = store.createPack({});
    const second = store.createPack({});
    const year = new Date().getFullYear();
    assert.equal(first.reference, `TD-${year}-0001`);
    assert.equal(second.reference, `TD-${year}-0002`);
    store.close();
  });

  it('derives the display name and address from the fields', () => {
    const store = new Store(tempDir('td-name-'));
    const pack = store.createPack(completeFields());
    assert.equal(pack.tenantName, 'Alex Morgan');
    assert.match(pack.propertyAddress, /12 Bridge Street/);
    store.close();
  });

  it('persists notes and the cover message', () => {
    const store = new Store(tempDir('td-notes-'));
    const pack = store.createPack({});
    store.updatePack(pack.id, {
      notes: [{ id: 'n1', text: 'Protect the deposit', createdAt: new Date().toISOString() }],
      coverMessage: { email: 'Hello', createdAt: new Date().toISOString() },
    });
    const reloaded = store.getPack(pack.id);
    assert.equal(reloaded.notes.length, 1);
    assert.equal(reloaded.coverMessage?.email, 'Hello');
    store.close();
  });

  it('removes documents with their pack', () => {
    const store = new Store(tempDir('td-cascade-'));
    const pack = store.createPack({});
    store.addDocuments(pack.id, [
      {
        templateId: 'x',
        title: 'X',
        docxPath: null,
        htmlPath: null,
        mdPath: null,
        checksum: null,
        byteSize: 0,
        generatedAt: new Date().toISOString(),
      },
    ]);
    assert.equal(store.listDocuments(pack.id).length, 1);
    store.deletePack(pack.id);
    assert.equal(store.listDocuments(pack.id).length, 0);
    store.close();
  });

  it('saves an agent run transcript', () => {
    const store = new Store(tempDir('td-runs-'));
    const pack = store.createPack({});
    store.saveRun({
      packId: pack.id,
      kind: 'chat',
      model: 'deepseek-chat',
      promptTokens: 100,
      completionTokens: 50,
      steps: [{ tool: 'get_pack' }],
      summary: 'ok',
    });
    const runs = store.listRuns(pack.id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.promptTokens, 100);
    assert.deepEqual(runs[0]?.steps, [{ tool: 'get_pack' }]);
    store.close();
  });

  it('creates the data file inside the data folder', () => {
    const dir = tempDir('td-file-');
    const store = new Store(dir);
    store.createPack({});
    assert.ok(existsSync(join(dir, 'tenancydesk.db')));
    store.close();
  });
});

describe('rules knowledge base', () => {
  it('has unique ids and a source for every rule', () => {
    const ids = RULES.map((rule) => rule.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const rule of RULES) {
      assert.ok(rule.source.url.startsWith('https://'), `${rule.id} needs a source`);
    }
  });

  it('finds rules by keyword', () => {
    const matches = searchRules('deposit');
    assert.ok(matches.length > 0);
    assert.ok(matches.some((rule) => rule.id === 'deposit-protection'));
  });

  it('returns nothing for a query it does not cover', () => {
    assert.deepEqual(searchRules('zzzz'), []);
  });

  it('states the post-May-2026 position', () => {
    const section21 = RULES.find((rule) => rule.id === 'section-21');
    assert.match(`${section21?.title ?? ''} ${section21?.summary ?? ''}`, /abolished|no longer/i);
    const tenancyType = RULES.find((rule) => rule.id === 'tenancy-type');
    assert.match(tenancyType?.summary ?? '', /assured periodic/i);
  });
});
