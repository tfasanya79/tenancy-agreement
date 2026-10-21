/**
 * The feedback routes.
 *
 * Three of them are for anybody with an account — a landlord complaining about the
 * documents tab is exactly the customer this exists for. The rest are the operator's:
 * `src/auth/guard.ts` refuses them for everyone else, including an agency owner, so a
 * landlord's words cannot reach the agency they are about.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { DeepSeekClient } from '../agent/deepseek.ts';
import { currentUser, requireUser } from '../auth/guard.ts';
import { runFeedbackTurn, type FeedbackProposal } from './chat.ts';
import {
  FEEDBACK_AREAS,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  STATUS_WORDS,
  type FeedbackArea,
  type FeedbackKind,
  type FeedbackStatus,
  type FeedbackStore,
} from './store.ts';

const MAX_SUBMISSIONS_PER_HOUR = 5;
const MAX_TURNS_PER_HOUR = 40;

const submissions = new Map<string, number[]>();
const turns = new Map<string, number[]>();

/** Best effort in-memory throttle: enough to stop a stuck client or a bored one. */
function tooMany(store: Map<string, number[]>, userId: string, limit: number): boolean {
  const now = Date.now();
  const recent = (store.get(userId) ?? []).filter((at) => now - at < 60 * 60 * 1000);
  store.set(userId, [...recent, now]);
  return recent.length >= limit;
}

export function resetFeedbackLimits(): void {
  submissions.clear();
  turns.clear();
}

type Body = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  (options as readonly string[]).includes(text(value)) ? (text(value) as T) : fallback;

export type FeedbackRouteDeps = {
  feedback: FeedbackStore;
  client: DeepSeekClient;
  /** False when there is no key or OFFLINE_MODE is set: the interface shows the form. */
  assistantAvailable: boolean;
};

