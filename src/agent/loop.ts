/**
 * The agent loop.
 *
 * Ask the model → it may call tools → feed results back → repeat until it
 * answers without calling a tool. Every step is streamed to the browser so the
 * agent can see exactly what happened, and the whole transcript is stored for
 * audit.
 */

import { DeepSeekClient, DeepSeekError, type ChatMessage, type ChatResult } from './deepseek.ts';
import { buildSystemPrompt } from './prompts.ts';
import {
  describeToolCall,
  executeTool,
  TOOL_DEFINITIONS,
  TOOL_NAMES,
  type ToolRuntime,
} from './tools.ts';

export type AgentEvent =
  | { type: 'start'; model: string }
  | { type: 'tool'; name: string; detail: string }
  | { type: 'tool_result'; name: string; ok: boolean; summary: string }
  | { type: 'message'; text: string }
  | { type: 'usage'; promptTokens: number; completionTokens: number }
  | { type: 'error'; message: string }
  | { type: 'done'; text: string; steps: number; runId: string | null };

export type AgentStep = {
  index: number;
  tool: string;
  args: unknown;
  ok: boolean;
  summary: string;
};

export type RunAgentOptions = {
  client: DeepSeekClient;
  runtime: ToolRuntime;
  userMessage: string;
  history?: ChatMessage[];
  maxSteps?: number;
  onEvent?: (event: AgentEvent) => void;
};

export type RunAgentResult = {
  text: string;
  steps: AgentStep[];
  usage: { promptTokens: number; completionTokens: number };
  runId: string | null;
};

const MAX_STEPS = 8;
const REPEAT_LIMIT = 3;

/** A short, human sentence describing what a tool returned. */
function summarise(name: string, outcome: { ok: boolean; result: unknown }): string {
  if (!outcome.ok) {
    const error =
      typeof outcome.result === 'object' && outcome.result !== null
        ? String((outcome.result as Record<string, unknown>)['error'] ?? 'Failed')
        : 'Failed';
    return error;
  }

  const result = outcome.result;
  switch (name) {
    case 'set_fields': {
      const saved = (result as { saved?: string[] }).saved ?? [];
      const missing = (result as { still_missing?: Array<{ label: string }> }).still_missing ?? [];
      const base = `Recorded ${saved.length} detail${saved.length === 1 ? '' : 's'}`;
      return missing.length === 0 ? `${base}; nothing essential is missing.` : `${base}; ${missing.length} still needed.`;
    }
    case 'check_compliance': {
      const counts = (result as { counts?: { error: number; warning: number } }).counts;
      if (counts === undefined) return 'Checks complete.';
      return `${counts.error} error${counts.error === 1 ? '' : 's'}, ${counts.warning} warning${counts.warning === 1 ? '' : 's'}.`;
    }
    case 'generate_documents': {
      // The first call asks rather than producing anything.
      if ((result as { needs_confirmation?: boolean }).needs_confirmation === true) {
        const count = (result as { outstanding?: unknown[] }).outstanding?.length ?? 0;
        return `Waiting for your go-ahead${count > 0 ? ` — ${count} item${count === 1 ? '' : 's'} to weigh up` : ''}.`;
      }
      const generated = (result as { generated?: unknown[] }).generated ?? [];
      return `${generated.length} document${generated.length === 1 ? '' : 's'} generated.`;
    }
    case 'list_documents': {
      const documents = (result as { documents?: unknown[] }).documents ?? [];
      return `${documents.length} templates available.`;
    }
    case 'lookup_rules': {
      const rules = (result as { rules?: unknown[] }).rules ?? [];
      return `${rules.length} matching rule${rules.length === 1 ? '' : 's'}.`;
    }
    case 'add_note':
      return 'Note saved.';
    case 'save_cover_message':
      return 'Tenant message saved.';
    case 'get_pack':
      return 'Pack loaded.';
    default:
      return 'Done.';
  }
}

