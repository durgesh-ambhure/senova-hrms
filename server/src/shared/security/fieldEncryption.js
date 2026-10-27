import crypto from 'node:crypto';
import { env } from '../../config/env.js';

const KEY = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
const VERSION = 'v1';

/**
 * AES-256-GCM field encryption for values that must be recoverable (bank account, PAN).
 * Output: "v1:<iv>:<tag>:<ciphertext>" (base64url parts). The version prefix allows key rotation.
 */
export function encryptField(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

export function decryptField(value) {
  if (!value) return null;
  const [version, iv, tag, ct] = value.split(':');
  if (version !== VERSION) throw new Error('Unsupported encryption version');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export const last4 = (value) => (value ? String(value).slice(-4) : null);
