import crypto from 'node:crypto';
import argon2 from 'argon2';
import { z } from 'zod';

// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane).
const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[a-z]/i.test(v) && /\d/.test(v), 'Password must contain at least one letter and one number');

export function hashPassword(password) {
  return argon2.hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash;
/** Burns comparable CPU time when the account does not exist, to reduce user enumeration by timing. */
export async function verifyDummy(password) {
  dummyHash ??= await hashPassword(crypto.randomBytes(16).toString('hex'));
  await verifyPassword(dummyHash, password);
  return false;
}

export function generateToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
