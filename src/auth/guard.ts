/**
 * Who is asking, and may they.
 *
 * The app has no sessions of its own before this module existed: every request
 * was "the agent". Now a request either carries a session cookie or it is
 * refused, and the person behind it is available to every route as
 * `currentUser(request)`.
 *
 * Three rules, in order:
 *
 *   1. A short list of endpoints is public — the health check and the sign-in
 *      screen itself. Everything else under /api needs a session.
 *   2. Unsafe methods must not arrive from another origin (a cookie alone must
 *      never be enough for a form on someone else's page).
 *   3. Landlords may read their own tenancies and nothing else. Owners may do
 *      everything, including people and settings. Agents may do everything about
 *      tenancies and records, but not those two.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthStore, User } from './store.ts';
import type { Store } from '../db.ts';

export const SESSION_COOKIE = 'td_session';

/** Signed-in people are keyed by request, so no route has to thread a user about. */
const signedIn = new WeakMap<FastifyRequest, User>();

export function currentUser(request: FastifyRequest): User | null {
  return signedIn.get(request) ?? null;
}

/** The person, or an error the route can send. */
export function requireUser(request: FastifyRequest): User {
  const user = signedIn.get(request);
  if (user === undefined) throw new Error('No signed-in user on this request.');
  return user;
}

export function isOwner(user: User): boolean {
  return user.role === 'owner';
}

export function isLandlord(user: User): boolean {
  return user.role === 'landlord';
}

/** Staff can do everything about tenancies; landlords may only look. */
export function canWrite(user: User): boolean {
  return user.role === 'owner' || user.role === 'agent';
}

export function readCookie(request: FastifyRequest, name: string): string {
  const header = request.headers.cookie;
  if (typeof header !== 'string' || header === '') return '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function cookie(request: FastifyRequest, name: string, value: string, maxAgeSeconds: number): string {
  // `Secure` only over HTTPS: the same build is used on localhost, where a Secure
  // cookie would never be sent back and nobody could sign in.
  const secure = request.protocol === 'https' || (request.headers['x-forwarded-proto'] ?? '') === 'https';
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secure) flags.push('Secure');
  return `${name}=${encodeURIComponent(value)}; ${flags.join('; ')}`;
}

export function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string): void {
  reply.header('set-cookie', cookie(request, SESSION_COOKIE, token, 12 * 60 * 60));
}

export function clearSessionCookie(request: FastifyRequest, reply: FastifyReply): void {
  reply.header('set-cookie', cookie(request, SESSION_COOKIE, '', 0));
}

/** Endpoints that work without signing in. */
const PUBLIC = new Set(['/api/health', '/api/auth/status', '/api/auth/login', '/api/auth/setup']);

/** What a landlord may read. Everything else is for staff. */
const LANDLORD_READS: RegExp[] = [
  /^\/api\/auth\/me$/,
  /^\/api\/config$/,
  /^\/api\/fields$/,
  /^\/api\/templates$/,
  /^\/api\/rules(\/[^/]+)?$/,
  /^\/api\/packs$/,
  /^\/api\/packs\/[^/]+$/,
  /^\/api\/packs\/[^/]+\/(timeline\.html|bundle\.zip|calendar\.ics)$/,
  /^\/api\/documents\/[^/]+\/download$/,
  /^\/api\/backoffice$/,
  /^\/api\/due$/,
  /^\/api\/calendar\.ics$/,
  /^\/api\/feedback\/mine$/,
  /^\/api\/overview$/,
];

/**
 * Writes a landlord may still make. Reading is the default for a landlord, but
 * complaining about the software is not a change to a tenancy, and it would be a poor
 * joke to tell a landlord they are not allowed to.
 */
const LANDLORD_WRITES: RegExp[] = [/^\/api\/feedback$/, /^\/api\/feedback\/chat$/];

type Rule = { methods: '*' | string[]; pattern: RegExp };

function matches(rule: Rule, method: string, path: string): boolean {
  if (rule.methods !== '*' && !rule.methods.includes(method)) return false;
  return rule.pattern.test(path);
}

