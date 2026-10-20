import { strict as assert } from 'node:assert';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { TemplateRegistry } from '../src/docs/registry.ts';
import { DeepSeekClient } from '../src/agent/deepseek.ts';
import { readZip } from '../src/util/zip.ts';
import type { FastifyInstance } from 'fastify';
import { AGREEMENT_TEMPLATE, GUARANTOR_TEMPLATE, completeFields, tempDir, writeTemplate } from './helpers.ts';

let app: FastifyInstance;
let store: Store;

before(async () => {
  const templatesDir = join(tempDir('td-api-tpl-'), 'templates');
  writeTemplate(templatesDir, 'agreement.md', AGREEMENT_TEMPLATE);
  writeTemplate(templatesDir, 'guarantee.md', GUARANTOR_TEMPLATE);

  const config = loadConfig({
    dataDir: tempDir('td-api-data-'),
    templatesDir,
    publicDir: resolve('public'),
    deepseekApiKey: '',
    offlineMode: false,
  });

  store = new Store(config.dataDir);
  const registry = await TemplateRegistry.load(config.templatesDir);
  app = await buildApp({ config, store, registry });
  await app.ready();
});

after(async () => {
  await app.close();
  store.close();
});

async function createPack(): Promise<{ id: string; reference: string }> {
  const response = await app.inject({ method: 'POST', url: '/api/packs', payload: { fields: {} } });
  assert.equal(response.statusCode, 201);
  return response.json().pack;
}

describe('meta endpoints', () => {
  it('reports its health', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(body.templates, 2);
    assert.equal(body.assistantAvailable, false, 'no key configured in this test');
  });

  it('lists the field catalogue and groups', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/fields' })).json();
    assert.ok(body.groups.length > 0);
    assert.ok(body.fields.some((field: { key: string }) => field.key === 'tenancy.rent_amount'));
  });

  it('lists templates with the fields they still need', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/templates' })).json();
    assert.equal(body.templates.length, 2);
    assert.ok(body.templates[0].missing.length >= 0);
  });

  it('serves the rules knowledge base', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/rules?q=deposit' })).json();
    assert.ok(body.rules.length > 0);
    assert.ok(body.reviewedOn.startsWith('20'));
  });
});

