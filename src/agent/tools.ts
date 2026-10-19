/**
 * The assistant's tools.
 *
 * Every tool is an ordinary function with a name and a JSON schema. The model
 * chooses when to call one; the code here decides what is actually permitted.
 * That split is what stops an AI from quietly producing a wrong contract: it can
 * only ever write values into an allow-list of fields, and it can only generate
 * documents that exist on disk.
 */

import { randomUUID } from 'node:crypto';

import { runComplianceChecks } from '../docs/compliance.ts';
import { labelFor, mergeFields, missingCoreFields } from '../docs/fields.ts';
import { generateDocuments } from '../docs/generate.ts';
import { tenantNameFrom, propertyAddressFrom, type Store } from '../db.ts';
import type { TemplateRegistry } from '../docs/registry.ts';
import { searchRules } from '../knowledge/rules.ts';
import type { ToolDefinition } from './deepseek.ts';

export type ToolRuntime = {
  store: Store;
  registry: TemplateRegistry;
  packId: string;
  /** Agency details from .env, used when the pack has none. */
  fallbackFields: Record<string, unknown>;
  today?: Date;
};

export type ToolOutcome = { ok: boolean; result: unknown };

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_pack',
      description:
        'Read the pack you are working on: the details recorded so far, which essential details are still missing, and the compliance check result. Call this first if you are unsure of the current state.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_fields',
      description:
        'Record details for the tenant pack. Only include keys with values you were actually given. Calling this again merges with what is already there — you do not need to repeat existing values. For tenants, pass an array of objects.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'object',
            description: 'Field key → value. Keys must come from the field list in your instructions.',
            additionalProperties: true,
          },
        },
        required: ['fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_compliance',
      description:
        'Run the legal and completeness checks on the current details. Returns errors (which block generation), warnings and notes, plus upcoming statutory deadlines. Run this before generating documents.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_documents',
      description:
        'List the document templates available, with the pack reference and a "recommended" flag for the documents a new tenant normally needs. Use the returned ids when calling generate_documents.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_documents',
      description:
        'Create the finished documents (Word, print-ready HTML and Markdown) for the pack. Omit template_ids to generate every recommended document. Refuses to run while any compliance error remains.',
      parameters: {
        type: 'object',
        properties: {
          template_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Template ids to generate, e.g. ["apt-agreement"]. Leave out for the recommended set.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_note',
      description:
        'Add a short internal note to the pack — something the agent must remember or do. Use for actions you cannot perform yourself, such as protecting a deposit with a scheme.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The note, written for the agent to read later.' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_cover_message',
      description:
        'Save a ready-to-send message to the tenant alongside the pack: a covering email and/or a WhatsApp message, in your own words, telling them what is attached and what to do next.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Subject line and body of an email to the tenant.' },
          whatsapp: { type: 'string', description: 'A shorter message suitable for WhatsApp.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_rules',
      description:
        'Search the curated England & Wales rule set for what the law requires — deposits, notices, certificates, rent increases, pets, discrimination. Always use this instead of relying on memory.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look up, e.g. "deposit deadline" or "rent increase".' },
        },
        required: ['query'],
      },
    },
  },
];

export const TOOL_NAMES: readonly string[] = TOOL_DEFINITIONS.map((tool) => tool.function.name);

