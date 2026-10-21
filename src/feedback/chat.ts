/**
 * The conversation in front of the feedback record.
 *
 * This is not the pack assistant. It has no tools that touch a tenancy, no access to
 * the store, and no ability to file anything: it talks, reflects, and — when it
 * understands — offers a *proposal* for the person to confirm. Filing happens on the
 * next request, from the interface, with the tester's agreement in between. That keeps
 * the confirmation in the code path rather than in a prompt's good behaviour.
 */

import type { ChatMessage, DeepSeekClient, ToolDefinition } from '../agent/deepseek.ts';
import { FEEDBACK_AREAS, FEEDBACK_KINDS } from './store.ts';

export type FeedbackTurnContext = {
  /** Which tab or screen the button was pressed on: "documents", "details", … */
  screen: string;
  /** The reference only — never the tenancy's contents. */
  packReference: string;
  userName: string;
  role: string;
};

export type FeedbackProposal = {
  kind: string;
  title: string;
  summary: string;
  area: string;
  sentiment: string;
};

export type FeedbackTurn = { reply: string; proposal: FeedbackProposal | null };

export const PROPOSE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'propose_feedback',
    description:
      'Offer the tester a one-line summary of what they are asking for, so they can confirm it before it is filed. Call this only when you understand the request and the tester has not already agreed to a summary.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [...FEEDBACK_KINDS],
          description:
            'improvement = make something existing better. new_feature = something that does not exist. bug = it is broken. confusion = the tester could not work out how to do something. praise = nothing to change.',
        },
        title: { type: 'string', description: 'One line, in the tester’s own words where possible.' },
        summary: { type: 'string', description: 'Two sentences: what they want, and why. Plain English.' },
        area: { type: 'string', enum: [...FEEDBACK_AREAS], description: 'Which part of the app this concerns.' },
        sentiment: { type: 'string', enum: ['positive', 'neutral', 'frustrated'] },
      },
      required: ['kind', 'title', 'summary', 'area'],
    },
  },
};

export function feedbackPrompt(context: FeedbackTurnContext): string {
  return `You are the feedback assistant for TenancyDesk, a tool letting agents and landlords use to produce tenancy paperwork. You are talking to ${context.userName || 'a signed-in user'}, whose role is ${context.role || 'user'}. They pressed a FEEDBACK button${context.screen === '' ? '' : ` on the "${context.screen}" screen`}${context.packReference === '' ? '' : `, on tenancy ${context.packReference}`}.

Your job is to understand what they want, in their words, and to leave a record somebody can act on.

How to talk:
- Short. Two or three sentences. No headings, no bullet lists, no "as an AI".
- Warm and plain, like a competent colleague. Never flatter, never grovel.
- **Reflect before you file.** When you think you understand, say it back in one or two sentences — "So — you want the deposit date to fill itself in from the start date, so you stop typing it. Is that right?" — and call propose_feedback in the same turn so the interface can show them the record.
- Ask **one** question, and only when you genuinely cannot tell what they mean. Never two in a row. If the report is vague ("it doesn't work"), ask what they expected and what happened instead.
- If they correct you, take the correction and reflect again.

What you must not do:
- **Never promise anything.** No "we'll fix that", no "next release", no "I'll pass it to the developers", no dates, no priorities. You do not know. Say the team will read it, and leave it there.
- Never claim a document, a rent figure or a legal position. You are not the tenancy assistant.
- Never ask for, repeat or guess anyone's personal data — no names of tenants, no addresses, no ID numbers. If the tester pastes some, do not echo it back; say it is better not to send other people's details.
- Do not close or refuse a report. Everything gets filed, however small.
- If they describe a fault in their tenancy itself (a broken boiler, a missing key, a deposit dispute) rather than the software, say plainly that this button reaches the TenancyDesk team and not their agent, and suggest they contact the agency — then offer to file it anyway as a note that the app should make this clearer.
- If what they want already exists, say where, in one sentence, marked as a suggestion — for example "that is in Back office → Our documents" — and still offer to file it, because the app failing to make it findable is itself worth knowing.

Filing: call propose_feedback with kind, title, summary, area and sentiment. The title is their ask in one line; the summary is what they want and why, in two sentences, with no personal data in it.`;
}

export type FeedbackTurnInput = {
  client: DeepSeekClient;
  context: FeedbackTurnContext;
  /** The conversation so far, oldest first, as the interface holds it. */
  transcript: Array<{ role: 'tester' | 'agent'; text: string }>;
};

const toChatMessages = (context: FeedbackTurnContext, transcript: FeedbackTurnInput['transcript']): ChatMessage[] => [
  { role: 'system', content: feedbackPrompt(context) },
  ...transcript.map((message): ChatMessage => ({
    role: message.role === 'agent' ? 'assistant' : 'user',
    content: message.text,
  })),
];

/** One turn: what to say back, and the record to offer if there is one. */
export async function runFeedbackTurn(input: FeedbackTurnInput): Promise<FeedbackTurn> {
  const result = await input.client.chat(toChatMessages(input.context, input.transcript), [PROPOSE_TOOL]);

  const call = result.toolCalls.find((candidate) => candidate.function.name === 'propose_feedback');
  if (call === undefined) {
    return { reply: result.content.trim(), proposal: null };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch {
    return { reply: result.content.trim(), proposal: null };
  }

  const text = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;

  const kind = text(parsed['kind'], 'improvement');
  const area = text(parsed['area'], input.context.screen === '' ? 'other' : input.context.screen);

  return {
    reply: result.content.trim(),
    proposal: {
      kind: (FEEDBACK_KINDS as readonly string[]).includes(kind) ? kind : 'improvement',
      title: text(parsed['title'], 'Feedback'),
      summary: text(parsed['summary'], ''),
      area: (FEEDBACK_AREAS as readonly string[]).includes(area) ? area : 'other',
      sentiment: text(parsed['sentiment'], 'neutral'),
    },
  };
}
