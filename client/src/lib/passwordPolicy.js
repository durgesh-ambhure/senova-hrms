import { z } from 'zod';

/** Mirrors the server policy in server/src/shared/security/password.js. The server stays authoritative. */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[a-z]/i.test(v) && /\d/.test(v), 'Password must contain at least one letter and one number');

export const emailSchema = z.string().trim().min(1, 'Email is required').pipe(z.email('Enter a valid email address'));
