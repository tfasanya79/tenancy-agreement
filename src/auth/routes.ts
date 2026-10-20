/**
 * Signing in, and managing who may.
 *
 * The first-run rule matters: while no account exists, `/api/auth/setup` is the
 * only way in and it closes for good the moment the first account is made. After
 * that, accounts are created by the owner from **People & access**.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { BackOffice } from '../backoffice/entities.ts';
import type { AuthStore, Role, User } from './store.ts';
import { ROLES } from './store.ts';
import { passwordProblem } from './passwords.ts';
import {
  clearSessionCookie,
  currentUser,
  readCookie,
  requireUser,
  SESSION_COOKIE,
  setSessionCookie,
} from './guard.ts';

export type AuthRouteDeps = {
  auth: AuthStore;
  backOffice: BackOffice;
};

/** Ten misses at the door per quarter hour, per address and address-of-email. */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

type Attempt = { count: number; firstAt: number };
const attempts = new Map<string, Attempt>();

function tooManyAttempts(key: string): boolean {
  const attempt = attempts.get(key);
  if (attempt === undefined) return false;
  if (Date.now() - attempt.firstAt > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return attempt.count >= MAX_ATTEMPTS;
}

function noteFailure(key: string): void {
  const attempt = attempts.get(key);
  if (attempt === undefined || Date.now() - attempt.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  attempt.count += 1;
}

/** Exposed for the tests, which must not inherit a lockout from each other. */
export function resetLoginAttempts(): void {
  attempts.clear();
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function publicUser(user: User, backOffice: BackOffice): Record<string, unknown> {
  const landlord = user.landlordId === null ? null : backOffice.getLandlord(user.landlordId);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    landlordId: user.landlordId,
    landlordName: landlord?.name ?? null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

type Body = Record<string, unknown>;

function signIn(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AuthRouteDeps,
  user: User,
  kind: string,
): void {
  const { token } = deps.auth.createSession(user.id, {
    ip: request.ip,
    userAgent: String(request.headers['user-agent'] ?? ''),
  });
  setSessionCookie(request, reply, token);
  deps.auth.record({ actor: user, kind, detail: request.ip });
}

function readRole(value: unknown): Role | null {
  const role = text(value);
  return (ROLES as readonly string[]).includes(role) ? (role as Role) : null;
}

/** The owner account, or the person asking — never somebody else. */
function readRoleOrProblem(value: unknown): Role | string {
  const role = text(value);
  if (!(ROLES as readonly string[]).includes(role)) return 'Choose a role: owner, agent or landlord.';
  return role as Role;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const { auth, backOffice } = deps;

  app.get('/api/auth/status', async (request) => {
    const found = auth.sessionUser(readCookie(request, SESSION_COOKIE));
    return {
      needsSetup: auth.needsSetup(),
      signedIn: found !== null,
      user: found === null ? null : publicUser(found.user, backOffice),
    };
  });

  app.get('/api/auth/me', async (request) => publicUser(requireUser(request), backOffice));

  /** First run: create the owner account, and sign in as it. */
  app.post('/api/auth/setup', async (request, reply) => {
    if (!auth.needsSetup()) {
      return reply.code(409).send({ error: 'This installation already has an account. Sign in instead.' });
    }

    const body = (request.body ?? {}) as Body;
    const name = text(body['name']);
    const email = text(body['email']);
    const password = typeof body['password'] === 'string' ? body['password'] : '';

    if (name === '') return reply.code(400).send({ error: 'What is your name?' });
    if (email === '' || !email.includes('@')) return reply.code(400).send({ error: 'That email address does not look right.' });
    const problem = passwordProblem(password);
    if (problem !== '') return reply.code(400).send({ error: problem });

    const user = await auth.createUser({ email, name, role: 'owner', password });
    auth.record({ actor: user, kind: 'auth.setup', detail: `${user.email} created the owner account` });
    signIn(request, reply, deps, user, 'auth.login');
    return reply.code(201).send({ user: publicUser(user, backOffice) });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = (request.body ?? {}) as Body;
    const email = text(body['email']).toLowerCase();
    const password = typeof body['password'] === 'string' ? body['password'] : '';

    const key = `${request.ip}|${email}`;
    if (tooManyAttempts(key)) {
      return reply.code(429).send({
        error: 'Too many attempts. Wait a quarter of an hour, or ask the owner to reset your password.',
      });
    }
    if (email === '' || password === '') {
      return reply.code(400).send({ error: 'Email and password, please.' });
    }

    const user = await auth.authenticate(email, password);
    if (user === null) {
      noteFailure(key);
      // A deliberate pause: it costs an honest person 300 ms and a script a lot.
      await new Promise((resolve) => setTimeout(resolve, 300));
      return reply.code(401).send({ error: 'That email address and password do not match an account.' });
    }

    attempts.delete(key);
    signIn(request, reply, deps, user, 'auth.login');
    return { user: publicUser(user, backOffice) };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = readCookie(request, SESSION_COOKIE);
    const user = currentUser(request);
    auth.revokeSession(token);
    clearSessionCookie(request, reply);
    if (user !== null) auth.record({ actor: user, kind: 'auth.logout', detail: request.ip });
    return { ok: true };
  });

  /** Change your own password: everything else signed in as you is signed out. */
  app.post('/api/auth/password', async (request, reply) => {
    const user = requireUser(request);
    const body = (request.body ?? {}) as Body;
    const current = typeof body['current'] === 'string' ? body['current'] : '';
    const next = typeof body['next'] === 'string' ? body['next'] : '';

    const confirmed = await auth.authenticate(user.email, current);
    if (confirmed === null) return reply.code(400).send({ error: 'Your current password is not right.' });

    const problem = passwordProblem(next);
    if (problem !== '') return reply.code(400).send({ error: problem });

    await auth.setPassword(user.id, next);
    const token = readCookie(request, SESSION_COOKIE);
    auth.signOutOthers(user.id, token);
    auth.record({ actor: user, kind: 'auth.password', detail: 'changed their own password' });
    return { ok: true };
  });

  app.get('/api/auth/sessions', async (request) => {
    const user = requireUser(request);
    const token = readCookie(request, SESSION_COOKIE);
    const mine = token === '' ? '' : auth.sessionIdFor(token);
    return {
      sessions: auth.listSessions(user.id).map((session) => ({
        id: session.id,
        current: session.id === mine,
        ip: session.ip,
        userAgent: session.userAgent,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
      })),
    };
  });

  // --- the log of what people did (owner only) ----------------------------

  app.get('/api/access/log', async () => ({
    events: auth.recentEvents(80).map((event) => ({
      id: event.id,
      actorName: event.actorName,
      kind: event.kind,
      detail: event.detail,
      at: event.at,
      packId: event.packId,
    })),
  }));

  // --- people (owner only; the guard enforces it) --------------------------

  app.get('/api/users', async () => ({
    users: auth.listUsers().map((user) => ({
      ...publicUser(user, backOffice),
      disabled: user.disabledAt !== null,
    })),
    landlords: backOffice.listLandlords().map((landlord) => ({ id: landlord.id, name: landlord.name })),
    roles: ROLES,
  }));

  app.post('/api/users', async (request, reply) => {
    const acting = requireUser(request);
    const body = (request.body ?? {}) as Body;
    const role = readRoleOrProblem(body['role']);
    if (!(ROLES as readonly string[]).includes(role)) {
      return reply.code(400).send({ error: role });
    }

    const password = typeof body['password'] === 'string' ? body['password'] : '';
    const problem = passwordProblem(password);
    if (problem !== '') return reply.code(400).send({ error: problem });

    const landlordId = role === 'landlord' ? text(body['landlordId']) : '';
    if (role === 'landlord' && (landlordId === '' || backOffice.getLandlord(landlordId) === null)) {
      return reply.code(400).send({ error: 'A landlord account has to be tied to a landlord record.' });
    }

    const name = text(body['name']);
    if (name === '') return reply.code(400).send({ error: 'What is their name?' });

    try {
      const user = await auth.createUser({
        email: text(body['email']),
        name,
        role: role as Role,
        password,
        landlordId: role === 'landlord' ? landlordId : null,
      });
      auth.record({ actor: acting, kind: 'user.created', detail: `${user.email} as ${role}` });
      return reply.code(201).send({ user: { ...publicUser(user, backOffice), disabled: false } });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.patch('/api/users/:id', async (request, reply) => {
    const acting = requireUser(request);
    const id = (request.params as { id: string }).id;
    const target = auth.getUser(id);
    if (target === null) return reply.code(404).send({ error: 'That person is not on the list.' });

    const body = (request.body ?? {}) as Body;
    let role: Role | undefined;
    if (body['role'] !== undefined) {
      const chosen = readRoleOrProblem(body['role']);
      if (typeof chosen === 'string' && !(ROLES as readonly string[]).includes(chosen)) {
        return reply.code(400).send({ error: chosen });
      }
      role = chosen as Role;
    }

    let landlordId: string | null | undefined;
    if (role === 'landlord') {
      const chosenLandlord = text(body['landlordId']);
      if (chosenLandlord === '' || backOffice.getLandlord(chosenLandlord) === null) {
        return reply.code(400).send({ error: 'A landlord account has to be tied to a landlord record.' });
      }
      landlordId = chosenLandlord;
    } else if (role !== undefined) {
      landlordId = null;
    }

    // Do not leave the installation without a working owner.
    if (target.role === 'owner' && role !== undefined && role !== 'owner') {
      const owners = auth.listUsers().filter((user) => user.role === 'owner' && user.disabledAt === null);
      if (owners.length <= 1) {
        return reply.code(400).send({ error: 'There has to be one owner. Make somebody else the owner first.' });
      }
    }

    const updated = auth.updateUser(id, {
      name: body['name'] === undefined ? undefined : text(body['name']),
      role,
      landlordId,
    });
    if (updated === null) return reply.code(404).send({ error: 'That person is not on the list.' });

    auth.record({ actor: acting, kind: 'user.updated', detail: `${updated.email}` });
    return { user: { ...publicUser(updated, backOffice), disabled: updated.disabledAt !== null } };
  });

  app.post('/api/users/:id/password', async (request, reply) => {
    const acting = requireUser(request);
    const id = (request.params as { id: string }).id;
    const target = auth.getUser(id);
    if (target === null) return reply.code(404).send({ error: 'That person is not on the list.' });

    const body = (request.body ?? {}) as Body;
    const password = typeof body['password'] === 'string' ? body['password'] : '';
    const problem = passwordProblem(password);
    if (problem !== '') return reply.code(400).send({ error: problem });

    await auth.setPassword(id, password);
    auth.revokeAllSessions(id);
    auth.record({ actor: acting, kind: 'user.password', detail: `${target.email}: password reset` });
    return { ok: true };
  });

  app.post('/api/users/:id/disabled', async (request, reply) => {
    const acting = requireUser(request);
    const id = (request.params as { id: string }).id;
    const target = auth.getUser(id);
    if (target === null) return reply.code(404).send({ error: 'That person is not on the list.' });
    if (target.id === acting.id) return reply.code(400).send({ error: 'You cannot switch your own account off.' });

    const body = (request.body ?? {}) as Body;
    const disabled = body['disabled'] === true;

    if (disabled && target.role === 'owner') {
      const owners = auth.listUsers().filter((user) => user.role === 'owner' && user.disabledAt === null);
      if (owners.length <= 1) return reply.code(400).send({ error: 'There has to be one working owner account.' });
    }

    auth.setDisabled(id, disabled);
    auth.record({
      actor: acting,
      kind: disabled ? 'user.disabled' : 'user.enabled',
      detail: target.email,
    });
    return { ok: true };
  });
}
