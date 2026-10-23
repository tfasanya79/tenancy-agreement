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

describe('feedback is kept until it is marked done, and then removed', () => {
  const file = async (title: string, summary: string, kind = 'improvement') => {
    const response = await as(cookie, {
      method: 'POST',
      url: '/api/feedback',
      payload: { title, summary, kind, area: 'documents' },
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().feedback.id as string;
  };

  it('stays in the list while it is open, whatever its state', async () => {
    resetFeedbackLimits();
    const id = await file('Keep this until it is done', 'An open record must stay visible.');

    for (const status of ['triaged', 'planned']) {
      const changed = await as(operatorCookie, {
        method: 'PATCH',
        url: `/api/feedback/${id}`,
        payload: { status },
      });
      assert.equal(changed.statusCode, 200, changed.body);
      const queue = await as(operatorCookie, { method: 'GET', url: '/api/feedback/queue' });
      assert.ok(
        queue.json().items.some((entry: { id: string }) => entry.id === id),
        `${status} should still be in the list`,
      );
    }
  });

  it('is deleted the moment it is marked done — words, conversation and all', async () => {
    resetFeedbackLimits();
    const id = await file('Delete me when done', 'This one is handled straight away.');

    const done = await as(operatorCookie, {
      method: 'PATCH',
      url: `/api/feedback/${id}`,
      payload: { status: 'done' },
    });
    assert.equal(done.statusCode, 200);
    assert.equal(done.json().removed, true);
    assert.match(done.json().message, /removed from the list/i);

    const queue = await as(operatorCookie, { method: 'GET', url: '/api/feedback/queue' });
    assert.equal(
      queue.json().items.some((entry: { id: string }) => entry.id === id),
      false,
      'a handled record must be gone from the queue',
    );

    const mine = await as(cookie, { method: 'GET', url: '/api/feedback/mine' });
    assert.equal(
      mine.json().items.some((entry: { id: string }) => entry.id === id),
      false,
      'and gone from the list of the person who sent it',
    );

    // Nothing to change any more: the id no longer exists.
    const again = await as(operatorCookie, {
      method: 'PATCH',
      url: `/api/feedback/${id}`,
      payload: { status: 'triaged' },
    });
    assert.equal(again.statusCode, 404);
  });

  it('remembers that the same thing was asked before, without keeping anybody’s words', async () => {
    resetFeedbackLimits();
    const first = await file('Filter the document list by type', 'Add a filter to the generated document list.', 'new_feature');
    await as(operatorCookie, { method: 'PATCH', url: `/api/feedback/${first}`, payload: { status: 'done' } });

    const second = await file('Filter the document list by type', 'Add a filter to the generated document list.', 'new_feature');
    const queue = await as(operatorCookie, { method: 'GET', url: '/api/feedback/queue' });
    const item = queue.json().items.find((entry: { id: string }) => entry.id === second);
    assert.ok(item, 'the new ask is in the list');
    assert.equal(item.previousAsks >= 1, true, 'it should know this was handled before');

    // The tally carries no person and no conversation.
    const tally = store.handle.prepare('SELECT kind, title, count FROM feedback_done').all() as unknown as Array<{
      kind: string;
      title: string;
      count: number;
    }>;
    assert.equal(tally.length >= 1, true);
    for (const row of tally) {
      assert.equal(row.title.includes('Alex Morgan'), false);
      assert.equal(row.kind.length > 0, true);
    }
    const leaked = store.handle
      .prepare('SELECT COUNT(*) AS count FROM feedback_done WHERE title LIKE ?')
      .get('%owner@%') as { count: number };
    assert.equal(leaked.count, 0, 'the tally must not hold an email address');
  });

  it('does not count a record twice if it is closed out again by mistake', async () => {
    resetFeedbackLimits();
    const id = await file('Say it twice', 'A record that is closed out once.');
    await as(operatorCookie, { method: 'PATCH', url: `/api/feedback/${id}`, payload: { status: 'done' } });
    const second = await as(operatorCookie, { method: 'PATCH', url: `/api/feedback/${id}`, payload: { status: 'done' } });
    assert.equal(second.statusCode, 404, 'the second attempt finds nothing to delete');
  });

  it('keeps a declined record, so the reason is not lost', async () => {
    const id = await file('Something we said no to', 'Recorded, and refused, but still recorded.');
    await as(operatorCookie, { method: 'PATCH', url: `/api/feedback/${id}`, payload: { status: 'declined' } });
    const queue = await as(operatorCookie, { method: 'GET', url: '/api/feedback/queue' });
    assert.ok(queue.json().items.some((entry: { id: string }) => entry.id === id));
    // And it can still be finished off later.
    const done = await as(operatorCookie, { method: 'PATCH', url: `/api/feedback/${id}`, payload: { status: 'done' } });
    assert.equal(done.json().removed, true);
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

  it('has no delete route: removal is only ever "done", by the operator', async () => {
    const id = await file('Nothing deletes me directly', 'There is no delete endpoint, by design.');
    const attempt = await as(operatorCookie, { method: 'DELETE', url: `/api/feedback/${id}` });
    assert.equal(attempt.statusCode, 404);
    const queue = await as(operatorCookie, { method: 'GET', url: '/api/feedback/queue' });
    assert.ok(queue.json().items.some((entry: { id: string }) => entry.id === id));
  });

  it('survives the app being closed and opened again, while it is open', async () => {
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
      summary: 'An open record should outlive the process.',
      area: 'other',
      messages: [{ role: 'tester', text: 'Kept across a restart' }],
    });
    first.close();

    const second = new Store(dir);
    try {
      const reopened = new FeedbackStore(second.handle);
      const item = reopened.get(created.id);
      assert.ok(item, 'the record should still be there');
      assert.equal(item.messages.length, 1, 'and so should the conversation');

      // Then, and only then, done removes it.
      assert.equal(reopened.complete(created.id).removed, true);
      assert.equal(reopened.get(created.id), null);
    } finally {
      second.close();
    }
  });

  it('shows counts to the operator and nothing to anybody else', async () => {
    const forOperator = await as(operatorCookie, { method: 'GET', url: '/api/feedback/summary' });
    assert.equal(forOperator.statusCode, 200);
    assert.equal(typeof forOperator.json().counts, 'object');

    const forOwner = await as(cookie, { method: 'GET', url: '/api/feedback/summary' });
    assert.deepEqual(forOwner.json().counts, {}, 'an agency owner gets no counts');
  });
});
describe('identity cannot disagree with itself', () => {
  it('never lets a browser keep an API response', async () => {
    for (const url of ['/api/auth/status', '/api/overview', '/api/packs']) {
      const response = await app.inject({ method: 'GET', url, headers: { cookie } });
      assert.equal(String(response.headers['cache-control'] ?? '').includes('no-store'), true, url);
    }
    // The interface itself is served with a revalidate, not no-store.
    const staticFile = await app.inject({ method: 'GET', url: '/app.js' });
    assert.equal(String(staticFile.headers['cache-control'] ?? '').includes('no-store'), false);
  });

  it('fills a gap in the operator flag rather than leaving the queue unread', async () => {
    const dir = tempDir('td-feat-bootstrap-');
    const ownStore = new Store(dir);
    try {
      const auth = new AuthStore(ownStore.handle, []);
      await auth.createUser({ email: 'first@example.test', name: 'First', role: 'agent', password: 'a long enough phrase' });
      // The first owner made takes the flag; the second is the tie-breaker case, created
      // in the same millisecond, so the ordering has to be stable rather than lucky.
      const firstOwner = await auth.createUser({
        email: 'first-owner@example.test',
        name: 'First Owner',
        role: 'owner',
        password: 'a long enough phrase',
      });
      const secondOwner = await auth.createUser({
        email: 'second-owner@example.test',
        name: 'Second Owner',
        role: 'owner',
        password: 'a long enough phrase',
      });
      assert.equal(auth.operatorEmails().length, 0);

      const promoted = auth.ensureOperator();
      assert.notEqual(promoted, null, 'somebody must be able to read the queue');
      assert.equal(promoted, firstOwner.email, 'the oldest working owner takes it');
      assert.equal(auth.getUser(secondOwner.id)?.isOperator, false);

      // It does nothing when somebody already has it.
      assert.equal(auth.ensureOperator(), null);
    } finally {
      ownStore.close();
    }
  });
});

describe('the overview', () => {
  it('answers with the state of things, for staff', async () => {
    const response = await as(cookie, { method: 'GET', url: '/api/overview' });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    for (const key of ['tenancies', 'records', 'people', 'deadlines', 'care', 'activity']) {
      assert.ok(key in body, `the overview should report ${key}`);
    }
    assert.equal(typeof body.tenancies.total, 'number');
    assert.equal(Array.isArray(body.activity), true);
    assert.equal(body.you.email, OWNER.email);
  });

  it('tells the operator who else reads the queue, and hides the feedback block from others', async () => {
    const operator = await as(operatorCookie, { method: 'GET', url: '/api/overview' });
    assert.ok(operator.json().feedback !== null, 'the operator sees the queue count');
    assert.equal(Array.isArray(operator.json().people.operators), true);

    const owner = await as(cookie, { method: 'GET', url: '/api/overview' });
    assert.equal(owner.json().feedback, null, 'the feedback block is the operator’s alone');
  });

  it('is scoped for a landlord', async () => {
    const landlord = await as(cookie, {
      method: 'POST',
      url: '/api/backoffice/landlords',
      payload: { name: 'Scoped Landlord', address: '1 Scope Street', email: 'scope@landlord.test', phone: '07700 900555' },
    });
    const landlordId = landlord.json().id;
    await as(cookie, {
      method: 'POST',
      url: '/api/users',
      payload: {
        name: 'Scoped Landlord',
        email: 'scoped@landlord.test',
        role: 'landlord',
        password: 'a long enough phrase',
        landlordId,
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'scoped@landlord.test', password: 'a long enough phrase' },
    });
    const scopedCookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';

    const response = await as(scopedCookie, { method: 'GET', url: '/api/overview' });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.tenancies.total, 0, 'a landlord sees only their own tenancies');
    assert.equal(body.records.landlords, 1, 'and only their own landlord record');
    assert.equal(body.feedback, null);
    assert.equal(body.people.total >= 1, true, 'the account count is not a secret');
  });
});

describe('the guidance the assistant offers', () => {
  it('offers the next thing, ranked by the pack, without a model', async () => {
    const created = await as(cookie, {
      method: 'POST',
      url: '/api/packs',
      payload: { fields: { tenants: [{ full_name: 'Guide Test' }], 'property.address_line1': '1 Guide Street' } },
    });
    const packId = created.json().pack.id;

    const response = await as(cookie, { method: 'GET', url: `/api/packs/${packId}/guidance` });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(Array.isArray(body.options), true);
    assert.equal(body.landlord, false);
    assert.equal(body.options.length >= 1, true);

    // A pack with a tenant and nothing else is a pack to finish, not to start.
    const top = body.options[0];
    assert.equal(top.id, 'ready-to-send');
    assert.equal(top.steps[top.at].id, 'essentials');
    assert.equal(typeof top.why, 'string');
    assert.ok(body.facts.missing.length >= 1, 'the missing essentials are named');

    const empty = await as(cookie, { method: 'POST', url: '/api/packs', payload: { fields: {} } });
    const fresh = await as(cookie, { method: 'GET', url: `/api/packs/${empty.json().pack.id}/guidance` });
    assert.equal(fresh.json().options[0].id, 'start-from-email');
  });

  it('gives a landlord the read-only set, and refuses another landlord’s pack', async () => {
    const landlord = await as(cookie, {
      method: 'POST',
      url: '/api/backoffice/landlords',
      payload: { name: 'Guide Landlord', address: '2 Guide Street', email: 'guide@landlord.test', phone: '07700 900777' },
    });
    const landlordId = landlord.json().id;
    const pack = await as(cookie, {
      method: 'POST',
      url: '/api/packs',
      payload: { fields: { tenants: [{ full_name: 'Scoped Tenant' }] } },
    });
    await as(cookie, { method: 'PATCH', url: `/api/packs/${pack.json().pack.id}`, payload: { landlordId } });
    await as(cookie, {
      method: 'POST',
      url: '/api/users',
      payload: {
        name: 'Guide Landlord',
        email: 'guidance@landlord.test',
        role: 'landlord',
        password: 'a long enough phrase',
        landlordId,
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'guidance@landlord.test', password: 'a long enough phrase' },
    });
    const scopedCookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';

    const mine = await as(scopedCookie, { method: 'GET', url: `/api/packs/${pack.json().pack.id}/guidance` });
    assert.equal(mine.statusCode, 200, mine.body);
    assert.equal(mine.json().landlord, true);
    assert.equal(mine.json().options[0].id, 'read-the-pack');

    const other = await as(cookie, { method: 'POST', url: '/api/packs', payload: { fields: {} } });
    const refused = await as(scopedCookie, { method: 'GET', url: `/api/packs/${other.json().pack.id}/guidance` });
    assert.equal(refused.statusCode, 404, 'a pack that is not theirs does not exist');
  });
});
describe('granting the flag, and removing an account', () => {
  it('lets the operator share the flag, and it sticks', async () => {
    const granted = await as(operatorCookie, {
      method: 'POST',
      url: `/api/users/${(await as(cookie, { method: 'GET', url: '/api/auth/me' })).json().id}/operator`,
      payload: { isOperator: true },
    });
    assert.equal(granted.statusCode, 200, granted.body);
    assert.equal(granted.json().user.isOperator, true);

    // The new operator can read the queue.
    const queue = await as(cookie, { method: 'GET', url: '/api/feedback/queue' });
    assert.equal(queue.statusCode, 200);

    // Put it back, so the rest of the file tests what it says it tests.
    await as(operatorCookie, {
      method: 'POST',
      url: `/api/users/${(await as(cookie, { method: 'GET', url: '/api/auth/me' })).json().id}/operator`,
      payload: { isOperator: false },
    });
    assert.equal((await as(cookie, { method: 'GET', url: '/api/feedback/queue' })).statusCode, 403);
  });

  it('refuses a non-operator trying to grant it to themselves', async () => {
    const me = await as(cookie, { method: 'GET', url: '/api/auth/me' });
    const attempt = await as(cookie, {
      method: 'POST',
      url: `/api/users/${me.json().id}/operator`,
      payload: { isOperator: true },
    });
    assert.equal(attempt.statusCode, 403);
  });

  it('will not leave the queue with nobody reading it', async () => {
    const me = await as(operatorCookie, { method: 'GET', url: '/api/auth/me' });
    const attempt = await as(operatorCookie, {
      method: 'POST',
      url: `/api/users/${me.json().id}/operator`,
      payload: { isOperator: false },
    });
    assert.equal(attempt.statusCode, 400);
    assert.match(attempt.json().error, /has to read the feedback queue|another account/i);
  });

  it('deletes an account, but never your own or the last owner', async () => {
    const me = await as(cookie, { method: 'GET', url: '/api/auth/me' });
    const self = await as(cookie, { method: 'DELETE', url: `/api/users/${me.json().id}` });
    assert.equal(self.statusCode, 400);

    const created = await as(cookie, {
      method: 'POST',
      url: '/api/users',
      payload: { name: 'Temp Person', email: 'temp@example.test', role: 'agent', password: 'a long enough phrase' },
    });
    assert.equal(created.statusCode, 201);
    const id = created.json().user.id;
    const removed = await as(cookie, { method: 'DELETE', url: `/api/users/${id}` });
    assert.equal(removed.statusCode, 200, removed.body);

    const list = await as(cookie, { method: 'GET', url: '/api/users' });
    assert.equal(
      list.json().users.some((user: { id: string }) => user.id === id),
      false,
    );
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