/** Only the owner of the *agency* may do these. */
const OWNER_ONLY: Rule[] = [
  { methods: '*', pattern: /^\/api\/users(\/.*)?$/ },
  { methods: '*', pattern: /^\/api\/access(\/.*)?$/ },
  { methods: '*', pattern: /^\/api\/settings$/ },
  { methods: '*', pattern: /^\/api\/backup$/ },
  { methods: '*', pattern: /^\/api\/backoffice\/migrate\// },
];

/**
 * Only the *operator* — the person who owns the product — may do these. Kept separate
 * from the owner rules on purpose: feedback is addressed to the platform, so an agency
 * owner must not be able to read what their own landlord said about them.
 */
const OPERATOR_ONLY: Rule[] = [
  { methods: ['GET'], pattern: /^\/api\/feedback\/queue$/ },
  { methods: ['GET'], pattern: /^\/api\/feedback\/export$/ },
  { methods: ['PATCH'], pattern: /^\/api\/feedback\/[^/]+$/ },
];

export type GuardDeps = {
  auth: AuthStore;
  store: Store;
};

function sameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === '') return true; // curl, scripts, older clients

  // `new URL('http://example.com:80').host` drops the default port, so compare
  // without one: otherwise a same-origin form post on port 80 looks foreign.
  const bare = (value: string): string => value.trim().toLowerCase().replace(/:(80|443)$/, '');
  const host = bare(request.headers.host ?? '');
  const forwarded = bare(String(request.headers['x-forwarded-host'] ?? ''));

  try {
    const parsed = bare(new URL(origin).host);
    return parsed === host || (forwarded !== '' && parsed === forwarded);
  } catch {
    return false;
  }
}

/** The pack this request is about, when the path names one. */
function packIdFromPath(path: string): string | null {
  const match = /^\/api\/packs\/([^/]+)/.exec(path);
  return match?.[1] ?? null;
}

/**
 * Landlords reach only their own tenancies. Checked here rather than in each
 * route so a new route cannot forget: if the path names a pack, the pack has to
 * belong to them.
 */
function landlordOwnsPath(request: FastifyRequest, deps: GuardDeps): boolean {
  const user = requireUser(request);
  const path = (request.url.split('?')[0] ?? '').replace(/\/$/, '');

  const packId = packIdFromPath(path);
  if (packId !== null && packId !== 'bulk') {
    const pack = deps.store.findPack(packId);
    return pack !== null && pack.landlordId !== null && pack.landlordId === user.landlordId;
  }

  const documentMatch = /^\/api\/documents\/([^/]+)\/download$/.exec(path);
  if (documentMatch !== null) {
    const document = deps.store.getDocument(documentMatch[1] ?? '');
    if (document === null) return false;
    const pack = deps.store.findPack(document.packId);
    return pack !== null && pack.landlordId !== null && pack.landlordId === user.landlordId;
  }

  return true;
}

export function registerAuthGuard(app: FastifyInstance, deps: GuardDeps): void {
  app.addHook('onRequest', async (request, reply) => {
    const path = (request.url.split('?')[0] ?? '').replace(/\/$/, '') || '/';
    if (!path.startsWith('/api/')) return; // the page shell and its assets are public
    if (PUBLIC.has(path)) return;

    const token = readCookie(request, SESSION_COOKIE);
    const found = deps.auth.sessionUser(token);
    if (found === null) {
      return reply.code(401).send({ error: 'Please sign in.', signedOut: true });
    }

    signedIn.set(request, found.user);

    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !sameOrigin(request)) {
      return reply.code(403).send({ error: 'That request came from somewhere else. Reload the page and try again.' });
    }

    const user = found.user;

    if (OWNER_ONLY.some((rule) => matches(rule, request.method, path)) && !isOwner(user)) {
      return reply.code(403).send({ error: 'Only the owner account can do that.' });
    }

    if (OPERATOR_ONLY.some((rule) => matches(rule, request.method, path)) && !user.isOperator) {
      const operators = deps.auth.operatorEmails();
      // An agency owner who is not the product owner gets told who is, and what to do:
      // a refusal that does not explain itself is how a working feature looks broken.
      if (isOwner(user)) {
        return reply.code(403).send({
          error:
            operators.length === 0
              ? 'No account is marked as the product owner yet, so this list has nobody reading it.'
              : `This list belongs to ${operators.join(' or ')}. You are signed in as ${user.email}.`,
          operatorEmail: operators[0] ?? null,
          youAre: user.email,
          hint: 'Mark the account in Back office → People & access, or add the address to OPERATOR_EMAILS and restart.',
        });
      }
      return reply.code(403).send({ error: 'That is the product owner’s list, not part of your account.' });
    }

    if (isLandlord(user)) {
      const mayWriteHere = LANDLORD_WRITES.some((pattern) => pattern.test(path)) && request.method === 'POST';
      if (request.method !== 'GET' && !mayWriteHere) {
        return reply.code(403).send({ error: 'Your access is read-only. Ask the agency to make a change.' });
      }
      if (request.method === 'GET' && !LANDLORD_READS.some((pattern) => pattern.test(path))) {
        return reply.code(403).send({ error: 'That is not part of your access.' });
      }
      if (!landlordOwnsPath(request, deps)) {
        return reply.code(404).send({ error: 'That pack is not one of yours.' });
      }
    }
  });
}
