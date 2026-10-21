/**
 * Feedback: who may file it, who may read it, and what the assistant is allowed to do.
 *
 * The assertions worth having are the refusals. An agency owner must not see their
 * landlord's words, a landlord must be able to complain about the software even though
 * their access is read-only, and a vague report must produce a question rather than a
 * record.
 */

import { strict as assert } from 'node:assert';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { TemplateRegistry } from '../src/docs/registry.ts';
import { DeepSeekClient } from '../src/agent/deepseek.ts';
import { resetFeedbackLimits } from '../src/feedback/routes.ts';
import { resetLoginAttempts } from '../src/auth/routes.ts';
import { reviewFlags, similarity } from '../src/feedback/store.ts';
import { AGREEMENT_TEMPLATE, tempDir, writeTemplate } from './helpers.ts';

let app: FastifyInstance;
let store: Store;

const OWNER = { name: 'Mary Ajala', email: 'owner@havenbricks.test', password: 'the long owner phrase' };
const OPERATOR = { name: 'Tim Operator', email: 'ops@tenancydesk.test', password: 'the long operator phrase' };
const AGENT = { name: 'Ade Bello', email: 'ade@havenbricks.test', password: 'the long agent phrase' };
const LANDLORD = { name: 'Landlord A', email: 'a@landlord.test', password: 'the long landlord phrase' };

let ownerCookie = '';
let operatorCookie = '';
let agentCookie = '';
let landlordCookie = '';
let landlordId = '';

const signIn = async (email: string, password: string): Promise<string> => {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  assert.equal(response.statusCode, 200, `sign in failed for ${email}: ${response.body}`);
  return String(response.headers['set-cookie'] ?? '').split(';')[0] ?? '';
};

const as = (cookie: string, options: { method: string; url: string; payload?: unknown }) =>
  app.inject({ ...options, headers: { cookie } } as never);

/** A client that answers with the given reply, and optionally proposes a record. */
function stubClient(reply: string, proposal?: Record<string, unknown>): DeepSeekClient {
  const fetchImpl = (async () => {
    const message = proposal === undefined
      ? { content: reply, tool_calls: undefined }
      : {
          content: reply,
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'propose_feedback', arguments: JSON.stringify(proposal) } },
          ],
        };
    return new Response(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }], usage: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return new DeepSeekClient({ apiKey: 'test-key', model: 'deepseek-chat', fetchImpl });
}

async function buildWith(client: DeepSeekClient): Promise<{ app: FastifyInstance; close: () => Promise<void> }> {
  const templatesDir = join(tempDir('td-fb-tpl-'), 'templates');
  writeTemplate(templatesDir, 'agreement.md', AGREEMENT_TEMPLATE);
  const config = loadConfig({
    dataDir: tempDir('td-fb-data-'),
    templatesDir,
    publicDir: resolve('public'),
    deepseekApiKey: 'test-key',
    offlineMode: false,
    operatorEmails: [OPERATOR.email],
  });
  // Its own database: sharing the module's store would collide with the accounts above.
  const ownStore = new Store(config.dataDir);
  const instance = await buildApp({
    config,
    store: ownStore,
    registry: await TemplateRegistry.load(config.templatesDir),
    client,
  });
  await instance.ready();
  return {
    app: instance,
    close: async () => {
      await instance.close();
      ownStore.close();
    },
  };
}

let registry: TemplateRegistry;

