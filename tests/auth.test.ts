/**
 * Signing in, and the rules that hold once you have.
 *
 * The interesting assertions are the refusals: a request with no session, a
 * landlord reaching for somebody else's tenancy, an agent reaching for the user
 * list, a cross-origin form post. Those are the ones that go quietly wrong.
 */

import { strict as assert } from 'node:assert';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { TemplateRegistry } from '../src/docs/registry.ts';
import { resetLoginAttempts } from '../src/auth/routes.ts';
import { hashPassword, passwordProblem, verifyPassword } from '../src/auth/passwords.ts';
import { AGREEMENT_TEMPLATE, tempDir, writeTemplate } from './helpers.ts';

let app: FastifyInstance;
let store: Store;

const OWNER = { name: 'Mary Ajala', email: 'owner@havenbricks.test', password: 'the long owner phrase' };
const AGENT = { name: 'Ade Bello', email: 'ade@havenbricks.test', password: 'the long agent phrase' };
const LANDLORD_PASSWORD = 'the long landlord phrase';

let ownerCookie = '';
let agentCookie = '';
let landlordCookie = '';
let landlordAId = '';
let landlordBId = '';
let packForAId = '';
let packForBId = '';

const signIn = async (email: string, password: string): Promise<string> => {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  assert.equal(response.statusCode, 200, `sign in failed for ${email}: ${response.body}`);
  return String(response.headers['set-cookie'] ?? '').split(';')[0] ?? '';
};

before(async () => {
  const templatesDir = join(tempDir('td-auth-tpl-'), 'templates');
  writeTemplate(templatesDir, 'agreement.md', AGREEMENT_TEMPLATE);

  const config = loadConfig({
    dataDir: tempDir('td-auth-data-'),
    templatesDir,
    publicDir: resolve('public'),
    deepseekApiKey: '',
    offlineMode: false,
  });

  store = new Store(config.dataDir);
  const registry = await TemplateRegistry.load(config.templatesDir);
  app = await buildApp({ config, store, registry });
  await app.ready();

  const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: OWNER });
  assert.equal(setup.statusCode, 201);
  ownerCookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';

  const asOwner = (options: { method: string; url: string; payload?: unknown; headers?: Record<string, string> }) =>
    app.inject({ ...options, headers: { cookie: ownerCookie, ...(options.headers ?? {}) } } as never);

  // Two landlords, so "their own" can be told apart from "everybody's".
  const landlordA = await asOwner({
    method: 'POST',
    url: '/api/backoffice/landlords',
    payload: { name: 'Landlord A', address: '1 A Street', email: 'a@landlord.test', phone: '07700 900001' },
  });
  landlordAId = landlordA.json().id;

  const landlordB = await asOwner({
    method: 'POST',
    url: '/api/backoffice/landlords',
    payload: { name: 'Landlord B', address: '2 B Street', email: 'b@landlord.test', phone: '07700 900002' },
  });
  landlordBId = landlordB.json().id;

  const createPackFor = async (landlordId: string, name: string): Promise<string> => {
    const created = await asOwner({
      method: 'POST',
      url: '/api/packs',
      payload: { fields: { tenants: [{ full_name: name }], 'property.address_line1': `${name} House` } },
    });
    const id = created.json().pack.id as string;
    await asOwner({ method: 'PATCH', url: `/api/packs/${id}`, payload: { landlordId, propertyId: null } });
    return id;
  };

  packForAId = await createPackFor(landlordAId, 'Tenant A');
  packForBId = await createPackFor(landlordBId, 'Tenant B');

  // An agent: everything about tenancies, nothing about people.
  const agent = await asOwner({
    method: 'POST',
    url: '/api/users',
    payload: { ...AGENT, role: 'agent' },
  });
  assert.equal(agent.statusCode, 201, agent.body);
  agentCookie = await signIn(AGENT.email, AGENT.password);

  // A landlord account tied to landlord A.
  const landlord = await asOwner({
    method: 'POST',
    url: '/api/users',
    payload: {
      name: 'Landlord A',
      email: 'a@landlord.test',
      password: LANDLORD_PASSWORD,
      role: 'landlord',
      landlordId: landlordAId,
    },
  });
  assert.equal(landlord.statusCode, 201, landlord.body);
  landlordCookie = await signIn('a@landlord.test', LANDLORD_PASSWORD);
});

after(async () => {
  await app.close();
  store.close();
});

const request = (cookie: string, options: { method: string; url: string; payload?: unknown; headers?: Record<string, string> }) =>
  app.inject({ ...options, headers: { cookie, ...(options.headers ?? {}) } } as never);