/** What a tester is shown about their own submissions. */
const forTester = (item: ReturnType<FeedbackStore['forUser']>[number]) => ({
  id: item.id,
  kind: item.kind,
  title: item.title,
  summary: item.summary,
  status: item.status,
  statusWords: STATUS_WORDS[item.status],
  publicNote: item.publicNote,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

export function registerFeedbackRoutes(app: FastifyInstance, deps: FeedbackRouteDeps): void {
  const { feedback, client, assistantAvailable } = deps;

  /**
   * One turn of the conversation. The proposal is a suggestion to the tester, not a
   * filed record: filing happens on the next request, once they have agreed to it.
   */
  app.post('/api/feedback/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = requireUser(request);

    if (!assistantAvailable) {
      return reply.code(200).send({
        unavailable: true,
        reply: 'The assistant is switched off at the moment, so this is a plain form — it is just as useful and goes to the same list.',
        proposal: null,
      });
    }

    if (tooMany(turns, user.id, MAX_TURNS_PER_HOUR)) {
      return reply.code(429).send({ error: 'That is a lot of messages in an hour. Try again shortly, or use the form.' });
    }

    const body = (request.body ?? {}) as Body;
    const context = (typeof body['context'] === 'object' && body['context'] !== null ? body['context'] : {}) as Body;
    const raw = Array.isArray(body['messages']) ? body['messages'] : [];

    const transcript = raw
      .filter((item): item is Body => typeof item === 'object' && item !== null)
      .map((item) => ({
        role: text(item['role']) === 'agent' ? ('agent' as const) : ('tester' as const),
        text: text(item['text']),
      }))
      .filter((item) => item.text !== '');

    if (transcript.length === 0) return reply.code(400).send({ error: 'Nothing to answer yet.' });

    try {
      const turn = await runFeedbackTurn({
        client,
        context: {
          screen: text(context['screen']),
          packReference: text(context['packReference']),
          userName: user.name,
          role: user.role,
        },
        transcript,
      });
      return { reply: turn.reply, proposal: turn.proposal };
    } catch (error) {
      // Never lose the tester's words because the model had a bad day.
      return reply.code(200).send({
        unavailable: true,
        reply: 'I could not reach the assistant just now. Your words are still here — press Send again, or file it as a plain note with the form.',
        proposal: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /** File the record — the form, and the confirmation of a proposal. */
  app.post('/api/feedback', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = requireUser(request);
    if (tooMany(submissions, user.id, MAX_SUBMISSIONS_PER_HOUR)) {
      return reply
        .code(429)
        .send({ error: 'You have sent five already this hour. Give us a chance to read them, then send the rest.' });
    }

    const body = (request.body ?? {}) as Body;
    const title = text(body['title']);
    const summary = text(body['summary']);
    if (title === '' && summary === '') return reply.code(400).send({ error: 'Tell us what to change first.' });

    const raw = Array.isArray(body['messages']) ? body['messages'] : [];
    const messages = raw
      .filter((item): item is Body => typeof item === 'object' && item !== null)
      .map((item) => ({
        role: text(item['role']) === 'agent' ? ('agent' as const) : ('tester' as const),
        text: text(item['text']),
      }))
      .filter((item) => item.text !== '');

    const created = feedback.add({
      userId: user.id,
      userName: user.name,
      role: user.role,
      kind: oneOf<FeedbackKind>(body['kind'], FEEDBACK_KINDS, 'improvement'),
      title: title === '' ? summary.slice(0, 80) : title,
      summary: summary === '' ? title : summary,
      area: oneOf<FeedbackArea>(body['area'], FEEDBACK_AREAS, 'other'),
      sentiment: text(body['sentiment']) === '' ? 'neutral' : text(body['sentiment']),
      screen: text(body['screen']),
      packReference: text(body['packReference']),
      messages,
    });

    return reply.code(201).send({
      feedback: forTester(created),
      message: 'Filed. It goes to the TenancyDesk team — not to your agency.',
    });
  });

  /** A tester's own list. The only way somebody without the operator flag reads a row. */
  app.get('/api/feedback/mine', async (request: FastifyRequest) => {
    const user = requireUser(request);
    return { items: feedback.forUser(user.id).map(forTester) };
  });

  // --- the operator's queue -------------------------------------------------

  app.get('/api/feedback/queue', async (request: FastifyRequest) => {
    const query = request.query as Body;
    const status = text(query['status']);
    const kind = text(query['kind']);
    return {
      items: feedback.queue(
        {
          ...(status === '' ? {} : { status }),
          ...(kind === '' ? {} : { kind }),
        },
      ),
      counts: feedback.counts(),
      statuses: FEEDBACK_STATUSES.map((value) => ({ value, label: STATUS_WORDS[value] })),
      kinds: FEEDBACK_KINDS,
      areas: FEEDBACK_AREAS,
    };
  });

  app.patch('/api/feedback/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.params as Record<string, string>)['id'] ?? '';
    const body = (request.body ?? {}) as Body;

    const updated = feedback.update(id, {
      ...(text(body['status']) === ''
        ? {}
        : { status: oneOf<FeedbackStatus>(body['status'], FEEDBACK_STATUSES, 'new') }),
      ...(body['operatorNote'] === undefined ? {} : { operatorNote: text(body['operatorNote']) }),
      ...(body['publicNote'] === undefined ? {} : { publicNote: text(body['publicNote']) }),
    });
    if (updated === null) return reply.code(404).send({ error: 'That feedback is not in the list.' });
    return { feedback: updated };
  });

  app.get('/api/feedback/export', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Body;
    const withNotes = text(query['private']) === '1';
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .code(200)
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="feedback-${stamp}.md"`)
      .send(feedback.toMarkdown(withNotes));
  });

  /** Counts for the tab title, so an unread pile announces itself. */
  app.get('/api/feedback/summary', async (request: FastifyRequest) => {
    const user = currentUser(request);
    if (user === null || !user.isOperator) return { counts: {}, mine: 0 };
    return { counts: feedback.counts(), mine: feedback.forUser(user.id, 100).length };
  });
}

export type { FeedbackProposal };