before(async () => {
  const templatesDir = join(tempDir('td-fb-main-tpl-'), 'templates');
  writeTemplate(templatesDir, 'agreement.md', AGREEMENT_TEMPLATE);
  const config = loadConfig({
    dataDir: tempDir('td-fb-main-data-'),
    templatesDir,
    publicDir: resolve('public'),
    deepseekApiKey: '',
    offlineMode: false,
    operatorEmails: [OPERATOR.email],
  });
  store = new Store(config.dataDir);
  registry = await TemplateRegistry.load(config.templatesDir);
  app = await buildApp({
    config,
    store,
    registry,
    client: stubClient('So you want the deposit date to fill itself in. Is that right?'),
  });
  await app.ready();

  const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: OWNER });
  assert.equal(setup.statusCode, 201);
  ownerCookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';

  // An operator who is not the agency owner: the person who owns the product.
  const created = await as(ownerCookie, {
    method: 'POST',
    url: '/api/users',
    payload: { ...OPERATOR, role: 'owner' },
  });
  assert.equal(created.statusCode, 201, created.body);
  operatorCookie = await signIn(OPERATOR.email, OPERATOR.password);

  await as(ownerCookie, { method: 'POST', url: '/api/users', payload: { ...AGENT, role: 'agent' } });
  agentCookie = await signIn(AGENT.email, AGENT.password);

  const landlord = await as(ownerCookie, {
    method: 'POST',
    url: '/api/backoffice/landlords',
    payload: { name: 'Landlord A', address: '1 A Street', email: LANDLORD.email, phone: '07700 900001' },
  });
  landlordId = landlord.json().id;
  const landlordUser = await as(ownerCookie, {
    method: 'POST',
    url: '/api/users',
    payload: { ...LANDLORD, role: 'landlord', landlordId },
  });
  assert.equal(landlordUser.statusCode, 201, landlordUser.body);
  landlordCookie = await signIn(LANDLORD.email, LANDLORD.password);
});

after(async () => {
  await app.close();
  store.close();
  resetFeedbackLimits();
});

describe('the flag', () => {
  it('marks only the operator, not every agency owner', async () => {
    const me = await as(operatorCookie, { method: 'GET', url: '/api/auth/me' });
    assert.equal(me.json().isOperator, true);

    const owner = await as(ownerCookie, { method: 'GET', url: '/api/auth/me' });
    assert.equal(owner.json().isOperator, false, 'an agency owner is not the product owner');
  });
});

describe('filing', () => {
  it('lets anyone with an account file feedback, including a read-only landlord', async () => {
    resetFeedbackLimits();
    const response = await as(landlordCookie, {
      method: 'POST',
      url: '/api/feedback',
      payload: {
        title: 'The deposit date should fill itself in',
        summary: 'Stop making me type the deposit date; take it from the start date.',
        kind: 'improvement',
        area: 'details',
        screen: 'details',
      },
    });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().feedback.status, 'new');
    assert.equal(response.json().feedback.statusWords, 'Sent');
  });

  it('insists on something to act on', async () => {
    const response = await as(agentCookie, { method: 'POST', url: '/api/feedback', payload: {} });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /what to change/i);
  });

  it('gives a person their own list, with status words they understand', async () => {
    const mine = await as(landlordCookie, { method: 'GET', url: '/api/feedback/mine' });
    assert.equal(mine.statusCode, 200);
    assert.equal(mine.json().items.length >= 1, true);
    for (const item of mine.json().items) {
      assert.equal(typeof item.statusWords, 'string');
      assert.equal(item.statusWords.length > 0, true);
    }
  });

  it('does not show one person another person’s feedback', async () => {
    const agentMine = await as(agentCookie, { method: 'GET', url: '/api/feedback/mine' });
    assert.deepEqual(agentMine.json().items, [], 'the agent has filed nothing');
  });
});

