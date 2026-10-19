/**
 * The web application: a small JSON API plus the single-page interface.
 *
 * Every endpoint is deliberately thin — the interesting logic lives in
 * `docs/` (templates and rules) and `agent/` (the assistant).
 */

import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { AppConfig } from './config.ts';
import { Store, type Pack, type PackStatus } from './db.ts';
import { ENV_DEFAULTS, FIELDS, GROUPS, CORE_FIELDS } from './docs/fields.ts';
import { mergeFields } from './docs/fields.ts';
import { runComplianceChecks } from './docs/compliance.ts';
import { generateDocuments } from './docs/generate.ts';
import { assessPack, renderTemplate, type TemplateRegistry } from './docs/registry.ts';
import { RULES_REVIEWED_ON, searchRules } from './knowledge/rules.ts';
import { DeepSeekClient } from './agent/deepseek.ts';
import { runAgent, type AgentEvent } from './agent/loop.ts';
import { EXAMPLE_PROMPTS } from './agent/prompts.ts';
import { createZip } from './util/zip.ts';
import { buildPackSummaryText, packSummaryView } from './docs/packSummary.ts';

export type AppDeps = {
  config: AppConfig;
  store: Store;
  registry: TemplateRegistry;
  /** Injected in tests so the streaming assistant can be exercised without a key. */
  client?: DeepSeekClient;
};

const STATUSES: readonly PackStatus[] = ['draft', 'ready', 'generated', 'sent'];

/** Agency details from .env, used to pre-fill packs. */
export function agencyFallback(config: AppConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const agency = {
    'agent.company_name': config.agency.name,
    'agent.email': config.agency.email,
    'agent.phone': config.agency.phone,
    'agent.address': config.agency.address,
    'agent.client_money_scheme': config.agency.clientMoneyScheme,
    'agent.redress_scheme': config.agency.redressScheme,
  };
  for (const [key, value] of Object.entries(agency)) {
    if (value !== '') out[key] = value;
  }
  return out;
}

function notFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({ error: message });
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: message });
}