function safeParseArgs(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (raw.trim() === '') return { ok: true, value: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: 'Arguments must be a JSON object.' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: `Invalid JSON arguments: ${raw.slice(0, 120)}` };
  }
}

export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const { client, runtime, userMessage } = options;
  const emit = options.onEvent ?? (() => {});
  const maxSteps = options.maxSteps ?? MAX_STEPS;

  const pack = runtime.store.getPack(runtime.packId);
  const system = buildSystemPrompt({
    today: runtime.today ?? new Date(),
    packReference: pack.reference,
    fields: pack.fields,
    templateList: runtime.registry.list(pack.fields).map((doc) => ({
      id: doc.id,
      title: doc.title,
      category: doc.category,
      required: doc.required,
    })),
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...(options.history ?? []),
    { role: 'user', content: userMessage },
  ];

  emit({ type: 'start', model: client.model });

  const steps: AgentStep[] = [];
  const usage = { promptTokens: 0, completionTokens: 0 };
  const seen = new Map<string, number>();
  let finalText = '';
  let stepIndex = 0;

  try {
    for (let round = 0; round < maxSteps; round += 1) {
      const response: ChatResult = await client.chat(messages, [...TOOL_DEFINITIONS]);
      usage.promptTokens += response.usage.promptTokens;
      usage.completionTokens += response.usage.completionTokens;

      if (response.toolCalls.length === 0) {
        finalText = response.content.trim();
        break;
      }

      messages.push({
        role: 'assistant',
        content: response.content === '' ? null : response.content,
        tool_calls: response.toolCalls,
      });

      let stopAfterThisRound = false;

      for (const call of response.toolCalls) {
        const name = call.function.name;
        const parsed = safeParseArgs(call.function.arguments);
        const args = parsed.ok ? parsed.value : {};

        emit({ type: 'tool', name, detail: describeToolCall(name, args) });

        let outcome: { ok: boolean; result: unknown };
        if (!parsed.ok) {
          outcome = { ok: false, result: { error: parsed.error } };
        } else if (!TOOL_NAMES.includes(name)) {
          outcome = { ok: false, result: { error: `Unknown tool "${name}".` } };
        } else {
          const signature = `${name}:${call.function.arguments}`;
          const count = (seen.get(signature) ?? 0) + 1;
          seen.set(signature, count);
          if (count > REPEAT_LIMIT) {
            outcome = {
              ok: false,
              result: { error: 'You have already tried this exact call several times. Do something else, or stop and ask the agent.' },
            };
            stopAfterThisRound = true;
          } else {
            outcome = await executeTool(name, args, runtime);
          }
        }

        const summary = summarise(name, outcome);
        steps.push({ index: stepIndex, tool: name, args, ok: outcome.ok, summary });
        stepIndex += 1;

        emit({ type: 'tool_result', name, ok: outcome.ok, summary });

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(outcome.result).slice(0, 12_000),
        });
      }

      if (stopAfterThisRound) {
        finalText = 'I seem to be going round in circles. Let me stop here — tell me what you would like me to do next.';
        break;
      }
    }

    if (finalText === '') {
      finalText =
        steps.length === 0
          ? 'I could not work out what to do from that. Try describing what you would like in a sentence.'
          : 'Done — have a look at the result and tell me if you would like anything changed.';
    }

    emit({ type: 'usage', ...usage });
    emit({ type: 'message', text: finalText });

    let runId: string | null = null;
    try {
      const run = runtime.store.saveRun({
        packId: runtime.packId,
        kind: 'chat',
        model: client.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        steps,
        summary: finalText.slice(0, 500),
      });
      runId = run.id;
    } catch {
      // Logging must never break the reply.
    }

    emit({ type: 'done', text: finalText, steps: steps.length, runId });
    return { text: finalText, steps, usage, runId };
  } catch (error) {
    const message =
      error instanceof DeepSeekError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    emit({ type: 'error', message });
    throw error;
  }
}
