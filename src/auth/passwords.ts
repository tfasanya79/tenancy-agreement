/**
 * Passwords.
 *
 * scrypt, from Node's own `node:crypto` — no dependency, and memory-hard, so a
 * stolen database is not a list of readable passwords. The stored string carries
 * its own parameters, so they can be raised later without invalidating accounts
 * that already exist.
 *
 * Format: `scrypt$N$r$p$<salt base64>$<hash base64>`
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

type ScryptOptions = { N: number; r: number; p: number; maxmem: number };

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/** ~32 MB and roughly 80 ms per hash on a modest server. */
const PARAMS: ScryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

/** The shortest password the app will accept. A phrase beats a puzzle. */
export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(saltRaw ?? '', 'base64');
  const expected = Buffer.from(hashRaw ?? '', 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: Math.max(PARAMS.maxmem, 128 * N * r * 2),
    });
  } catch {
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Why a password is not acceptable, in words the person can act on — or an empty
 * string when it is fine. Length is the only rule worth enforcing: complexity
 * rules push people towards `Passw0rd!`, which is worse than a short phrase.
 */
export function passwordProblem(password: string): string {
  const value = password.trim();
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters — three unconnected words is a good password.`;
  }
  if (value.length > 200) return 'That is too long; keep it under 200 characters.';
  if (/^(.)\1+$/.test(value)) return 'That is one character repeated. Choose something a person could not guess.';
  return '';
}