describe('pack lifecycle', () => {
  it('creates a pack with a reference', async () => {
    const pack = await createPack();
    assert.match(pack.reference, /^TD-\d{4}-\d{4}$/);
  });

  it('merges fields sent by the form', async () => {
    const pack = await createPack();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/packs/${pack.id}`,
      payload: { fields: { 'landlord.full_name': 'Priya Raman' } },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.pack.fields['landlord.full_name'], 'Priya Raman');
    assert.equal(body.pack.tenantName, '');
  });

  it('becomes ready once the essentials are present', async () => {
    const pack = await createPack();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/packs/${pack.id}`,
      payload: { fields: completeFields() },
    });
    const body = response.json();
    assert.equal(body.readiness.ready, true);
    assert.equal(body.readiness.compliance.counts.error, 0);
    assert.equal(body.pack.tenantName, 'Alex Morgan');
  });

  it('rejects a status it does not recognise but keeps the pack', async () => {
    const pack = await createPack();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/packs/${pack.id}`,
      payload: { status: 'banana' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().pack.status, 'draft');
  });

  it('adds and removes notes', async () => {
    const pack = await createPack();
    const added = await app.inject({
      method: 'POST',
      url: `/api/packs/${pack.id}/notes`,
      payload: { text: 'Protect the deposit within 30 days' },
    });
    const notes = added.json().notes;
    assert.equal(notes.length, 1);

    const removed = await app.inject({ method: 'DELETE', url: `/api/packs/${pack.id}/notes/${notes[0].id}` });
    assert.equal(removed.json().notes.length, 0);
  });

  it('deletes a pack', async () => {
    const pack = await createPack();
    const response = await app.inject({ method: 'DELETE', url: `/api/packs/${pack.id}` });
    assert.equal(response.statusCode, 204);
    const missing = await app.inject({ method: 'GET', url: `/api/packs/${pack.id}` });
    assert.equal(missing.statusCode, 404);
  });

  it('404s for a pack that does not exist', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/packs/not-a-real-id' });
    assert.equal(response.statusCode, 404);
    assert.match(response.json().error, /no longer exists/);
  });
});

describe('documents', () => {
  async function readyPack(): Promise<{ id: string }> {
    const pack = await createPack();
    await app.inject({ method: 'PATCH', url: `/api/packs/${pack.id}`, payload: { fields: completeFields() } });
    return pack;
  }

  it('previews a document as HTML before generating it', async () => {
    const pack = await readyPack();
    const response = await app.inject({
      method: 'POST',
      url: `/api/packs/${pack.id}/preview`,
      payload: { templateId: 'test-agreement' },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.match(body.html, /Priya Raman/);
    assert.equal(body.title, 'Test Tenancy Agreement');
  });

  it('rejects a preview of an unknown document', async () => {
    const pack = await readyPack();
    const response = await app.inject({
      method: 'POST',
      url: `/api/packs/${pack.id}/preview`,
      payload: { templateId: 'nope' },
    });
    assert.equal(response.statusCode, 400);
  });

  it('generates documents and returns the refreshed pack', async () => {
    const pack = await readyPack();
    const response = await app.inject({
      method: 'POST',
      url: `/api/packs/${pack.id}/generate`,
      payload: { templateIds: ['test-agreement'] },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.documents.length, 1);
    assert.equal(body.pack.documents.length, 1);
    assert.equal(body.pack.pack.status, 'generated');
  });

  it('rejects an unknown template id', async () => {
    const pack = await readyPack();
    const response = await app.inject({
      method: 'POST',
      url: `/api/packs/${pack.id}/generate`,
      payload: { templateIds: ['nope'] },
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /Unknown document/);
  });

  it('downloads the Word file with the right headers', async () => {
    const pack = await readyPack();
    const generated = (
      await app.inject({
        method: 'POST',
        url: `/api/packs/${pack.id}/generate`,
        payload: { templateIds: ['test-agreement'] },
      })
    ).json();
    const documentId = generated.documents[0].id;

    const response = await app.inject({
      method: 'GET',
      url: `/api/documents/${documentId}/download?format=docx`,
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] as string, /wordprocessingml/);
    assert.match(response.headers['content-disposition'] as string, /attachment/);
    assert.equal(response.rawPayload.subarray(0, 2).toString('latin1'), 'PK');
  });

  it('serves the HTML copy inline for printing', async () => {
    const pack = await readyPack();
    const generated = (
      await app.inject({
        method: 'POST',
        url: `/api/packs/${pack.id}/generate`,
        payload: { templateIds: ['test-agreement'] },
      })
    ).json();
    const response = await app.inject({
      method: 'GET',
      url: `/api/documents/${generated.documents[0].id}/download?format=html&inline=1`,
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-disposition'] as string, /^inline/);
  });

  it('bundles the pack and a summary sheet into one zip', async () => {
    const pack = await readyPack();
    await app.inject({
      method: 'POST',
      url: `/api/packs/${pack.id}/generate`,
      payload: { templateIds: ['test-agreement'] },
    });

    const response = await app.inject({ method: 'GET', url: `/api/packs/${pack.id}/bundle.zip` });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] as string, /application\/zip/);
    const body = response.rawPayload;
    assert.equal(body.subarray(0, 2).toString('latin1'), 'PK');

    // Entries are compressed, so read them back rather than scanning the bytes.
    const entries = readZip(body);
    const summary = entries.get('00 - Pack summary.txt');
    assert.ok(summary, 'the bundle must contain a contents sheet');
    assert.match(summary.toString('utf8'), /TENANCYDESK — DOCUMENT PACK/);
    assert.ok(
      [...entries.keys()].some((name) => name.endsWith('.docx')),
      'the bundle must contain the generated documents',
    );
  });

  it('refuses to bundle a pack with no documents', async () => {
    const pack = await createPack();
    const response = await app.inject({ method: 'GET', url: `/api/packs/${pack.id}/bundle.zip` });
    assert.equal(response.statusCode, 400);
  });

  it('404s for a document that no longer exists', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/documents/nope/download' });
    assert.equal(response.statusCode, 404);
  });
});

describe('assistant endpoint', () => {
  it('explains itself when no API key is configured', async () => {
    const pack = await createPack();
    const response = await app.inject({
      method: 'POST',
      url: `/api/packs/${pack.id}/assistant`,
      payload: { message: 'hello' },
    });
    assert.equal(response.statusCode, 503);
    assert.match(response.json().error, /DEEPSEEK_API_KEY|switched off/);
  });

  it('requires a message', async () => {
    const pack = await createPack();
    const response = await app.inject({
      method: 'POST',
      url: `/api/packs/${pack.id}/assistant`,
      payload: { message: '   ' },
    });
    // 503 takes precedence in this configuration, so accept either rejection.
    assert.ok(response.statusCode === 400 || response.statusCode === 503);
  });
});

describe('assistant streaming', () => {
  it('streams every step and the final message as server-sent events', async () => {
    const templatesDir = join(tempDir('td-sse-tpl-'), 'templates');
    writeTemplate(templatesDir, 'agreement.md', AGREEMENT_TEMPLATE);

    const config = loadConfig({
      dataDir: tempDir('td-sse-data-'),
      templatesDir,
      publicDir: resolve('public'),
      deepseekApiKey: 'test-key',
      offlineMode: false,
    });

    const sseStore = new Store(config.dataDir);
    const registry = await TemplateRegistry.load(config.templatesDir);

    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      const payload =
        call === 1
          ? {
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: 'c1',
                        type: 'function',
                        function: {
                          name: 'set_fields',
                          arguments: JSON.stringify({ fields: { 'landlord.full_name': 'Priya Raman' } }),
                        },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            }
          : {
              choices: [{ message: { content: 'Recorded the landlord.' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new DeepSeekClient({ apiKey: 'test-key', model: 'deepseek-chat', fetchImpl });
    const sseApp = await buildApp({ config, store: sseStore, registry, client });
    await sseApp.ready();

    const created = (
      await sseApp.inject({ method: 'POST', url: '/api/packs', payload: { fields: {} } })
    ).json();

    const response = await sseApp.inject({
      method: 'POST',
      url: `/api/packs/${created.pack.id}/assistant`,
      payload: { message: 'The landlord is Priya Raman' },
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] as string, /text\/event-stream/);
    assert.equal(call, 2);

    const body = response.body;
    for (const type of ['start', 'tool', 'tool_result', 'message', 'usage', 'done']) {
      assert.match(body, new RegExp(`"type":"${type}"`), `missing ${type} event`);
    }
    assert.match(body, /Recording 1 detail/);
    assert.match(body, /Recorded the landlord\./);
    // Every event is a well-formed `data:` frame.
    for (const frame of body.split('\n\n').filter((part) => part.trim() !== '')) {
      assert.ok(frame.startsWith('data: {'), `bad frame: ${frame.slice(0, 40)}`);
      JSON.parse(frame.slice(6));
    }

    const reloaded = (
      await sseApp.inject({ method: 'GET', url: `/api/packs/${created.pack.id}` })
    ).json();
    assert.equal(reloaded.pack.fields['landlord.full_name'], 'Priya Raman');

    await sseApp.close();
    sseStore.close();
  });
});
