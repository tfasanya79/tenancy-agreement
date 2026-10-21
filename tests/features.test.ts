/**
 * The features that had no route-level test: the agency's own documents, the calendar,
 * the printed history — and the promises the feedback queue makes about retention.
 *
 * These are deliberately end-to-end through the API, because every one of them was
 * reachable from the interface while nothing proved the wiring was right.
 */

import { strict as assert } from 'node:assert';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { Document, Packer, Paragraph, TextRun } from 'docx';

import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { TemplateRegistry } from '../src/docs/registry.ts';
import { AuthStore } from '../src/auth/store.ts';
import { readZip } from '../src/util/zip.ts';
import { resetFeedbackLimits } from '../src/feedback/routes.ts';
import { AGREEMENT_TEMPLATE, completeFields, tempDir, writeTemplate } from './helpers.ts';

let app: FastifyInstance;
let store: Store;
let cookie = '';
let operatorCookie = '';

const OWNER = { name: 'Mary Ajala', email: 'owner@features.test', password: 'the long owner phrase' };
const OPERATOR = { name: 'Tim Operator', email: 'ops@features.test', password: 'the long operator phrase' };

/** An agency's own agreement, as they would upload it. */
async function agencyDocx(): Promise<Buffer> {
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun({ text: 'Haven Bricks Properties', bold: true, size: 32 })] }),
          new Paragraph({ children: [new TextRun('Our own tenancy agreement')] }),
          new Paragraph({ children: [new TextRun('The rent is £980 per month.')] }),
          new Paragraph({ children: [new TextRun('The tenant is Angela Anyanwu.')] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(document);
}

const as = (asCookie: string, options: { method: string; url: string; payload?: unknown }) =>
  app.inject({ ...options, headers: { cookie: asCookie } } as never);

const textOf = (buffer: Buffer): string =>
  (readZip(buffer).get('word/document.xml') ?? Buffer.from('')).toString('utf8');

before(async () => {
  const templatesDir = join(tempDir('td-feat-tpl-'), 'templates');
  writeTemplate(templatesDir, 'agreement.md', AGREEMENT_TEMPLATE);
  const config = loadConfig({
    dataDir: tempDir('td-feat-data-'),
    templatesDir,
    publicDir: resolve('public'),
    deepseekApiKey: '',
    offlineMode: false,
    operatorEmails: [OPERATOR.email],
  });
  store = new Store(config.dataDir);
  app = await buildApp({ config, store, registry: await TemplateRegistry.load(config.templatesDir) });
  await app.ready();

  const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: OWNER });
  assert.equal(setup.statusCode, 201);
  cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';

  const operator = await as(cookie, {
    method: 'POST',
    url: '/api/users',
    payload: { ...OPERATOR, role: 'owner' },
  });
  assert.equal(operator.statusCode, 201, operator.body);
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: OPERATOR.email, password: OPERATOR.password },
  });
  operatorCookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
});

after(async () => {
  await app.close();
  store.close();
  resetFeedbackLimits();
});

