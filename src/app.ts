/**
 * The web application: a small JSON API plus the single-page interface.
 *
 * Every endpoint is deliberately thin — the interesting logic lives in
 * `docs/` (templates and rules) and `agent/` (the assistant).
 */

import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { readFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { AppConfig } from './config.ts';
import { Store, tenantNameFrom, type Lifecycle, type Pack, type PackLinks, type PackStatus } from './db.ts';
import { LIFECYCLES } from './backoffice/entities.ts';
import { ENV_DEFAULTS, FIELDS, GROUPS, CORE_FIELDS } from './docs/fields.ts';
import { mergeFields } from './docs/fields.ts';
import { runComplianceChecks } from './docs/compliance.ts';
import { REVIEW_MODES, reviewGate, type ReviewMode } from './docs/gate.ts';
import { generateDocuments } from './docs/generate.ts';
import { assessPack, renderTemplate, type TemplateRegistry } from './docs/registry.ts';
import { RULES_REVIEWED_ON, ruleById, searchRules } from './knowledge/rules.ts';
import { DeepSeekClient } from './agent/deepseek.ts';
import { runAgent, type AgentEvent } from './agent/loop.ts';
import { EXAMPLE_PROMPTS } from './agent/prompts.ts';
import { rankGuides } from './agent/guides.ts';
import { createZip } from './util/zip.ts';
import { buildPackSummaryText, packSummaryView } from './docs/packSummary.ts';
import { BackOffice } from './backoffice/entities.ts';
import { contextFor, effectiveFields } from './backoffice/context.ts';
import { applyMigration, previewMigration } from './backoffice/migrate.ts';
import { aggregateDue } from './backoffice/due.ts';
import { buildBackup, healthOf } from './backoffice/backup.ts';
import { renderTimelineHtml, sortTimeline } from './docs/timeline.ts';
import { buildCalendar } from './util/ics.ts';
import { CustomTemplateStore } from './backoffice/customTemplates.ts';
import { AuthStore } from './auth/store.ts';
import { currentUser, isLandlord, registerAuthGuard, requireUser } from './auth/guard.ts';
import { registerAuthRoutes } from './auth/routes.ts';
import { FeedbackStore } from './feedback/store.ts';
import { registerFeedbackRoutes } from './feedback/routes.ts';
import { buildReplacements, extractDocxText, fillDocx, fillDocxBlanks, formatLike, resolveFieldPath } from './docs/docxFill.ts';
import { proposeLinks } from './docs/linkProposal.ts';
import { auditDocumentText } from './docs/templateAudit.ts';
import { getField } from './docs/fields.ts';
import { formatDateStyle } from './docs/template.ts';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

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

/** Present a detail the way its type deserves: money in pounds, dates in words. */
function formatForField(key: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  const def = getField(key);
  if (def?.type === 'money') return formatLike('£1', value);
  if (def?.type === 'date') return formatDateStyle(value, 'long');
  return String(value);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
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
    bodyLimit: 16 * 1024 * 1024, // room for a base64 .docx upload
    // Behind Caddy every connection comes from 127.0.0.1: without this, the
    // session record and the audit trail would all say "the proxy".
    trustProxy: '127.0.0.1',
  });

  const client =
    deps.client ??
    new DeepSeekClient({
      apiKey: config.deepseekApiKey,
      model: config.deepseekModel,
      baseUrl: config.deepseekBaseUrl,
    });

  /**
   * An empty body is not a broken body. Plenty of clients set
   * `Content-Type: application/json` on every request, including a DELETE that
   * carries nothing — Fastify's default parser rejects those with "Body cannot
   * be empty when content-type is set to 'application/json'", which turns
   * deleting a tenancy into an error the agent cannot do anything about.
   */
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (text === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text) as unknown);
    } catch (error) {
      done(error as Error);
    }
  });

  // The back office shares the same SQLite file and connection as the packs.
  const backOffice = new BackOffice(store.handle);
  const customTemplates = new CustomTemplateStore(store.handle, config.dataDir);

  // Who may do what. Registered before any route, so every route below is behind
  // the guard: a request without a session is refused before it is handled.
  const auth = new AuthStore(store.handle, config.operatorEmails);
  auth.purgeExpiredSessions();
  // Who owns the product, from OPERATOR_EMAILS: they alone read the feedback queue.
  auth.syncOperators(config.operatorEmails);
  const promoted = auth.ensureOperator();
  if (promoted !== null) {
    auth.record({ kind: 'operator.assigned', detail: `${promoted} reads the feedback queue (no operator was named)` });
  }
  const feedback = new FeedbackStore(store.handle);
  registerAuthGuard(app, { auth, store });
  registerAuthRoutes(app, { auth, backOffice });
  registerFeedbackRoutes(app, {
    feedback,
    client,
    assistantAvailable: !config.offlineMode && client.configured,
  });

  /** Record something for the person making this request. */
  const note = (request: FastifyRequest, kind: string, detail: string, packId: string | null = null) => {
    auth.record({ packId, actor: currentUser(request), kind, detail });
  };

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
    const documents = store.listDocuments(pack.id);
    return {
      pack,
      fields,
      provenance: context.resolved.provenance,
      overrides: context.resolved.overrides,
      readiness: { ...readiness, ready: context.resolved.missing.length === 0, missingCore: context.resolved.missing },
      documents,
      templates: registry.list(fields),
      suggested: registry.suggestSelection(fields),
      timeline: sortTimeline([
        { at: pack.createdAt, kind: 'created', title: 'Pack opened', detail: pack.reference },
        ...documents.map((document) => ({
          at: document.generatedAt,
          kind: 'document' as const,
          title: document.title,
          detail: 'Generated',
        })),
        ...pack.notes.map((note) => ({
          at: note.createdAt,
          kind: 'note' as const,
          title: 'Note added',
          detail: note.text,
        })),
        ...store.listRuns(pack.id, 60).map((run) => ({
          at: run.createdAt,
          kind: 'assistant' as const,
          title: 'Assistant run',
          detail: run.summary,
        })),
        ...(pack.coverMessage === null
          ? []
          : [
              {
                at: pack.coverMessage.createdAt,
                kind: 'message' as const,
                title: 'Message to the tenant saved',
                detail: '',
              },
            ]),
      ]),
      links: {
        landlord: pack.landlordId === null ? null : backOffice.getLandlord(pack.landlordId),
        property: pack.propertyId === null ? null : backOffice.getProperty(pack.propertyId),
        room: pack.roomId === null ? null : backOffice.getRoom(pack.roomId),
        tenant: pack.tenantId === null ? null : backOffice.getTenant(pack.tenantId),
      },
      /** Who touched this pack, and what they did — the History tab's "who". */
      events: auth.eventsForPack(pack.id, 200),
      creator: (() => {
        const created = auth.packCreator(pack.id);
        return created === null ? null : { name: created.actorName, at: created.at };
      })(),
    };
  };

  await app.register(fastifyStatic, {
    root: resolve(config.publicDir),
    prefix: '/',
    index: 'index.html',
    /**
     * The interface is served from disk with no build step, so a deploy is only live
     * once the browser has the new files. Asking it to revalidate every time costs a
     * 304 per asset and removes a whole class of "the button is not there" — which is
     * exactly how a shipped feature once looked like a missing one.
     */
    setHeaders: (response, path) => {
      if (/\.(?:html|js|css)$/i.test(path)) {
        response.header('Cache-Control', 'no-cache, must-revalidate');
      }
    },
  });

  /**
   * No API response is cacheable.
   *
   * Identity and data both change, and a page that keeps its own copy of "who am I"
   * can end up showing buttons for a person who is no longer signed in — which is
   * exactly how a working feature was once reported as broken.
   */
  app.addHook('onSend', async (request, reply, payload) => {
    if ((request.url ?? '').startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
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
    backOffice: backOffice.stats(),
    uploads: customTemplates.list().length,
    templates: registry.size,
    templateWarnings: registry.warnings,
    assistantAvailable,
    model: config.deepseekModel,
    offlineMode: config.offlineMode,
    node: process.versions.node,
    disk: await healthOf(store.handle, config.dataDir),
  }));

  /** One zip with the database, every document, and every upload. */
  app.get('/api/backup', async (_request, reply) => {
    const backup = await buildBackup(store.handle, config.dataDir);
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .code(200)
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', attachmentHeader(`tenancydesk-backup-${stamp}.zip`))
      .send(backup.buffer);
  });

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

  /** One rule, so a finding can explain itself when asked. */
  app.get('/api/rules/:id', async (request, reply) => {
    const rule = ruleById((request.params as Record<string, string>)['id'] ?? '');
    if (rule === null) return notFound(reply, 'No rule with that id.');
    return { rule, reviewedOn: RULES_REVIEWED_ON };
  });

  // --- back office --------------------------------------------------------

  app.get('/api/settings', async () => backOffice.getSettings());

  app.put('/api/settings', async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const pick = (key: string): string | undefined =>
      typeof body[key] === 'string' ? (body[key] as string).trim() : undefined;

    const saved = backOffice.saveSettings({
      ...(pick('name') === undefined ? {} : { name: pick('name') as string }),
      ...(pick('address') === undefined ? {} : { address: pick('address') as string }),
      ...(pick('phone') === undefined ? {} : { phone: pick('phone') as string }),
      ...(pick('email') === undefined ? {} : { email: pick('email') as string }),
      ...(pick('clientMoneyScheme') === undefined ? {} : { clientMoneyScheme: pick('clientMoneyScheme') as string }),
      ...(pick('redressScheme') === undefined ? {} : { redressScheme: pick('redressScheme') as string }),
      ...(pick('negotiator') === undefined ? {} : { negotiator: pick('negotiator') as string }),
      ...(pick('rentAccount') === undefined ? {} : { rentAccount: pick('rentAccount') as string }),
      ...(typeof body['reviewMode'] === 'string' && (REVIEW_MODES as readonly string[]).includes(body['reviewMode'] as string)
        ? { reviewMode: body['reviewMode'] as ReviewMode }
        : {}),
    });
    note(request, 'settings.updated', 'Agency details changed');
    return saved;
  });

  /** Everything the back-office screens need, in one response. */
  app.get('/api/backoffice', async (request) => {
    const viewer = currentUser(request);
    // A landlord gets their own records and nothing else: no other landlords, no
    // other properties, and no tenancy counts that would leak the neighbours.
    const landlordScope = viewer !== null && isLandlord(viewer) ? viewer.landlordId : null;

    const landlordRecords = backOffice
      .listLandlords()
      .filter((landlord) => landlordScope === null || landlord.id === landlordScope);
    const properties = backOffice
      .listProperties()
      .filter((property) => landlordScope === null || property.landlordId === landlordScope);
    const propertyIds = new Set(properties.map((property) => property.id));
    const rooms = backOffice.roomSummary().filter((room) => propertyIds.has(room.propertyId));
    const tenancies = store.listPacks();
    const visibleTenancies =
      landlordScope === null ? tenancies : tenancies.filter((pack) => pack.landlordId === landlordScope);
    const tenantIds = new Set(visibleTenancies.map((pack) => pack.tenantId).filter((id): id is string => id !== null));
    const tenants = backOffice
      .listTenants()
      .filter((tenant) => landlordScope === null || tenantIds.has(tenant.id));

    return {
      settings: backOffice.getSettings(),
      stats: {
        landlords: landlordRecords.length,
        properties: properties.length,
        rooms: rooms.length,
        tenants: tenants.length,
      },
      landlords: landlordRecords.map((landlord) => ({
        ...landlord,
        propertyCount: properties.filter((property) => property.landlordId === landlord.id).length,
      })),
      properties: properties.map((property) => ({
        ...property,
        landlord: property.landlordId === null ? null : backOffice.getLandlord(property.landlordId),
        rooms: rooms.filter((room) => room.propertyId === property.id),
      })),
      tenants: tenants.map((tenant) => ({
        ...tenant,
        tenancyCount: tenancies.filter((pack) => pack.tenantId === tenant.id).length,
      })),
      unlinked: visibleTenancies
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
        note(request, `record.${kind}.created`, String((created as { name?: string; fullName?: string }).name ?? (created as { fullName?: string }).fullName ?? ''));
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
    const result = applyMigration(plan, backOffice, store);
    note(request, 'backoffice.migrated', `Linked ${plan.links.length} tenanc${plan.links.length === 1 ? 'y' : 'ies'} to records`);
    return { applied: true, result, plan };
  });

  // --- the agency's own documents -----------------------------------------

  app.get('/api/custom-templates', async () => ({ templates: customTemplates.list() }));

  /**
   * Accept one of the agency's own `.docx` files.
   *
   * The file arrives base64-encoded in JSON rather than as a multipart upload: it
   * keeps the server free of another dependency, and the browser can send it with
   * the same `fetch` it uses everywhere else.
   */
  app.post('/api/custom-templates', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const data = typeof body['data'] === 'string' ? body['data'] : '';
    if (data === '') return badRequest(reply, 'No file arrived.');

    const bytes = Buffer.from(data, 'base64');
    if (bytes.byteLength === 0) return badRequest(reply, 'That file is empty.');

    let text: string;
    try {
      text = extractDocxText(bytes).text;
    } catch {
      return badRequest(reply, 'That is not a Word file. Upload a .docx — if you only have a PDF, save it as Word first.');
    }

    const audit = auditDocumentText(text);
    const proposal = proposeLinks(text);
    const fileName = typeof body['fileName'] === 'string' ? body['fileName'] : 'document.docx';
    const name =
      typeof body['name'] === 'string' && body['name'].trim() !== ''
        ? body['name'].trim()
        : fileName.replace(/\.docx$/i, '');

    const template = await customTemplates.create({
      name,
      fileName,
      bytes,
      fillMode: proposal.mode,
      blankFields: [],
      links:
        proposal.mode === 'values'
          ? proposal.links.map((link) => ({
              sample: link.sample,
              field: link.field,
              hint: link.hint,
              kind: link.kind,
              confidence: link.confidence,
            }))
          : [],
      audit,
      wordCount: proposal.wordCount,
    });

    note(request, 'upload.added', `${template.name} (${proposal.mode === 'blanks' ? 'blank form' : 'values'})`);
    return reply.code(201).send({ template, proposal });
  });

  app.patch('/api/custom-templates/:id', async (request, reply) => {
    const id = (request.params as Record<string, string>)['id'] ?? '';
    if (customTemplates.get(id) === null) return notFound(reply, 'That document no longer exists.');

    const body = (request.body ?? {}) as Record<string, unknown>;
    const mode = body['fillMode'];
    note(request, 'upload.updated', `Mapping changed for ${customTemplates.get(id)?.name ?? 'a document'}`);
    return customTemplates.update(id, {
      ...(typeof body['name'] === 'string' ? { name: body['name'] } : {}),
      ...(mode === 'values' || mode === 'blanks' ? { fillMode: mode } : {}),
      ...(Array.isArray(body['blankFields'])
        ? { blankFields: body['blankFields'].filter((item): item is string => typeof item === 'string') }
        : {}),
      ...(Array.isArray(body['links'])
        ? {
            links: body['links']
              .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
              .map((item) => ({
                sample: String(item['sample'] ?? ''),
                field: String(item['field'] ?? ''),
                ...(typeof item['hint'] === 'string' ? { hint: item['hint'] } : {}),
              }))
              .filter((link) => link.sample !== ''),
          }
        : {}),
    });
  });

  app.delete('/api/custom-templates/:id', async (request, reply) => {
    const id = (request.params as Record<string, string>)['id'] ?? '';
    if (customTemplates.get(id) === null) return notFound(reply, 'That document no longer exists.');
    const removed = customTemplates.get(id);
    customTemplates.delete(id);
    note(request, 'upload.removed', removed?.name ?? '');
    return reply.code(204).send();
  });

  /** Produce the agency's own document, filled for this tenant. */
  app.post('/api/packs/:id/fill/:templateId', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');

    const templateId = (request.params as Record<string, string>)['templateId'] ?? '';
    const template = customTemplates.get(templateId);
    if (template === null) return notFound(reply, 'That document no longer exists.');

    const fields = effectiveFor(pack);
    const original = await customTemplates.originalFile(template);
    const fileName = `custom-${slugify(template.name) || template.id}.docx`;
    const target = join(store.documentDir(pack.id), fileName);

    let bytes: Buffer;
    let report: { filled: number; remaining: number; notFound: string[] };

    if (template.fillMode === 'blanks') {
      const values = template.blankFields.map((key) => formatForField(key, resolveFieldPath(fields, key)));
      const result = fillDocxBlanks(original, values);
      bytes = result.buffer;
      report = { filled: result.filled, remaining: result.remaining, notFound: [] };
    } else {
      const replacements = buildReplacements(
        fields,
        template.links.map((link) => ({ field: link.field, sample: link.sample, label: link.field })),
      );
      const result = fillDocx(original, replacements);
      bytes = result.buffer;
      report = {
        filled: result.applied.length,
        remaining: 0,
        notFound: result.notFound.map((item) => item.label ?? item.find),
      };
    }

    await writeFile(target, bytes);

    const [saved] = store.addDocuments(pack.id, [
      {
        templateId: `custom:${template.id}`,
        title: template.name,
        docxPath: join('documents', pack.id, fileName).replace(/\\/g, '/'),
        htmlPath: null,
        mdPath: null,
        checksum: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
        byteSize: bytes.byteLength,
        generatedAt: new Date().toISOString(),
      },
    ]);

    return { document: saved, report, pack: packDetail(store.getPack(pack.id)) };
  });

  // --- what is due ---------------------------------------------------------

  app.get('/api/due', async (request) => {
    const report = aggregateDue(store, backOffice);
    const viewer = currentUser(request);
    const items =
      viewer !== null && isLandlord(viewer) && viewer.landlordId !== null
        ? report.items.filter((item) => {
            const pack = store.findPack(item.packId);
            return pack !== null && pack.landlordId === viewer.landlordId;
          })
        : report.items;
    return { ...report, items, generatedAt: new Date().toISOString() };
  });

  /** Every deadline, as a calendar the agency can subscribe to once. */
  app.get('/api/calendar.ics', async (request, reply) => {
    const report = aggregateDue(store, backOffice);
    const viewer = currentUser(request);
    const mine =
      viewer !== null && isLandlord(viewer) && viewer.landlordId !== null
        ? report.items.filter((item) => {
            const pack = store.findPack(item.packId);
            return pack !== null && pack.landlordId === viewer.landlordId;
          })
        : report.items;
    const calendar = buildCalendar(
      mine.map((item) => ({
        uid: `${item.packId}-${item.kind}-${item.date}`,
        date: item.date,
        title: `${item.label} — ${item.tenantName === '' ? item.reference : item.tenantName}`,
        description: `${item.detail} ${item.propertyAddress}`.trim(),
      })),
      { name: 'Tenancy deadlines' },
    );
    return reply
      .code(200)
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="tenancy-deadlines.ics"')
      .send(calendar);
  });

  /** One pack's deadlines. */
  app.get('/api/packs/:id/calendar.ics', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');

    const mine = aggregateDue(store, backOffice).items.filter((item) => item.packId === pack.id);
    const calendar = buildCalendar(
      mine.map((item) => ({
        uid: `${item.packId}-${item.kind}-${item.date}`,
        date: item.date,
        title: item.label,
        description: `${item.detail} ${pack.reference}`.trim(),
      })),
      { name: `${pack.reference} deadlines` },
    );
    return reply
      .code(200)
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${pack.reference}-deadlines.ics"`)
      .send(calendar);
  });

  /**
   * Let several rooms at once.
   *
   * Each entry creates the tenant record, the tenancy, and the links — so four
   * rooms become four independent packs from one form, each with its own tenant
   * and its own documents. They are separate records on purpose: one tenant must
   * never see another's paperwork.
   */
  app.post('/api/packs/bulk', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const rawLets = Array.isArray(body['lets']) ? body['lets'] : [];
    if (rawLets.length === 0) return badRequest(reply, 'Nothing to create — add at least one tenant.');

    const created: Array<{ id: string; reference: string; tenantName: string; roomNumber: string }> = [];
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    for (const raw of rawLets) {
      if (typeof raw !== 'object' || raw === null) continue;
      const let_ = raw as Record<string, unknown>;
      const roomId = typeof let_['roomId'] === 'string' ? let_['roomId'] : '';
      const fullName = typeof let_['tenantName'] === 'string' ? let_['tenantName'].trim() : '';
      if (roomId === '' || fullName === '') continue;

      const room = backOffice.getRoom(roomId);
      if (room === null) continue;
      const property = backOffice.getProperty(room.propertyId);
      if (property === null) continue;

      const email = typeof let_['tenantEmail'] === 'string' ? let_['tenantEmail'].trim() : '';
      const startDate = typeof let_['startDate'] === 'string' && let_['startDate'] !== '' ? let_['startDate'] : todayIso;

      const tenant = backOffice.createTenant({ fullName, email });
      const person: Record<string, unknown> = { full_name: fullName };
      if (email !== '') person['email'] = email;

      const pack = store.createPack({ tenants: [person], 'tenancy.start_date': startDate });
      store.linkPack(pack.id, {
        landlordId: property.landlordId,
        propertyId: property.id,
        roomId: room.id,
        tenantId: tenant.id,
        lifecycle: startDate > todayIso ? 'upcoming' : 'active',
      });

      const linked = store.getPack(pack.id);
      note(request, 'pack.created', `${linked.reference} (bulk let)`, linked.id);
      created.push({
        id: linked.id,
        reference: linked.reference,
        tenantName: fullName,
        roomNumber: room.roomNumber,
      });
    }

    if (created.length === 0) return badRequest(reply, 'Nothing to create — each row needs a room and a tenant name.');
    return reply.code(201).send({ created, packs: created.length });
  });

  /** A one-page, printable history of the tenancy. */
  app.get('/api/packs/:id/timeline.html', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');

    const detail = packDetail(pack);
    const fields = detail.fields as Record<string, unknown>;
    const text = (key: string): string => (typeof fields[key] === 'string' ? (fields[key] as string) : '');
    const money = (key: string): string => {
      const value = fields[key];
      return typeof value === 'number' ? `£${value.toLocaleString('en-GB')}` : '';
    };

    const html = renderTimelineHtml({
      pack,
      events: detail.timeline,
      facts: [
        { label: 'Tenant', value: tenantNameFrom(fields) || pack.tenantName },
        {
          label: 'Property',
          value: [text('property.address_line1'), text('property.postcode')].filter((part) => part !== '').join(', '),
        },
        { label: 'Room', value: text('property.room_number') },
        { label: 'Landlord', value: text('landlord.full_name') },
        { label: 'Tenancy started', value: text('tenancy.start_date') },
        { label: 'Rent', value: money('tenancy.rent_amount') },
        { label: 'Deposit', value: money('tenancy.deposit_amount') },
        { label: 'Deposit scheme', value: text('tenancy.deposit_scheme') },
        { label: 'Status', value: pack.lifecycle },
      ],
      footerText: String(currentAgency()['agent.company_name'] ?? ''),
    });

    return reply.code(200).header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // --- the overview -------------------------------------------------------

  /**
   * One answer to "what is the state of things?" — the first thing the back office
   * should say. Every number here links to the screen that changes it, because a
   * dashboard nobody acts on is decoration.
   */
  app.get('/api/overview', async (request) => {
    const viewer = currentUser(request);
    const landlordScope = viewer !== null && isLandlord(viewer) ? viewer.landlordId : null;

    const allPacks = store.listPacks();
    const packs =
      landlordScope === null ? allPacks : allPacks.filter((pack) => pack.landlordId === landlordScope);

    const lifecycle: Record<string, number> = { upcoming: 0, active: 0, ending: 0, ended: 0 };
    let documents = 0;
    let withoutDocuments = 0;
    let withoutProperty = 0;
    for (const pack of packs) {
      lifecycle[pack.lifecycle] = (lifecycle[pack.lifecycle] ?? 0) + 1;
      const produced = store.listDocuments(pack.id).length;
      documents += produced;
      if (produced === 0) withoutDocuments += 1;
      if (pack.propertyId === null) withoutProperty += 1;
    }

    const due = aggregateDue(store, backOffice);
    const dueItems =
      landlordScope === null
        ? due.items
        : due.items.filter((item) => {
            const pack = store.findPack(item.packId);
            return pack !== null && pack.landlordId === landlordScope;
          });

    const properties = backOffice.listProperties();
    const visibleProperties =
      landlordScope === null
        ? properties
        : properties.filter((property) => property.landlordId === landlordScope);

    const users = auth.listUsers();
    const uploads = customTemplates.list().length;
    const storage = await healthOf(store.handle, config.dataDir);
    const lastBackup = latestBackupAge(config.backupDir);

    return {
      tenancies: {
        total: packs.length,
        lifecycle,
        documents,
        withoutDocuments,
        withoutProperty,
      },
      records: {
        landlords:
          landlordScope === null
            ? backOffice.listLandlords().length
            : backOffice.listLandlords().filter((landlord) => landlord.id === landlordScope).length,
        properties: visibleProperties.length,
        rooms: landlordScope === null ? backOffice.listRooms().length : backOffice.listRooms().filter((room) => visibleProperties.some((property) => property.id === room.propertyId)).length,
        tenants: backOffice.listTenants().length,
        uploads,
      },
      people: {
        total: users.length,
        owners: users.filter((user) => user.role === 'owner').length,
        agents: users.filter((user) => user.role === 'agent').length,
        landlords: users.filter((user) => user.role === 'landlord').length,
        disabled: users.filter((user) => user.disabledAt !== null).length,
        operators: users.filter((user) => user.isOperator && user.disabledAt === null).map((user) => user.email),
      },
      deadlines: {
        overdue: dueItems.filter((item) => item.daysUntil < 0).length,
        soon: dueItems.filter((item) => item.daysUntil >= 0 && item.daysUntil <= 30).length,
        total: dueItems.length,
      },
      activity:
        viewer === null || !viewer.isOperator
          ? auth
              .recentEvents(40)
              .filter((event) => !event.kind.startsWith('operator.') && !event.kind.startsWith('user.'))
              .slice(0, 10)
              .map((event) => ({ at: event.at, kind: event.kind, actor: event.actorName, detail: event.detail }))
          : auth
              .recentEvents(10)
              .map((event) => ({ at: event.at, kind: event.kind, actor: event.actorName, detail: event.detail })),
      care: {
        databaseBytes: storage.databaseBytes,
        freeBytes: storage.freeBytes,
        totalBytes: storage.totalBytes,
        lastBackupAt: lastBackup.at,
        lastBackupBytes: lastBackup.bytes,
      },
      feedback: viewer !== null && viewer.isOperator ? { waiting: newFeedbackWaiting(feedback) } : null,
      you: viewer === null ? null : { name: viewer.name, email: viewer.email, role: viewer.role, isOperator: viewer.isOperator },
    };
  });
  // --- packs --------------------------------------------------------------

  app.get('/api/packs', async (request) => {
    const viewer = currentUser(request);
    const packs = store.listPacks();
    // A landlord sees the tenancies for their own properties, and no others.
    const visible =
      viewer !== null && isLandlord(viewer) && viewer.landlordId !== null
        ? packs.filter((pack) => pack.landlordId === viewer.landlordId)
        : packs;
    return { packs: visible.map((pack) => packSummaryView(pack, store, effectiveFor(pack))) };
  });

  app.post('/api/packs', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const rawFields = typeof body['fields'] === 'object' && body['fields'] !== null
      ? (body['fields'] as Record<string, unknown>)
      : {};

    // Do not copy the agency's details into the pack: they are inherited from
    // Settings, so changing them later must not leave stale copies behind.
    const seeded: Record<string, unknown> = mergeFields({}, rawFields).merged;
    const pack = store.createPack(seeded);
    note(request, 'pack.created', pack.reference, pack.id);
    return reply.code(201).send(packDetail(pack));
  });

  /**
   * What to offer this person, ranked by what is true of this pack.
   *
   * Drawn from facts the app already holds, so the start of the Assistant costs no model
   * call — and so the order can be asserted in a test rather than admired by hand.
   */
  app.get('/api/packs/:id/guidance', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');

    const viewer = currentUser(request);
    const fields = effectiveFor(pack);
    const context = contextFor(pack, backOffice);
    const readiness = assessPack(fields);
    const uploads = customTemplates.list();
    const mapped = uploads.filter(
      (template) => (template.links?.length ?? 0) > 0 || (template.blankFields?.length ?? 0) > 0,
    ).length;

    const facts = {
      hasTenant: pack.tenantName.trim() !== '',
      missing: context.resolved.missing,
      errors: readiness.compliance.counts.error,
      warnings: readiness.compliance.counts.warning,
      documents: store.listDocuments(pack.id).length,
      suggested: registry.suggestSelection(fields).length,
      hasCoverMessage: pack.coverMessage !== null,
      uploads: uploads.length,
      mappedUploads: mapped,
      isLandlord: viewer !== null && isLandlord(viewer),
    };

    const { options, resume } = rankGuides(facts);
    return { options, resume, landlord: facts.isLandlord, facts: {
      missing: facts.missing,
      documents: facts.documents,
      suggested: facts.suggested,
      errors: facts.errors,
      warnings: facts.warnings,
    } };
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
      const changed = Object.keys(rawFields).filter(
        (key) => JSON.stringify(pack.fields[key] ?? null) !== JSON.stringify(fields[key] ?? null),
      );
      if (changed.length > 0) note(request, 'fields.changed', changed.join(', '), pack.id);
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
    note(request, 'pack.deleted', `${pack.reference} ${pack.tenantName}`.trim(), pack.id);
    store.deletePack(pack.id);
    return reply.code(204).send();
  });

  app.post('/api/packs/:id/notes', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');

    const body = (request.body ?? {}) as Record<string, unknown>;
    const text = typeof body['text'] === 'string' ? body['text'].trim() : '';
    if (text === '') return badRequest(reply, 'Write something first.');

    const notes = [
      ...pack.notes,
      {
        id: crypto.randomUUID(),
        text,
        createdAt: new Date().toISOString(),
        author: currentUser(request)?.name ?? '',
      },
    ];
    note(request, 'note.added', text.slice(0, 160), pack.id);
    return store.updatePack(pack.id, { notes });
  });

  app.delete('/api/packs/:id/notes/:noteId', async (request, reply) => {
    const pack = store.findPack(paramId(request));
    if (pack === null) return notFound(reply, 'That pack no longer exists.');

    const noteId = (request.params as Record<string, string>)['noteId'];
    const notes = pack.notes.filter((note) => note.id !== noteId);
    note(request, 'note.removed', '', pack.id);
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

    const fields = effectiveFor(pack);
    const gate = reviewGate(runComplianceChecks(fields), backOffice.getSettings().reviewMode);

    // Ask once before carrying on, rather than refusing to work. Strict mode
    // turns the same question into a refusal.
    const confirmed = body['confirm'] === true;
    if (gate.needsConfirmation && !confirmed) {
      return {
        needsConfirmation: true,
        canGenerate: gate.canGenerate,
        mode: gate.mode,
        message: gate.message,
        findings: gate.outstanding,
        documents: [],
        pack: packDetail(pack),
      };
    }

    const generated = await generateDocuments({
      store,
      registry,
      packId: pack.id,
      fields,
      ...(templateIds === undefined ? {} : { templateIds }),
      fallbackFields: currentAgency(),
    });

    // If they chose to carry on, leave a note saying so. A record, not a lecture.
    if (gate.needsConfirmation && gate.canGenerate) {
      store.updatePack(pack.id, {
        notes: [
          ...store.getPack(pack.id).notes,
          {
            id: crypto.randomUUID(),
            text: `Generated with ${gate.outstanding.length} outstanding item${gate.outstanding.length === 1 ? '' : 's'} acknowledged: ${gate.outstanding
              .map((finding) => finding.title)
              .join('; ')}.`,
            createdAt: new Date().toISOString(),
            author: currentUser(request)?.name ?? '',
          },
        ],
      });
    }

    note(
      request,
      'documents.generated',
      `${generated.length} document${generated.length === 1 ? '' : 's'}: ${generated.map((document) => document.title).join(', ')}`,
      pack.id,
    );

    return { documents: generated, pack: packDetail(store.getPack(pack.id)), gate };
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

    let replyText = '';
    const send = (event: AgentEvent | { type: 'fatal'; message: string }) => {
      if (event.type === 'message' || event.type === 'done') replyText = event.text;
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
          reviewMode: () => backOffice.getSettings().reviewMode,
        },
        userMessage: message,
        onEvent: send,
      });
    } catch (error) {
      send({ type: 'fatal', message: error instanceof Error ? error.message : String(error) });
    } finally {
      // What was asked, and what came back — attributed, like everything else.
      note(
        request,
        'assistant.run',
        `${message.slice(0, 120)}${replyText.trim() === '' ? '' : ` → ${replyText.trim().slice(0, 160)}`}`,
        pack.id,
      );
      if (!closed) raw.end();
    }
  });

  return app;
}

/** The newest backup in a folder and its date, for the care panel. */
function latestBackupAge(dir: string): { at: string | null; bytes: number } {
  try {
    const files = readdirSync(dir).filter((name) => name.endsWith('.tar.gz'));
    if (files.length === 0) return { at: null, bytes: 0 };
    const newest = files
      .map((name) => ({ name, stat: statSync(join(dir, name)) }))
      .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0];
    return newest === undefined ? { at: null, bytes: 0 } : { at: newest.stat.mtime.toISOString(), bytes: newest.stat.size };
  } catch {
    return { at: null, bytes: 0 };
  }
}

/** How many feedback records are waiting on the operator. */
function newFeedbackWaiting(feedback: FeedbackStore): number {
  const counts = feedback.counts();
  return (counts['new'] ?? 0) + (counts['triaged'] ?? 0);
}

function paramId(request: FastifyRequest): string {
  return (request.params as Record<string, string>)['id'] ?? '';
}

export type { FastifyInstance };
