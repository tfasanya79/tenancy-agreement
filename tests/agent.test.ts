import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { DeepSeekClient, DeepSeekError } from '../src/agent/deepseek.ts';
import { runAgent, type AgentEvent } from '../src/agent/loop.ts';
import { executeTool, TOOL_NAMES } from '../src/agent/tools.ts';
import { buildSystemPrompt } from '../src/agent/prompts.ts';
import { Store } from '../src/db.ts';
import { TemplateRegistry } from '../src/docs/registry.ts';
import { AGREEMENT_TEMPLATE, completeFields, tempDir, writeTemplate } from './helpers.ts';

/* ---------------------------------------------------------------- helpers --- */

function toolCall(name: string, args: unknown, id = 'call_1') {
  return {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

function textReply(text: string) {
  return {
    choices: [{ message: { content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
  };
}

/** A fetch stand-in that replays a fixed script of responses. */
function scriptedFetch(script: unknown[]) {
  let index = 0;
  const calls: Array<Record<string, unknown>> = [];

  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const next = script[index];
    index += 1;
    if (next === undefined) throw new Error('script exhausted');
    return new Response(JSON.stringify(next), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls: () => calls };
}

async function runtime() {
  const templatesDir = join(tempDir('td-agent-tpl-'), 'templates');
  writeTemplate(templatesDir, 'agreement.md', AGREEMENT_TEMPLATE);
  const registry = await TemplateRegistry.load(templatesDir);
  const store = new Store(tempDir('td-agent-data-'));
  const pack = store.createPack({});
  return {
    registry,
    store,
    pack,
    runtime: {
      store,
      registry,
      packId: pack.id,
      fallbackFields: {},
      // These unit tests exercise the tools without back-office inheritance.
      effective: (packId: string) => store.getPack(packId).fields,
      provenance: () => ({}) as Record<string, string>,
    },
  };
}

/* ------------------------------------------------------------------ tests --- */

describe('deepseek client', () => {
  it('refuses to call the API without a key', async () => {
    const client = new DeepSeekClient({ apiKey: '', model: 'deepseek-chat' });
    assert.equal(client.configured, false);
    await assert.rejects(() => client.chat([{ role: 'user', content: 'hi' }]), (error: unknown) => {
      assert.ok(error instanceof DeepSeekError);
      assert.match(error.message, /DEEPSEEK_API_KEY/);
      return true;
    });
  });

  it('turns a 401 into a helpful message and does not retry', async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
    }) as unknown as typeof fetch;

    const client = new DeepSeekClient({ apiKey: 'k', model: 'deepseek-chat', fetchImpl });
    await assert.rejects(() => client.chat([{ role: 'user', content: 'hi' }]), (error: unknown) => {
      assert.ok(error instanceof DeepSeekError);
      assert.match(error.message, /rejected the API key/);
      return true;
    });
    assert.equal(attempts, 1);
  });

  it('retries a 500 and then succeeds', async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      if (attempts === 1) return new Response('boom', { status: 500 });
      return new Response(JSON.stringify(textReply('recovered')), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new DeepSeekClient({ apiKey: 'k', model: 'deepseek-chat', fetchImpl, maxRetries: 1 });
    const result = await client.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(result.content, 'recovered');
    assert.equal(attempts, 2);
  });

  it('passes tools and parses tool calls', async () => {
    const { fetchImpl, calls } = scriptedFetch([toolCall('get_pack', {})]);
    const client = new DeepSeekClient({ apiKey: 'k', model: 'deepseek-chat', fetchImpl });
    const result = await client.chat([{ role: 'user', content: 'hi' }], [
      {
        type: 'function',
        function: { name: 'get_pack', description: 'read', parameters: { type: 'object', properties: {} } },
      },
    ]);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0]?.function.name, 'get_pack');
    assert.equal(result.usage.totalTokens, 120);
    const body = calls()[0];
    assert.equal(body?.['tool_choice'], 'auto');
    assert.equal(body?.['model'], 'deepseek-chat');
  });
});