describe('passwords', () => {
  it('stores something that is not the password, and checks it', async () => {
    const stored = await hashPassword('correct horse battery staple');
    assert.equal(stored.includes('correct horse'), false);
    assert.match(stored, /^scrypt\$/);
    assert.equal(await verifyPassword('correct horse battery staple', stored), true);
    assert.equal(await verifyPassword('correct horse battery stapl', stored), false);
    assert.equal(await verifyPassword('', stored), false);
  });

  it('refuses a hash it cannot read', async () => {
    assert.equal(await verifyPassword('anything', 'not-a-hash'), false);
    assert.equal(await verifyPassword('anything', 'scrypt$1$2$3'), false);
  });

  it('asks for a long enough password, in words', () => {
    assert.match(passwordProblem('short'), /at least 12/);
    assert.match(passwordProblem('aaaaaaaaaaaaaa'), /repeated/);
    assert.equal(passwordProblem('three unconnected words'), '');
  });
});

describe('the door', () => {
  it('refuses every API call without a session', async () => {
    for (const url of ['/api/packs', '/api/config', '/api/backoffice', '/api/users', '/api/due']) {
      const response = await app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 401, `${url} should need a session`);
      assert.match(response.json().error, /sign in/i);
    }
  });

  it('lets the health check and the status through, because the sign-in screen needs them', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/health' })).statusCode, 200);
    const status = await app.inject({ method: 'GET', url: '/api/auth/status' });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().needsSetup, false);
    assert.equal(status.json().signedIn, false);
  });

  it('closes the setup screen once an account exists', async () => {
    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { name: 'Someone Else', email: 'sneaky@example.test', password: 'another long phrase' },
    });
    assert.equal(again.statusCode, 409);
  });

  it('will not sign in with the wrong password, or an address nobody has', async () => {
    resetLoginAttempts();
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: OWNER.email, password: 'not the password' },
    });
    assert.equal(wrong.statusCode, 401);
    assert.match(wrong.json().error, /do not match/);

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.test', password: 'not the password' },
    });
    assert.equal(unknown.statusCode, 401);
    // The same message both ways: the door must not confirm who exists.
    assert.equal(unknown.json().error, wrong.json().error);
  });

  it('stops guessing after ten tries', async () => {
    resetLoginAttempts();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: AGENT.email, password: `wrong guess ${attempt}` },
      });
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: AGENT.email, password: AGENT.password },
    });
    assert.equal(blocked.statusCode, 429);
    assert.match(blocked.json().error, /Too many attempts/);
    resetLoginAttempts();
  });

  it('refuses a write that arrives from another origin', async () => {
    const response = await request(ownerCookie, {
      method: 'POST',
      url: '/api/packs',
      payload: { fields: {} },
      headers: { origin: 'https://somewhere-else.example' },
    });
    assert.equal(response.statusCode, 403);
  });

  it('accepts a write from its own origin', async () => {
    const response = await request(ownerCookie, {
      method: 'POST',
      url: '/api/packs',
      payload: { fields: {} },
      headers: { origin: 'http://localhost:80', host: 'localhost:80' },
    });
    assert.equal(response.statusCode, 201);
    await request(ownerCookie, { method: 'DELETE', url: `/api/packs/${response.json().pack.id}` });
  });

  it('signs out, and the cookie stops working', async () => {
    const temporary = await signIn(OWNER.email, OWNER.password);
    assert.equal((await request(temporary, { method: 'GET', url: '/api/packs' })).statusCode, 200);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: temporary } });
    assert.equal((await request(temporary, { method: 'GET', url: '/api/packs' })).statusCode, 401);
  });

  it('signs out other browsers when the password changes', async () => {
    const first = await signIn(OWNER.email, OWNER.password);
    const second = await signIn(OWNER.email, OWNER.password);

    const changed = await request(second, {
      method: 'POST',
      url: '/api/auth/password',
      payload: { current: OWNER.password, next: 'a brand new long phrase' },
    });
    assert.equal(changed.statusCode, 200);

    assert.equal((await request(first, { method: 'GET', url: '/api/auth/me' })).statusCode, 401);
    assert.equal((await request(second, { method: 'GET', url: '/api/auth/me' })).statusCode, 200);

    // Put it back, so the rest of the file keeps working.
    const restored = await request(second, {
      method: 'POST',
      url: '/api/auth/password',
      payload: { current: 'a brand new long phrase', next: OWNER.password },
    });
    assert.equal(restored.statusCode, 200);
    ownerCookie = await signIn(OWNER.email, OWNER.password);
  });
});