/** Human-readable one-liner for the activity feed in the UI. */
export function describeToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'get_pack':
      return 'Reading the pack';
    case 'set_fields': {
      const raw = args['fields'];
      const count = typeof raw === 'object' && raw !== null ? Object.keys(raw).length : 0;
      return `Recording ${count} detail${count === 1 ? '' : 's'}`;
    }
    case 'check_compliance':
      return 'Running the compliance checks';
    case 'list_documents':
      return 'Looking up the document list';
    case 'generate_documents': {
      const ids = args['template_ids'];
      return Array.isArray(ids) && ids.length > 0
        ? `Generating ${ids.length} document${ids.length === 1 ? '' : 's'}`
        : 'Generating the document pack';
    }
    case 'add_note':
      return 'Adding a note for you';
    case 'save_cover_message':
      return 'Drafting a message to the tenant';
    case 'lookup_rules':
      return `Checking the rules on “${String(args['query'] ?? '')}”`;
    default:
      return name;
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  runtime: ToolRuntime,
): Promise<ToolOutcome> {
  const today = runtime.today ?? new Date();
  const pack = runtime.store.getPack(runtime.packId);

  try {
    switch (name) {
      case 'get_pack': {
        const compliance = runComplianceChecks(pack.fields, { today });
        return {
          ok: true,
          result: {
            reference: pack.reference,
            status: pack.status,
            tenant: tenantNameFrom(pack.fields),
            property: propertyAddressFrom(pack.fields),
            fields: pack.fields,
            missing_essential: missingCoreFields(pack.fields).map((key) => ({ key, label: labelFor(key) })),
            compliance: summariseCompliance(compliance),
            notes: pack.notes.map((note) => note.text),
          },
        };
      }

      case 'set_fields': {
        const raw = args['fields'];
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          return { ok: false, result: { error: 'fields must be an object of key → value.' } };
        }

        const { merged, written, unknown } = mergeFields(pack.fields, raw as Record<string, unknown>);

        runtime.store.updatePack(runtime.packId, { fields: merged });

        const missing = missingCoreFields(merged);
        return {
          ok: true,
          result: {
            saved: written,
            ignored_unknown_keys: unknown,
            still_missing: missing.map((key) => ({ key, label: labelFor(key) })),
            ready_to_generate: missing.length === 0,
          },
        };
      }

      case 'check_compliance': {
        const compliance = runComplianceChecks(pack.fields, { today });
        return { ok: true, result: summariseCompliance(compliance) };
      }

      case 'list_documents': {
        const recommended = new Set(runtime.registry.suggestSelection(pack.fields));
        return {
          ok: true,
          result: {
            reference: pack.reference,
            documents: runtime.registry.list(pack.fields).map((doc) => ({
              id: doc.id,
              title: doc.title,
              category: doc.category,
              description: doc.description,
              recommended: recommended.has(doc.id),
              missing_required: doc.missing.map((key) => ({ key, label: labelFor(key) })),
            })),
          },
        };
      }

      case 'generate_documents': {
        const compliance = runComplianceChecks(pack.fields, { today });
        if (!compliance.ok) {
          return {
            ok: false,
            result: {
              error: 'There are compliance errors that must be fixed before generating documents.',
              errors: compliance.findings
                .filter((finding) => finding.severity === 'error')
                .map((finding) => ({ title: finding.title, detail: finding.detail, fields: finding.fields ?? [] })),
            },
          };
        }

        const requested = args['template_ids'];
        let templateIds: string[] | undefined;
        if (Array.isArray(requested) && requested.length > 0) {
          templateIds = requested.filter((id): id is string => typeof id === 'string');
          const unknown = templateIds.filter((id) => !runtime.registry.has(id));
          if (unknown.length > 0) {
            return {
              ok: false,
              result: { error: `Unknown document id(s): ${unknown.join(', ')}. Call list_documents for the ids.` },
            };
          }
        }

        const generated = await generateDocuments({
          store: runtime.store,
          registry: runtime.registry,
          packId: runtime.packId,
          fields: pack.fields,
          templateIds,
          fallbackFields: runtime.fallbackFields,
          today,
        });

        return {
          ok: true,
          result: {
            generated: generated.map((doc) => ({
              title: doc.title,
              template_id: doc.templateId,
              size_bytes: doc.byteSize,
              fields_left_blank: doc.missing.map((key) => labelFor(key)),
            })),
            message: 'The agent can now download these from the Documents tab.',
          },
        };
      }

      case 'add_note': {
        const text = typeof args['text'] === 'string' ? args['text'].trim() : '';
        if (text === '') return { ok: false, result: { error: 'text is required.' } };
        const notes = [...pack.notes, { id: randomUUID(), text, createdAt: new Date().toISOString() }];
        runtime.store.updatePack(runtime.packId, { notes });
        return { ok: true, result: { saved: text, total_notes: notes.length } };
      }

      case 'save_cover_message': {
        const email = typeof args['email'] === 'string' ? args['email'].trim() : undefined;
        const whatsapp = typeof args['whatsapp'] === 'string' ? args['whatsapp'].trim() : undefined;
        if ((email ?? '') === '' && (whatsapp ?? '') === '') {
          return { ok: false, result: { error: 'Provide an email, a WhatsApp message, or both.' } };
        }
        const coverMessage: { email?: string; whatsapp?: string; createdAt: string } = {
          createdAt: new Date().toISOString(),
        };
        if ((email ?? '') !== '') coverMessage.email = email;
        if ((whatsapp ?? '') !== '') coverMessage.whatsapp = whatsapp;
        runtime.store.updatePack(runtime.packId, { coverMessage });
        return { ok: true, result: { saved: Object.keys(coverMessage).filter((key) => key !== 'createdAt') } };
      }

      case 'lookup_rules': {
        const query = typeof args['query'] === 'string' ? args['query'] : '';
        const matches = searchRules(query).slice(0, 4);
        if (matches.length === 0) {
          return {
            ok: true,
            result: {
              rules: [],
              note: 'Nothing in the rule set matches that. Tell the agent to check GOV.UK, and do not guess.',
            },
          };
        }
        return {
          ok: true,
          result: {
            rules: matches.map((rule) => ({
              title: rule.title,
              summary: rule.summary,
              detail: rule.detail,
              source: rule.source,
            })),
          },
        };
      }

      default:
        return { ok: false, result: { error: `Unknown tool "${name}".` } };
    }
  } catch (error) {
    return {
      ok: false,
      result: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

function summariseCompliance(compliance: ReturnType<typeof runComplianceChecks>) {
  return {
    ok: compliance.ok,
    counts: compliance.counts,
    findings: compliance.findings.map((finding) => ({
      severity: finding.severity,
      title: finding.title,
      detail: finding.detail,
      fields: finding.fields ?? [],
    })),
    deadlines: compliance.deadlines,
  };
}