describe('tools', () => {
  it('registers exactly the tools the model is offered', () => {
    assert.deepEqual([...TOOL_NAMES].sort(), [
      'add_note',
      'check_compliance',
      'generate_documents',
      'get_pack',
      'list_documents',
      'lookup_rules',
      'save_cover_message',
      'set_fields',
    ]);
  });

  it('records fields and reports what is still missing', async () => {
    const context = await runtime();
    const outcome = await executeTool('set_fields', { fields: { 'landlord.full_name': 'Priya Raman' } }, context.runtime);
    assert.equal(outcome.ok, true);
    const result = outcome.result as { saved: string[]; still_missing: Array<{ key: string }> };
    assert.deepEqual(result.saved, ['landlord.full_name']);
    assert.ok(result.still_missing.some((entry) => entry.key === 'tenants'));

    const stored = context.store.getPack(context.pack.id);
    assert.equal(stored.fields['landlord.full_name'], 'Priya Raman');
    context.store.close();
  });

  it('ignores keys that are not in the catalogue', async () => {
    const context = await runtime();
    const outcome = await executeTool('set_fields', { fields: { invented_key: 'x' } }, context.runtime);
    const result = outcome.result as { ignored_unknown_keys: string[] };
    assert.deepEqual(result.ignored_unknown_keys, ['invented_key']);
    assert.equal('invented_key' in context.store.getPack(context.pack.id).fields, false);
    context.store.close();
  });

  it('will not generate documents while a compliance error remains', async () => {
    const context = await runtime();
    const outcome = await executeTool('generate_documents', {}, context.runtime);
    assert.equal(outcome.ok, false);
    assert.match(String((outcome.result as { error: string }).error), /compliance errors/);
    assert.equal(context.store.listDocuments(context.pack.id).length, 0);
    context.store.close();
  });

  it('generates documents once the pack is complete', async () => {
    const context = await runtime();
    context.store.updatePack(context.pack.id, { fields: completeFields() });
    const outcome = await executeTool('generate_documents', {}, context.runtime);
    assert.equal(outcome.ok, true);
    const result = outcome.result as { generated: unknown[] };
    assert.ok(result.generated.length >= 1);
    context.store.close();
  });

  it('answers a rules question from the knowledge base', async () => {
    const context = await runtime();
    const outcome = await executeTool('lookup_rules', { query: 'deposit protection' }, context.runtime);
    const result = outcome.result as { rules: Array<{ title: string; source: { url: string } }> };
    assert.ok(result.rules.length > 0);
    assert.ok(result.rules[0]?.source.url.startsWith('https://'));
    context.store.close();
  });

  it('keeps notes and the tenant message on the pack', async () => {
    const context = await runtime();
    await executeTool('add_note', { text: 'Protect the deposit by 30 November' }, context.runtime);
    await executeTool('save_cover_message', { email: 'Hello Alex', whatsapp: 'Hi Alex' }, context.runtime);
    const stored = context.store.getPack(context.pack.id);
    assert.equal(stored.notes.length, 1);
    assert.equal(stored.coverMessage?.whatsapp, 'Hi Alex');
    context.store.close();
  });

  it('reports an unknown tool instead of crashing', async () => {
    const context = await runtime();
    const outcome = await executeTool('delete_everything', {}, context.runtime);
    assert.equal(outcome.ok, false);
    context.store.close();
  });
});