describe('what a landlord may see', () => {
  it('gets only their own tenancies in the list', async () => {
    const response = await request(landlordCookie, { method: 'GET', url: '/api/packs' });
    assert.equal(response.statusCode, 200);
    const ids = response.json().packs.map((pack: { id: string }) => pack.id);
    assert.deepEqual(ids, [packForAId]);
    assert.equal(ids.includes(packForBId), false);
  });

  it('can open their own pack', async () => {
    const response = await request(landlordCookie, { method: 'GET', url: `/api/packs/${packForAId}` });
    assert.equal(response.statusCode, 200);
  });

  it('is told "not found" for somebody else’s pack, which reveals nothing', async () => {
    const response = await request(landlordCookie, { method: 'GET', url: `/api/packs/${packForBId}` });
    assert.equal(response.statusCode, 404);
    assert.match(response.json().error, /not one of yours/);
  });

  it('cannot change anything, even their own pack', async () => {
    const patch = await request(landlordCookie, {
      method: 'PATCH',
      url: `/api/packs/${packForAId}`,
      payload: { fields: { 'tenancy.rent_amount': 1 } },
    });
    assert.equal(patch.statusCode, 403);
    assert.match(patch.json().error, /read-only/);

    const generated = await request(landlordCookie, {
      method: 'POST',
      url: `/api/packs/${packForAId}/generate`,
      payload: { templateIds: ['test-agreement'], confirm: true },
    });
    assert.equal(generated.statusCode, 403);

    const note = await request(landlordCookie, {
      method: 'POST',
      url: `/api/packs/${packForAId}/notes`,
      payload: { text: 'hello' },
    });
    assert.equal(note.statusCode, 403);
  });

  it('cannot reach settings, people, backup or the assistant', async () => {
    for (const url of ['/api/users', '/api/settings', '/api/backup', '/api/custom-templates']) {
      const response = await request(landlordCookie, { method: 'GET', url });
      assert.equal(response.statusCode, 403, `${url} should be closed to a landlord`);
    }
    const assistant = await request(landlordCookie, {
      method: 'POST',
      url: `/api/packs/${packForAId}/assistant`,
      payload: { message: 'what is missing?' },
    });
    assert.equal(assistant.statusCode, 403);
  });

  it('gets their own records in the back office, and no other landlord', async () => {
    const response = await request(landlordCookie, { method: 'GET', url: '/api/backoffice' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body.landlords.map((landlord: { id: string }) => landlord.id), [landlordAId]);
    assert.equal(body.properties.every((property: { landlordId: string }) => property.landlordId === landlordAId), true);
  });

  it('sees only their own deadlines', async () => {
    const response = await request(landlordCookie, { method: 'GET', url: '/api/due' });
    assert.equal(response.statusCode, 200);
    const packIds = new Set(response.json().items.map((item: { packId: string }) => item.packId));
    assert.equal(packIds.has(packForBId), false);
  });
});

describe('what an agent may not do', () => {
  it('cannot list or change people', async () => {
    assert.equal((await request(agentCookie, { method: 'GET', url: '/api/users' })).statusCode, 403);
    const created = await request(agentCookie, {
      method: 'POST',
      url: '/api/users',
      payload: { name: 'New Person', email: 'new@example.test', role: 'agent', password: 'a long enough one' },
    });
    assert.equal(created.statusCode, 403);
  });

  it('cannot change the agency details or download a backup', async () => {
    const settings = await request(agentCookie, {
      method: 'PUT',
      url: '/api/settings',
      payload: { name: 'Renamed Ltd' },
    });
    assert.equal(settings.statusCode, 403);
    assert.equal((await request(agentCookie, { method: 'GET', url: '/api/backup' })).statusCode, 403);
  });

  it('can do the actual work: every pack, generate, note', async () => {
    const packs = await request(agentCookie, { method: 'GET', url: '/api/packs' });
    assert.equal(packs.statusCode, 200);
    assert.equal(packs.json().packs.length >= 2, true);

    const note = await request(agentCookie, {
      method: 'POST',
      url: `/api/packs/${packForBId}/notes`,
      payload: { text: 'Rang the landlord about the boiler' },
    });
    assert.equal(note.statusCode, 200);
  });
});

describe('the record of who did what', () => {
  it('names the person who opened a pack', async () => {
    const response = await request(agentCookie, { method: 'GET', url: `/api/packs/${packForAId}` });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.creator.name, OWNER.name);
    assert.equal(
      body.events.some((event: { kind: string }) => event.kind === 'pack.created'),
      true,
    );
  });

  it('records a field change with the field names, and the person', async () => {
    await request(agentCookie, {
      method: 'PATCH',
      url: `/api/packs/${packForAId}`,
      payload: { fields: { 'tenancy.rent_amount': 900 } },
    });

    const detail = await request(agentCookie, { method: 'GET', url: `/api/packs/${packForAId}` });
    const change = detail
      .json()
      .events.find((event: { kind: string }) => event.kind === 'fields.changed');
    assert.ok(change, 'a field change should be recorded');
    assert.equal(change.actorName, AGENT.name);
    assert.match(change.detail, /tenancy\.rent_amount/);
    // The values themselves stay on the pack: the trail records who and what, not a copy of the data.
    assert.equal(change.detail.includes('900'), false);
  });

  it('records a note with its author', async () => {
    const response = await request(agentCookie, {
      method: 'POST',
      url: `/api/packs/${packForAId}/notes`,
      payload: { text: 'Deposit protected with the DPS' },
    });
    const notes = response.json().notes;
    const last = notes[notes.length - 1];
    assert.equal(last.author, AGENT.name);
  });

  it('records documents being generated', async () => {
    await request(ownerCookie, {
      method: 'PATCH',
      url: `/api/packs/${packForAId}`,
      payload: { fields: { 'landlord.full_name': 'Landlord A', 'tenancy.start_date': '2026-11-01' } },
    });
    const generated = await request(ownerCookie, {
      method: 'POST',
      url: `/api/packs/${packForAId}/generate`,
      payload: { templateIds: ['test-agreement'], confirm: true },
    });
    assert.equal(generated.statusCode, 200);

    const detail = await request(ownerCookie, { method: 'GET', url: `/api/packs/${packForAId}` });
    const event = detail
      .json()
      .events.find((entry: { kind: string }) => entry.kind === 'documents.generated');
    assert.ok(event, 'generating documents should be recorded');
    assert.equal(event.actorName, OWNER.name);
    assert.match(event.detail, /Test Tenancy Agreement/);
  });

  it('records people being added and switched off', async () => {
    const users = await request(ownerCookie, { method: 'GET', url: '/api/users' });
    const agent = users.json().users.find((user: { email: string }) => user.email === AGENT.email);
    const off = await request(ownerCookie, {
      method: 'POST',
      url: `/api/users/${agent.id}/disabled`,
      payload: { disabled: true },
    });
    assert.equal(off.statusCode, 200);

    // A disabled person cannot sign in, and their open session is closed.
    resetLoginAttempts();
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: AGENT.email, password: AGENT.password },
    });
    assert.equal(blocked.statusCode, 401);
    assert.equal((await request(agentCookie, { method: 'GET', url: '/api/auth/me' })).statusCode, 401);

    const backOn = await request(ownerCookie, {
      method: 'POST',
      url: `/api/users/${agent.id}/disabled`,
      payload: { disabled: false },
    });
    assert.equal(backOn.statusCode, 200);
    agentCookie = await signIn(AGENT.email, AGENT.password);
  });

  it('will not let the owner switch off the last owner account', async () => {
    const me = await request(ownerCookie, { method: 'GET', url: '/api/auth/me' });
    const id = me.json().id;

    const off = await request(ownerCookie, {
      method: 'POST',
      url: `/api/users/${id}/disabled`,
      payload: { disabled: true },
    });
    assert.equal(off.statusCode, 400);
    assert.match(off.json().error, /cannot switch your own account off/);
  });

  it('insists a landlord account belongs to a landlord record', async () => {
    const response = await request(ownerCookie, {
      method: 'POST',
      url: '/api/users',
      payload: {
        name: 'Nobody',
        email: 'nobody@landlord.test',
        role: 'landlord',
        password: 'a long enough phrase',
      },
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /tied to a landlord record/);
  });

  it('resets a password without telling anyone what it was', async () => {
    const users = await request(ownerCookie, { method: 'GET', url: '/api/users' });
    const landlord = users.json().users.find((user: { email: string }) => user.email === 'a@landlord.test');
    const reset = await request(ownerCookie, {
      method: 'POST',
      url: `/api/users/${landlord.id}/password`,
      payload: { password: 'an entirely new phrase' },
    });
    assert.equal(reset.statusCode, 200);

    // The old sessions are gone, and the old password no longer works.
    assert.equal((await request(landlordCookie, { method: 'GET', url: '/api/auth/me' })).statusCode, 401);
    resetLoginAttempts();
    const old = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'a@landlord.test', password: LANDLORD_PASSWORD },
    });
    assert.equal(old.statusCode, 401);
  });
});