describe('the agency’s own document', () => {
  let templateId = '';
  let packId = '';

  it('accepts an upload and proposes what each value is', async () => {
    const bytes = await agencyDocx();
    const response = await as(cookie, {
      method: 'POST',
      url: '/api/custom-templates',
      payload: {
        name: 'Our tenancy agreement',
        fileName: 'our-agreement.docx',
        data: bytes.toString('base64'),
      },
    });
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    templateId = body.template.id;
    assert.equal(body.template.name, 'Our tenancy agreement');
    assert.ok(body.proposal, 'an upload should come back with a proposed mapping');
    assert.equal(Array.isArray(body.proposal.links), true);
  });

  it('appears in the list of the agency’s documents', async () => {
    const response = await as(cookie, { method: 'GET', url: '/api/custom-templates' });
    assert.equal(response.statusCode, 200);
    const found = response.json().templates.find((item: { id: string }) => item.id === templateId);
    assert.ok(found, 'the upload should be listed');
    assert.equal(typeof found.fillMode, 'string');
  });

  it('refuses a file that is not a Word document', async () => {
    const response = await as(cookie, {
      method: 'POST',
      url: '/api/custom-templates',
      payload: { name: 'Not a docx', fileName: 'x.docx', data: Buffer.from('plain text').toString('base64') },
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /not a Word file/i);
  });

  it('fills it for one tenant, with the details mapped by hand', async () => {
    const pack = await as(cookie, { method: 'POST', url: '/api/packs', payload: { fields: completeFields() } });
    packId = pack.json().pack.id;

    // Map the two values by hand, exactly as the interface does.
    const mapping = await as(cookie, {
      method: 'PATCH',
      url: `/api/custom-templates/${templateId}`,
      payload: {
        fillMode: 'values',
        links: [
          { sample: '£980', field: 'tenancy.rent_amount' },
          // The picker offers a person's details by index, because they live in an array.
          { sample: 'Angela Anyanwu', field: 'tenants[0].full_name' },
        ],
      },
    });
    assert.equal(mapping.statusCode, 200, mapping.body);

    const filled = await as(cookie, { method: 'POST', url: `/api/packs/${packId}/fill/${templateId}`, payload: {} });
    assert.equal(filled.statusCode, 200, filled.body);
    const report = filled.json().report;
    assert.equal(report.filled >= 1, true, `expected at least one value filled: ${JSON.stringify(report)}`);

    // The tenant's own values are in the produced file, and the layout is theirs.
    const produced = filled.json().pack.documents.find((item: { templateId: string }) => item.templateId === `custom:${templateId}`);
    assert.ok(produced, 'the filled document should be recorded on the pack');
    const download = await as(cookie, { method: 'GET', url: `/api/documents/${produced.id}/download?format=docx` });
    assert.equal(download.statusCode, 200);
    const xml = textOf(Buffer.from(download.rawPayload));
    assert.match(xml, /Haven Bricks Properties/, 'the agency letterhead survives');
    assert.match(xml, /1,250|1250/, 'the rent from the pack is in the document');
    assert.match(xml, /Alex Morgan/, 'the tenant from the pack is in the document');
    assert.equal(xml.includes('Angela Anyanwu'), false, 'the sample name must have been replaced');
  });

  it('deletes an upload when asked', async () => {
    const response = await as(cookie, { method: 'DELETE', url: `/api/custom-templates/${templateId}` });
    assert.equal(response.statusCode, 204);
    const list = await as(cookie, { method: 'GET', url: '/api/custom-templates' });
    assert.equal(list.json().templates.length, 0);
  });
});

describe('the deadlines, as a calendar', () => {
  it('serves every tenancy as an iCalendar file', async () => {
    const response = await as(cookie, { method: 'GET', url: '/api/calendar.ics' });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type']), /text\/calendar/);
    assert.match(response.body, /BEGIN:VCALENDAR/);
    assert.match(response.body, /END:VCALENDAR/);
  });

  it('serves one tenancy’s deadlines on its own', async () => {
    const packs = await as(cookie, { method: 'GET', url: '/api/packs' });
    const pack = packs.json().packs[0];
    const response = await as(cookie, { method: 'GET', url: `/api/packs/${pack.id}/calendar.ics` });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /BEGIN:VCALENDAR/);
    assert.match(String(response.headers['content-disposition']), /\.ics/);
  });

  it('answers 404 for a tenancy that does not exist', async () => {
    const response = await as(cookie, { method: 'GET', url: '/api/packs/not-a-real-id/calendar.ics' });
    assert.equal(response.statusCode, 404);
  });
});

describe('the printed history', () => {
  it('is a page somebody can print, with the facts that settle a dispute', async () => {
    const packs = await as(cookie, { method: 'GET', url: '/api/packs' });
    const pack = packs.json().packs[0];
    const response = await as(cookie, { method: 'GET', url: `/api/packs/${pack.id}/timeline.html` });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /<html/i);
    assert.match(response.body, /Alex Morgan/, 'the tenant is named');
    assert.match(response.body, /TD-\d{4}-\d{4}/, 'the reference is on the page');
  });

  it('escapes anything hostile in a name', async () => {
    const hostile = await as(cookie, {
      method: 'POST',
      url: '/api/packs',
      payload: { fields: { tenants: [{ full_name: '<script>alert(1)</script>' }] } },
    });
    const id = hostile.json().pack.id;
    const response = await as(cookie, { method: 'GET', url: `/api/packs/${id}/timeline.html` });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.includes('<script>alert(1)</script>'), false, 'a name must not become markup');
    assert.match(response.body, /&lt;script&gt;|\&lt;script\&gt;/);
  });
});

