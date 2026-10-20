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
import { Store, type Lifecycle, type Pack, type PackLinks, type PackStatus } from './db.ts';
import { LIFECYCLES } from './backoffice/entities.ts';
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
import { BackOffice } from './backoffice/entities.ts';
import { contextFor, effectiveFields } from './backoffice/context.ts';
import { applyMigration, previewMigration } from './backoffice/migrate.ts';

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

  // The back office shares the same SQLite file and connection as the packs.
  const backOffice = new BackOffice(store.handle);

  /**
   * Agency details for a pack: settings saved in the app win, then `.env`.
   * Read on every request so a change in Settings takes effect immediately.
   */
  const currentAgency = (): Record<string, unknown> => {
    const saved = backOffice.getSettings();
    const fromSettings: Record<string, unknown> = {};
    const mapping: Array<[string, string]> = [
      ['agent.company_name', saved.name],
      ['agent.email', saved.email],
      ['agent.phone', saved.phone],
      ['agent.address', saved.address],
      ['agent.client_money_scheme', saved.clientMoneyScheme],
      ['agent.redress_scheme', saved.redressScheme],
      ['agent.name', saved.negotiator],
    ];
    for (const [key, value] of mapping) {
      if (value.trim() !== '') fromSettings[key] = value;
    }
    return { ...agencyFallback(config), ...fromSettings };
  };

  const assistantAvailable = !config.offlineMode && client.configured;

  /** The merged details for a pack: its own values over what it inherits. */
  const effectiveFor = (pack: Pack): Record<string, unknown> => ({
    ...currentAgency(),
    ...effectiveFields(pack, backOffice),
  });

  /** Everything the interface needs for one pack, in one response. */
  const packDetail = (pack: Pack) => {
    const context = contextFor(pack, backOffice);
    const fields = { ...currentAgency(), ...context.resolved.values };
    const readiness = assessPack(fields);
    return {
      pack,
      fields,
      provenance: context.resolved.provenance,
      overrides: context.resolved.overrides,
      readiness: { ...readiness, ready: context.resolved.missing.length === 0, missingCore: context.resolved.missing },
      documents: store.listDocuments(pack.id),
      templates: registry.list(fields),
      suggested: registry.suggestSelection(fields),
      links: {
        landlord: pack.landlordId === null ? null : backOffice.getLandlord(pack.landlordId),
        property: pack.propertyId === null ? null : backOffice.getProperty(pack.propertyId),
        room: pack.roomId === null ? null : backOffice.getRoom(pack.roomId),
        tenant: pack.tenantId === null ? null : backOffice.getTenant(pack.tenantId),
      },
    };
  };

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
    settings: backOffice.getSettings(),
    backOffice: backOffice.stats(),
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

  // --- back office --------------------------------------------------------

  app.get('/api/settings', async () => backOffice.getSettings());

  app.put('/api/settings', async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const pick = (key: string): string | undefined =>
      typeof body[key] === 'string' ? (body[key] as string).trim() : undefined;

    return backOffice.saveSettings({
      ...(pick('name') === undefined ? {} : { name: pick('name') as string }),
      ...(pick('address') === undefined ? {} : { address: pick('address') as string }),
      ...(pick('phone') === undefined ? {} : { phone: pick('phone') as string }),
      ...(pick('email') === undefined ? {} : { email: pick('email') as string }),
      ...(pick('clientMoneyScheme') === undefined ? {} : { clientMoneyScheme: pick('clientMoneyScheme') as string }),
      ...(pick('redressScheme') === undefined ? {} : { redressScheme: pick('redressScheme') as string }),
      ...(pick('negotiator') === undefined ? {} : { negotiator: pick('negotiator') as string }),
      ...(pick('rentAccount') === undefined ? {} : { rentAccount: pick('rentAccount') as string }),
    });
  });

  /** Everything the back-office screens need, in one response. */
  app.get('/api/backoffice', async () => {
    const properties = backOffice.listProperties();
    const rooms = backOffice.roomSummary();
    const tenancies = store.listPacks();

    return {
      settings: backOffice.getSettings(),
      stats: backOffice.stats(),
      landlords: backOffice.listLandlords().map((landlord) => ({
        ...landlord,
        propertyCount: properties.filter((property) => property.landlordId === landlord.id).length,
      })),
      properties: properties.map((property) => ({
        ...property,
        landlord: property.landlordId === null ? null : backOffice.getLandlord(property.landlordId),
        rooms: rooms.filter((room) => room.propertyId === property.id),
      })),
      tenants: backOffice.listTenants().map((tenant) => ({
        ...tenant,
        tenancyCount: tenancies.filter((pack) => pack.tenantId === tenant.id).length,
      })),
      unlinked: tenancies
        .filter((pack) => pack.propertyId === null)
        .map((pack) => ({ id: pack.id, reference: pack.reference, tenantName: pack.tenantName })),
    };
  });

  /** Create or update a back-office record. */
  const recordRoutes = (kind: 'landlords' | 'properties' | 'rooms' | 'tenants') => {
    app.post(`/api/backoffice/${kind}`, async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      try {
        const created =
          kind === 'landlords'
            ? backOffice.createLandlord(body)
            : kind === 'properties'
              ? backOffice.createProperty(body)
              : kind === 'rooms'
                ? backOffice.createRoom(body as { propertyId: string })
                : backOffice.createTenant(body);
        return reply.code(201).send(created);
      } catch (error) {
        return badRequest(reply, error instanceof Error ? error.message : String(error));
      }
    });

    app.patch(`/api/backoffice/${kind}/:id`, async (request, reply) => {
      const id = (request.params as Record<string, string>)['id'] ?? '';
      const body = (request.body ?? {}) as Record<string, unknown>;
      try {
        const updated =
          kind === 'landlords'
            ? backOffice.updateLandlord(id, body)
            : kind === 'properties'
              ? backOffice.updateProperty(id, body)
              : kind === 'rooms'
                ? backOffice.updateRoom(id, body)
                : backOffice.updateTenant(id, body);
        return updated;
      } catch (error) {
        return notFound(reply, error instanceof Error ? error.message : String(error));
      }
    });

    app.delete(`/api/backoffice/${kind}/:id`, async (request, reply) => {
      const id = (request.params as Record<string, string>)['id'] ?? '';
      const column = kind === 'landlords' ? 'landlord_id' : kind === 'properties' ? 'property_id' : kind === 'rooms' ? 'room_id' : 'tenant_id';
      const inUse = store.tenanciesUsing(column, id);
      if (inUse.length > 0 && (request.query as Record<string, unknown>)['force'] !== '1') {
        return reply.code(409).send({
          error: `${inUse.length} tenancy${inUse.length === 1 ? '' : 'ies'} still use this. They will keep their own details but stop inheriting.`,
          tenancies: inUse.map((pack) => ({ id: pack.id, reference: pack.reference })),
        });
      }
      if (kind === 'landlords') backOffice.deleteLandlord(id);
      else if (kind === 'properties') backOffice.deleteProperty(id);
      else if (kind === 'rooms') backOffice.deleteRoom(id);
      else backOffice.deleteTenant(id);
      return reply.code(204).send();
    });
  };

  recordRoutes('landlords');
  recordRoutes('properties');
  recordRoutes('rooms');
  recordRoutes('tenants');

  /** What the migration would create, without writing anything. */
  app.post('/api/backoffice/migrate/preview', async () => previewMigration(store.listPacks()));

  /** Write it. The client confirms first. */
  app.post('/api/backoffice/migrate/apply', async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const plan = previewMigration(store.listPacks());
    if (body['confirm'] !== true) {
      return { applied: false, plan };
    }
    return { applied: true, result: applyMigration(plan, backOffice, store), plan };
  });

  // --- packs --------------------------------------------------------------

  app.get('/api/packs', async () => ({
    packs: store.listPacks().map((pack) => packSummaryView(pack, store, effectiveFor(pack))),
  }));

  app.post('/api/packs', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const rawFields = typeof body['fields'] === 'object' && body['fields'] !== null
      ? (body['fields'] as Record<string, unknown>)
      : {};

    // Do not copy the agency's details into the pack: they are inherited from
    // Settings, so changing them later must not leave stale copies behind.
    const seeded: Record<string, unknown> = mergeFields({}, rawFields).merged;
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

    // Lifecycle and links to the back-office records.
    const links: Partial<PackLinks> = {};
    const requestedLifecycle = body['lifecycle'];
    if (typeof requestedLifecycle === 'string' && (LIFECYCLES as readonly string[]).includes(requestedLifecycle)) {
      links.lifecycle = requestedLifecycle as Lifecycle;
    }
    for (const [key, column] of [
      ['landlordId', 'landlordId'],
      ['propertyId', 'propertyId'],
      ['roomId', 'roomId'],
      ['tenantId', 'tenantId'],
    ] as const) {
      const value = body[key];
      if (value === null) links[column] = null;
      else if (typeof value === 'string' && value !== '') links[column] = value;
    }

    const linked = Object.keys(links).length > 0 ? store.linkPack(updated.id, links) : updated;
    return packDetail(linked);
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
    return runComplianceChecks(effectiveFor(pack));
  });

  // --- documents ----------------------------------------------------------

  app.post('/api/packs/:id/preview', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');

    const body = (request.body ?? {}) as Record<string, unknown>;
    const templateId = typeof body['templateId'] === 'string' ? body['templateId'] : '';
    if (templateId === '' || !registry.has(templateId)) return badRequest(reply, 'Unknown document.');

    const template = registry.get(templateId);
    const rendered = renderTemplate(template, { fields: effectiveFor(pack), fallbackFields: currentAgency() });
    const { renderHtml } = await import('./docs/toHtml.ts');
    const html = renderHtml(rendered.blocks, {
      title: template.title,
      subtitle: `Reference ${pack.reference}`,
      footerText: String(currentAgency()['agent.company_name'] ?? ''),
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
      fields: effectiveFor(pack),
      ...(templateIds === undefined ? {} : { templateIds }),
      fallbackFields: currentAgency(),
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
      { name: '00 - Pack summary.txt', data: buildPackSummaryText(pack, store, registry, config, effectiveFor(pack)) },
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
          fallbackFields: currentAgency(),
          effective: (packId: string) => effectiveFor(store.getPack(packId)),
          provenance: (packId: string) => contextFor(store.getPack(packId), backOffice).resolved.provenance,
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