describe('the queue is the operator’s, and nobody else’s', () => {
  it('refuses the agency owner — a landlord’s words are not theirs', async () => {
    const response = await as(ownerCookie, { method: 'GET', url: '/api/feedback/queue' });
    assert.equal(response.statusCode, 403);
    assert.match(response.json().error, /product owner/i);
  });

  it('refuses an agent', async () => {
    assert.equal((await as(agentCookie, { method: 'GET', url: '/api/feedback/queue' })).statusCode, 403);
  });

  it('refuses a landlord, who may file but not read', async () => {
    assert.equal((await as(landlordCookie, { method: 'GET', url: '/api/feedback/queue' })).statusCode, 403);
  });

  it('lets the operator read it, with counts', async () => {
    const response = await as(operatorCookie, { method: 'GET', url: '/api/feedback/queue' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.items.length >= 1, true);
    assert.equal(typeof body.counts.new, 'number');
    const filed = body.items.find((item: { title: string }) => item.title.includes('deposit date'));
    assert.ok(filed, 'the landlord feedback should be in the queue');
    assert.equal(filed.role, 'landlord');
    assert.equal(filed.userName, LANDLORD.name);
  });

  it('refuses a status change from anyone but the operator', async () => {
    const queue = await as(operatorCookie, { method: 'GET', url: '/api/feedback/queue' });
    const id = queue.json().items[0].id;
    assert.equal(
      (await as(ownerCookie, { method: 'PATCH', url: `/api/feedback/${id}`, payload: { status: 'done' } })).statusCode,
      403,
    );
    assert.equal(
      (await as(landlordCookie, { method: 'PATCH', url: `/api/feedback/${id}`, payload: { status: 'done' } })).statusCode,
      403,
    );
  });

  it('moves a record through its states, and the tester sees the change', async () => {
    const queue = await as(operatorCookie, { method: 'GET', url: '/api/feedback/queue' });
    const item = queue.json().items[0];
    const updated = await as(operatorCookie, {
      method: 'PATCH',
      url: `/api/feedback/${item.id}`,
      payload: { status: 'planned', publicNote: 'On the list for the next release.' },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().feedback.status, 'planned');
    assert.equal(updated.json().feedback.doneAt, null);

    const mine = await as(landlordCookie, { method: 'GET', url: '/api/feedback/mine' });
    const seen = mine.json().items.find((entry: { id: string }) => entry.id === item.id);
    assert.equal(seen.statusWords, 'On the list');
    assert.match(seen.publicNote, /next release/);
  });

  it('records when something was closed out', async () => {
    const queue = await as(operatorCookie, { method: 'GET', url: '/api/feedback/queue' });
    const item = queue.json().items[0];
    const done = await as(operatorCookie, {
      method: 'PATCH',
      url: `/api/feedback/${item.id}`,
      payload: { status: 'done' },
    });
    assert.equal(done.json().feedback.status, 'done');
    assert.notEqual(done.json().feedback.doneAt, null);
  });

  it('exports markdown for the operator only', async () => {
    const exported = await as(operatorCookie, { method: 'GET', url: '/api/feedback/export?private=1' });
    assert.equal(exported.statusCode, 200);
    assert.match(exported.body, /# Feedback/);
    assert.equal((await as(ownerCookie, { method: 'GET', url: '/api/feedback/export' })).statusCode, 403);
  });
});

describe('the conversation', () => {
  it('reflects back and offers a record, without filing it', async () => {
    resetFeedbackLimits();
    const response = await as(agentCookie, {
      method: 'POST',
      url: '/api/feedback/chat',
      payload: {
        messages: [{ role: 'tester', text: 'I keep typing the deposit date when it is always the same day.' }],
        context: { screen: 'details', packReference: 'TD-2026-0001' },
      },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.match(body.reply, /deposit date/i);
    assert.equal(body.proposal, null, 'the stub proposes nothing, so nothing is offered');

    // Nothing was filed by talking to it.
    const mine = await as(agentCookie, { method: 'GET', url: '/api/feedback/mine' });
    assert.deepEqual(mine.json().items, []);
  });

  it('offers a structured proposal from the model, and files it only when asked', async () => {
    const { app: proposing, close: closeProposing } = await buildWith(
      stubClient('So you want a filter on the document list. Is that right?', {
        kind: 'new_feature',
        title: 'Filter the document list',
        summary: 'The tester wants to filter the generated documents by type instead of scrolling.',
        area: 'documents',
        sentiment: 'neutral',
      }),
    );
    try {
      const setup = await proposing.inject({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { name: 'Solo', email: 'solo@example.test', password: 'a long enough phrase' },
      });
      const cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';

      const turn = await proposing.inject({
        method: 'POST',
        url: '/api/feedback/chat',
        headers: { cookie },
        payload: { messages: [{ role: 'tester', text: 'I want to filter documents' }], context: { screen: 'documents' } },
      });
      assert.equal(turn.statusCode, 200);
      const proposal = turn.json().proposal;
      assert.equal(proposal.kind, 'new_feature');
      assert.equal(proposal.title, 'Filter the document list');
      assert.equal(proposal.area, 'documents');

      // The tester's confirmation is the request that files it.
      const filed = await proposing.inject({
        method: 'POST',
        url: '/api/feedback',
        headers: { cookie },
        payload: { ...proposal, screen: 'documents', messages: [{ role: 'tester', text: 'I want to filter documents' }] },
      });
      assert.equal(filed.statusCode, 201);
      assert.equal(filed.json().feedback.title, 'Filter the document list');
    } finally {
      await closeProposing();
    }
  });

  it('falls back to the form when the assistant is switched off', async () => {
    const offline = join(tempDir('td-fb-off-tpl-'), 'templates');
    writeTemplate(offline, 'agreement.md', AGREEMENT_TEMPLATE);
    const config = loadConfig({
      dataDir: tempDir('td-fb-off-data-'),
      templatesDir: offline,
      publicDir: resolve('public'),
      deepseekApiKey: '',
      offlineMode: true,
      operatorEmails: [OPERATOR.email],
    });
    const offStore = new Store(config.dataDir);
    const offApp = await buildApp({ config, store: offStore, registry: await TemplateRegistry.load(config.templatesDir) });
    await offApp.ready();
    try {
      const setup = await offApp.inject({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { name: 'Solo', email: 'solo2@example.test', password: 'a long enough phrase' },
      });
      const cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';
      const turn = await offApp.inject({
        method: 'POST',
        url: '/api/feedback/chat',
        headers: { cookie },
        payload: { messages: [{ role: 'tester', text: 'anything' }] },
      });
      assert.equal(turn.statusCode, 200);
      assert.equal(turn.json().unavailable, true);
      assert.match(turn.json().reply, /form/i);
    } finally {
      await offApp.close();
      offStore.close();
    }
  });
});

describe('the record itself', () => {
  it('flags personal data for a human to read', () => {
    const flags = reviewFlags('The tenant Mary Ajala at mary@example.com, DA1 5RP, rang 07403401298', false);
    assert.equal(flags.length >= 3, true);
    assert.equal(flags.some((flag) => flag.includes('email')), true);
    assert.equal(flags.some((flag) => flag.includes('postcode')), true);
    assert.equal(flags.some((flag) => flag.includes('phone')), true);
  });

  it('flags a promise, especially from the assistant', () => {
    assert.equal(reviewFlags('We will have that fixed by Friday.', true).some((flag) => flag.includes('promise')), true);
    assert.equal(reviewFlags('That is a fair point about the tabs.', false).length, 0);
  });

  it('measures how alike two asks are, cheaply', () => {
    const score = similarity(
      'Filter the document list by type',
      'I want to filter the list of documents by type',
    );
    assert.equal(score > 0.6, true, `expected a high score, got ${score}`);
    assert.equal(similarity('Filter the document list', 'The gas certificate date is wrong') < 0.3, true);
  });

  it('groups duplicates so the queue shows weight, not noise', async () => {
    resetFeedbackLimits();
    const first = await as(agentCookie, {
      method: 'POST',
      url: '/api/feedback',
      payload: {
        title: 'Filter documents by type',
        summary: 'Add a filter to the generated document list so I do not scroll.',
        kind: 'new_feature',
        area: 'documents',
      },
    });
    const second = await as(ownerCookie, {
      method: 'POST',
      url: '/api/feedback',
      payload: {
        title: 'Filter documents by type',
        summary: 'Add a filter to the generated document list so I do not have to scroll.',
        kind: 'new_feature',
        area: 'documents',
      },
    });
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);

    const queue = await as(operatorCookie, { method: 'GET', url: '/api/feedback/queue' });
    const grouped = queue
      .json()
      .items.filter((item: { title: string }) => item.title === 'Filter documents by type');
    assert.equal(grouped.length, 2, 'both should be in the queue');
    assert.equal(Math.max(...grouped.map((item: { clusterCount: number }) => item.clusterCount)), 2);
  });

  it('will not let one person flood the list', async () => {
    resetFeedbackLimits();
    let last = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await as(agentCookie, {
        method: 'POST',
        url: '/api/feedback',
        payload: { title: `Idea ${attempt}`, summary: `Something different each time, number ${attempt}.` },
      });
      last = response.statusCode;
    }
    assert.equal(last, 429);
  });
});

describe('signing in is still the door', () => {
  it('refuses feedback routes without a session', async () => {
    resetLoginAttempts();
    for (const url of ['/api/feedback/mine', '/api/feedback/queue']) {
      assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401, url);
    }
  });
});