describe('feedback is kept until somebody resolves it', () => {
  const file = async (title: string, summary: string) => {
    const response = await as(cookie, {
      method: 'POST',
      url: '/api/feedback',
      payload: { title, summary, kind: 'improvement', area: 'documents' },
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().feedback.id as string;
  };

  it('stays in the queue after being marked done, and afterwards', async () => {
    resetFeedbackLimits();
    const id = await file('Keep things until resolved', 'This record must not disappear when it is closed.');

    const done = await as(operatorCookie, {
      method: 'PATCH',
      url: `/api/feedback/${id}`,
      payload: { status: 'done', publicNote: 'Sorted.' },
    });
    assert.equal(done.statusCode, 200);

    const queue = await as(operatorCookie, { method: 'GET', url: '/api/feedback/queue' });
    const item = queue.json().items.find((entry: { id: string }) => entry.id === id);
    assert.ok(item, 'a resolved record is still in the list');
    assert.equal(item.status, 'done');

    const mine = await as(cookie, { method: 'GET', url: '/api/feedback/mine' });
    const mineItem = mine.json().items.find((entry: { id: string }) => entry.id === id);
    assert.ok(mineItem, 'the person who sent it still sees it, with its outcome');
    assert.equal(mineItem.statusWords, 'Done');
  });

  it('cannot be deleted through the API — nothing removes a record', async () => {
    const id = await file('Nothing deletes me', 'There is no delete route, by design.');
    for (const method of ['DELETE', 'POST'] as const) {
      const response = await as(cookie, {
        method,
        url: method === 'DELETE' ? `/api/feedback/${id}` : `/api/feedback/${id}`,
        payload: {},
      });
      assert.equal(response.statusCode >= 400, true, `${method} should not succeed`);
    }
    const queue = await as(operatorCookie, { method: 'GET', url: '/api/feedback/queue' });
    assert.ok(queue.json().items.some((entry: { id: string }) => entry.id === id));
  });

  it('survives the app being closed and opened again', async () => {
    const dir = tempDir('td-feat-persist-');
    const first = new Store(dir);
    const auth = new AuthStore(first.handle, []);
    const user = await auth.createUser({
      email: 'keeper@example.test',
      name: 'Keeper',
      role: 'owner',
      password: 'a long enough phrase',
    });
    const { FeedbackStore } = await import('../src/feedback/store.ts');
    const feedback = new FeedbackStore(first.handle);
    const created = feedback.add({
      userId: user.id,
      userName: user.name,
      role: 'owner',
      kind: 'improvement',
      title: 'Kept across a restart',
      summary: 'The record should outlive the process.',
      area: 'other',
      messages: [{ role: 'tester', text: 'Kept across a restart' }],
    });
    first.close();

    const second = new Store(dir);
    try {
      const reopened = new FeedbackStore(second.handle).get(created.id);
      assert.ok(reopened, 'the record should still be there');
      assert.equal(reopened.title, 'Kept across a restart');
      assert.equal(reopened.messages.length, 1, 'and so should the conversation');
    } finally {
      second.close();
    }
  });

  it('keeps a declined record too, so the reason is not lost', async () => {
    const id = await file('Something we said no to', 'Recorded, and refused, but still recorded.');
    await as(operatorCookie, { method: 'PATCH', url: `/api/feedback/${id}`, payload: { status: 'declined' } });
    const queue = await as(operatorCookie, { method: 'GET', url: '/api/feedback/queue' });
    assert.ok(queue.json().items.some((entry: { id: string }) => entry.id === id));
  });

  it('does not cluster a new ask into a declined one', async () => {
    resetFeedbackLimits();
    const first = await file('Add a filter to the list', 'I want to filter the list of documents.');
    await as(operatorCookie, { method: 'PATCH', url: `/api/feedback/${first}`, payload: { status: 'declined' } });
    const second = await file('Add a filter to the list', 'I want to filter the list of documents.');

    const queue = await as(operatorCookie, { method: 'GET', url: '/api/feedback/queue' });
    const mine = queue.json().items.find((entry: { id: string }) => entry.id === second);
    assert.equal(mine.clusterCount, 1, 'a refused ask should not gather support for a new one');
  });

  it('shows counts to the operator and nothing to anybody else', async () => {
    const forOperator = await as(operatorCookie, { method: 'GET', url: '/api/feedback/summary' });
    assert.equal(forOperator.statusCode, 200);
    assert.equal(typeof forOperator.json().counts, 'object');

    const forOwner = await as(cookie, { method: 'GET', url: '/api/feedback/summary' });
    assert.deepEqual(forOwner.json().counts, {}, 'an agency owner gets no counts');
  });
});

describe('the operator flag can be taken away', () => {
  it('is applied from the environment, and removed when it stops being listed', async () => {
    const dir = tempDir('td-feat-op-');
    const ownStore = new Store(dir);
    try {
      const auth = new AuthStore(ownStore.handle, ['ops@list.test']);
      const kept = await auth.createUser({
        email: 'ops@list.test',
        name: 'Ops',
        role: 'owner',
        password: 'a long enough phrase',
      });
      const other = await auth.createUser({
        email: 'agent@list.test',
        name: 'Agent',
        role: 'agent',
        password: 'a long enough phrase',
      });

      assert.equal(kept.isOperator, true, 'an operator is flagged as the account is made');
      assert.equal(other.isOperator, false);

      // A restart with the name removed takes the flag away again.
      auth.syncOperators([]);
      assert.equal(auth.getUser(kept.id)?.isOperator, false);
    } finally {
      ownStore.close();
    }
  });
});