describe('agent loop', () => {
  it('runs tools then answers, and logs the run', async () => {
    const context = await runtime();
    const { fetchImpl, calls } = scriptedFetch([
      toolCall('set_fields', { fields: { 'landlord.full_name': 'Priya Raman' } }, 'call_a'),
      toolCall('check_compliance', {}, 'call_b'),
      textReply('I recorded the landlord. Please give me the property address.'),
    ]);

    const events: AgentEvent[] = [];
    const client = new DeepSeekClient({ apiKey: 'k', model: 'deepseek-chat', fetchImpl });

    const result = await runAgent({
      client,
      runtime: context.runtime,
      userMessage: 'The landlord is Priya Raman',
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.text, 'I recorded the landlord. Please give me the property address.');
    assert.deepEqual(result.steps.map((step) => step.tool), ['set_fields', 'check_compliance']);
    assert.equal(result.steps.every((step) => step.ok), true);
    assert.equal(calls().length, 3);
    assert.equal(result.usage.promptTokens, 300);

    assert.equal(context.store.getPack(context.pack.id).fields['landlord.full_name'], 'Priya Raman');
    assert.equal(context.store.listRuns(context.pack.id).length, 1);

    const types = events.map((event) => event.type);
    assert.ok(types.includes('start'));
    assert.ok(types.includes('tool'));
    assert.ok(types.includes('tool_result'));
    assert.ok(types.includes('done'));
  });

  it('feeds a tool error back to the model instead of failing outright', async () => {
    const context = await runtime();
    const { fetchImpl, calls } = scriptedFetch([
      toolCall('set_fields', { fields: 'not-an-object' }, 'call_a'),
      textReply('Sorry, let me try again.'),
    ]);

    const client = new DeepSeekClient({ apiKey: 'k', model: 'deepseek-chat', fetchImpl });
    const result = await runAgent({ client, runtime: context.runtime, userMessage: 'go' });

    assert.equal(result.text, 'Sorry, let me try again.');
    assert.equal(result.steps[0]?.ok, false);
    assert.equal(calls().length, 2);
    // The failure was reported back as a tool message.
    const secondCall = calls()[1] as { messages: Array<{ role: string }> };
    assert.ok(secondCall.messages.some((message) => message.role === 'tool'));
    context.store.close();
  });

  it('survives malformed JSON arguments', async () => {
    const context = await runtime();
    const bad = {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: 'x', type: 'function', function: { name: 'get_pack', arguments: '{not json' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: {},
    };
    const { fetchImpl } = scriptedFetch([bad, textReply('recovered')]);
    const client = new DeepSeekClient({ apiKey: 'k', model: 'deepseek-chat', fetchImpl });

    const result = await runAgent({ client, runtime: context.runtime, userMessage: 'go' });
    assert.equal(result.text, 'recovered');
    assert.equal(result.steps[0]?.ok, false);
    context.store.close();
  });

  it('stops when the model will not stop calling the same tool', async () => {
    const context = await runtime();
    const same = toolCall('get_pack', {}, 'call_a');
    const { fetchImpl } = scriptedFetch(Array.from({ length: 12 }, () => ({ ...same, choices: [{ ...same.choices[0], message: { ...same.choices[0]!.message, tool_calls: [{ ...same.choices[0]!.message.tool_calls![0], id: `id-${Math.random()}` }] } }] })));

    const client = new DeepSeekClient({ apiKey: 'k', model: 'deepseek-chat', fetchImpl });
    const result = await runAgent({ client, runtime: context.runtime, userMessage: 'go', maxSteps: 10 });

    assert.match(result.text, /circles|Done/);
    assert.ok(result.steps.length < 40);
    context.store.close();
  });

  it('gives a usable fallback when the model returns nothing', async () => {
    const context = await runtime();
    const { fetchImpl } = scriptedFetch([textReply('')]);
    const client = new DeepSeekClient({ apiKey: 'k', model: 'deepseek-chat', fetchImpl });
    const result = await runAgent({ client, runtime: context.runtime, userMessage: 'go' });
    assert.ok(result.text.length > 0);
    context.store.close();
  });
});

describe('system prompt', () => {
  it('carries the rules that matter and the field catalogue', () => {
    const prompt = buildSystemPrompt({
      today: new Date(2026, 9, 19),
      packReference: 'TD-2026-0001',
      fields: {},
      templateList: [{ id: 'test-agreement', title: 'Agreement', category: 'tenancy', required: [] }],
    });

    assert.match(prompt, /2026-10-19/);
    assert.match(prompt, /TD-2026-0001/);
    assert.match(prompt, /Never invent a fact/);
    assert.match(prompt, /Never write or reword clauses/);
    assert.match(prompt, /section 21 are gone|section 21/);
    assert.match(prompt, /tenancy\.rent_amount/);
    assert.match(prompt, /test-agreement/);
  });
});