function attachmentHeader(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90);
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, store, registry } = deps;

  const app = Fastify({
    logger: process.env['NODE_ENV'] === 'production' ? { level: 'info' } : false,
    bodyLimit: 2 * 1024 * 1024,
  });

  const client =
    deps.client ??
    new DeepSeekClient({
      apiKey: config.deepseekApiKey,
      model: config.deepseekModel,
      baseUrl: config.deepseekBaseUrl,
    });

  const agency = agencyFallback(config);
  const assistantAvailable = !config.offlineMode && client.configured;

  /** Everything the interface needs for one pack, in one response. */
  const packDetail = (pack: Pack) => ({
    pack,
    readiness: assessPack(pack.fields),
    documents: store.listDocuments(pack.id),
    templates: registry.list(pack.fields),
    suggested: registry.suggestSelection(pack.fields),
  });

  await app.register(fastifyStatic, {
    root: resolve(config.publicDir),
    prefix: '/',
    index: 'index.html',
  });

  app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    app.log.error(error);
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    void reply.code(status).send({ error: error.message });
  });

  // --- meta ---------------------------------------------------------------

  app.get('/api/health', async () => ({
    ok: true,
    store: store.stats(),
    templates: registry.size,
    templateWarnings: registry.warnings,
    assistantAvailable,
    model: config.deepseekModel,
    offlineMode: config.offlineMode,
  }));

  app.get('/api/config', async () => ({
    agency: {
      name: config.agency.name,
      email: config.agency.email,
      phone: config.agency.phone,
      address: config.agency.address,
      clientMoneyScheme: config.agency.clientMoneyScheme,
      redressScheme: config.agency.redressScheme,
    },
    assistantAvailable,
    model: config.deepseekModel,
    offlineMode: config.offlineMode,
    rulesReviewedOn: RULES_REVIEWED_ON,
    templateWarnings: registry.warnings,
    examplePrompts: EXAMPLE_PROMPTS,
    coreFields: CORE_FIELDS,
  }));

  app.get('/api/fields', async () => ({
    groups: GROUPS,
    fields: FIELDS,
    envDefaults: ENV_DEFAULTS,
  }));

  app.get('/api/templates', async () => ({
    templates: registry.list(),
    warnings: registry.warnings,
  }));

  app.get('/api/rules', async (request) => {
    const query = typeof (request.query as Record<string, unknown>)['q'] === 'string'
      ? String((request.query as Record<string, unknown>)['q'])
      : '';
    return { rules: searchRules(query), reviewedOn: RULES_REVIEWED_ON };
  });

  // --- packs --------------------------------------------------------------

  app.get('/api/packs', async () => ({
    packs: store.listPacks().map((pack) => packSummaryView(pack, store)),
  }));

  app.post('/api/packs', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const rawFields = typeof body['fields'] === 'object' && body['fields'] !== null
      ? (body['fields'] as Record<string, unknown>)
      : {};

    const seeded: Record<string, unknown> = { ...agency, ...mergeFields({}, rawFields).merged };
    const pack = store.createPack(seeded);
    return reply.code(201).send(packDetail(pack));
  });

  app.get('/api/packs/:id', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');
    return packDetail(pack);
  });

  app.patch('/api/packs/:id', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');

    const body = (request.body ?? {}) as Record<string, unknown>;
    const rawFields = typeof body['fields'] === 'object' && body['fields'] !== null
      ? (body['fields'] as Record<string, unknown>)
      : undefined;

    let fields = pack.fields;
    if (rawFields !== undefined) {
      fields = mergeFields(pack.fields, rawFields).merged;
    }

    let status = pack.status;
    const requestedStatus = body['status'];
    if (typeof requestedStatus === 'string' && (STATUSES as readonly string[]).includes(requestedStatus)) {
      status = requestedStatus as PackStatus;
    }

    const updated = store.updatePack(pack.id, { fields, status });
    return packDetail(updated);
  });

  app.delete('/api/packs/:id', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');
    store.deletePack(pack.id);
    return reply.code(204).send();
  });

  app.post('/api/packs/:id/notes', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');

    const body = (request.body ?? {}) as Record<string, unknown>;
    const text = typeof body['text'] === 'string' ? body['text'].trim() : '';
    if (text === '') return badRequest(reply, 'Write something first.');

    const notes = [...pack.notes, { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() }];
    return store.updatePack(pack.id, { notes });
  });

  app.delete('/api/packs/:id/notes/:noteId', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');

    const noteId = (request.params as Record<string, string>)['noteId'];
    const notes = pack.notes.filter((note) => note.id !== noteId);
    return store.updatePack(pack.id, { notes });
  });

  app.post('/api/packs/:id/checks', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');
    return runComplianceChecks(pack.fields);
  });

  // --- documents ----------------------------------------------------------

  app.post('/api/packs/:id/preview', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');

    const body = (request.body ?? {}) as Record<string, unknown>;
    const templateId = typeof body['templateId'] === 'string' ? body['templateId'] : '';
    if (templateId === '' || !registry.has(templateId)) return badRequest(reply, 'Unknown document.');

    const template = registry.get(templateId);
    const rendered = renderTemplate(template, { fields: pack.fields, fallbackFields: agency });
    const { renderHtml } = await import('./docs/toHtml.ts');
    const html = renderHtml(rendered.blocks, {
      title: template.title,
      subtitle: `Reference ${pack.reference}`,
      footerText: config.agency.name,
      embedded: true,
    });

    return { html, missing: rendered.missing, title: template.title };
  });

  app.post('/api/packs/:id/generate', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');

    const body = (request.body ?? {}) as Record<string, unknown>;
    const raw = body['templateIds'];
    let templateIds: string[] | undefined;
    if (Array.isArray(raw) && raw.length > 0) {
      templateIds = raw.filter((id): id is string => typeof id === 'string');
      const unknown = templateIds.filter((id) => !registry.has(id));
      if (unknown.length > 0) return badRequest(reply, `Unknown document(s): ${unknown.join(', ')}`);
    }

    const generated = await generateDocuments({
      store,
      registry,
      packId: pack.id,
      fields: pack.fields,
      ...(templateIds === undefined ? {} : { templateIds }),
      fallbackFields: agency,
    });

    return { documents: generated, pack: packDetail(store.getPack(pack.id)) };
  });

  app.get('/api/documents/:id/download', async (request, reply) => {
    const id = (request.params as Record<string, string>)['id'] ?? '';
    const document = store.getDocument(id);
    if (document === null) return notFound(reply, 'That document is no longer available.');

    const query = request.query as Record<string, unknown>;
    const format = typeof query['format'] === 'string' ? query['format'] : 'docx';
    const relativePath =
      format === 'html' ? document.htmlPath : format === 'md' ? document.mdPath : document.docxPath;
    if (relativePath === null) return notFound(reply, `No ${format} version of that document.`);

    const absolute = resolve(config.dataDir, relativePath);
    if (!absolute.startsWith(resolve(config.dataDir))) return badRequest(reply, 'Invalid path.');

    let data: Buffer;
    try {
      data = await readFile(absolute);
    } catch {
      return notFound(reply, 'The generated file has been removed from disk. Generate it again.');
    }

    const extension = format === 'html' ? 'html' : format === 'md' ? 'md' : 'docx';
    const contentType =
      extension === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : extension === 'html'
          ? 'text/html; charset=utf-8'
          : 'text/markdown; charset=utf-8';

    const pack = store.findPack(document.packId);
    const filename = safeFilename(`${pack?.reference ?? 'pack'} - ${document.title}.${extension}`);

    // `inline=1` opens in the browser instead of downloading — that is how the
    // "Print / PDF" button reaches the print dialog.
    const disposition =
      query['inline'] === '1' || query['inline'] === 'true'
        ? `inline; filename*=UTF-8''${encodeURIComponent(filename)}`
        : attachmentHeader(filename);

    return reply
      .code(200)
      .header('Content-Type', contentType)
      .header('Content-Disposition', disposition)
      .send(data);
  });

  app.get('/api/packs/:id/bundle.zip', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');

    const documents = store.listDocuments(pack.id);
    if (documents.length === 0) return badRequest(reply, 'Generate some documents first, then download them together.');

    const entries: Array<{ name: string; data: Buffer | string }> = [
      { name: '00 - Pack summary.txt', data: buildPackSummaryText(pack, store, registry, config) },
    ];

    for (const document of documents) {
      if (document.docxPath === null) continue;
      const absolute = resolve(config.dataDir, document.docxPath);
      if (!absolute.startsWith(resolve(config.dataDir))) continue;
      try {
        entries.push({
          name: safeFilename(`${pack.reference} - ${document.title}.docx`),
          data: await readFile(absolute),
        });
      } catch {
        // Skip a file that has gone missing rather than failing the whole download.
      }
    }

    const zip = createZip(entries);
    const filename = safeFilename(`${pack.reference} - document pack.zip`);
    return reply
      .code(200)
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', attachmentHeader(filename))
      .send(zip);
  });

  app.get('/api/packs/:id/runs', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');
    return { runs: store.listRuns(pack.id) };
  });

  // --- the assistant ------------------------------------------------------

  app.post('/api/packs/:id/assistant', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');

    if (!assistantAvailable) {
      return reply.code(503).send({
        error: config.offlineMode
          ? 'The assistant is switched off (OFFLINE_MODE). You can still fill in details and generate documents by hand.'
          : 'No DeepSeek API key is set. Add DEEPSEEK_API_KEY to your .env file and restart, or use the form to enter details by hand.',
      });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const message = typeof body['message'] === 'string' ? body['message'].trim() : '';
    if (message === '') return badRequest(reply, 'Type a message first.');

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let closed = false;
    raw.on('close', () => {
      closed = true;
    });

    const send = (event: AgentEvent | { type: 'fatal'; message: string }) => {
      if (closed) return;
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await runAgent({
        client,
        runtime: {
          store,
          registry,
          packId: pack.id,
          fallbackFields: agency,
        },
        userMessage: message,
        onEvent: send,
      });
    } catch (error) {
      send({ type: 'fatal', message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (!closed) raw.end();
    }
  });

  return app;
}

function paramId(request: FastifyRequest): string {
  return (request.params as Record<string, string>)['id'] ?? '';
}

export type { FastifyInstance };
