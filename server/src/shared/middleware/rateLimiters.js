import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env.js';

const handler = (_req, res) =>
  res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } });

const common = { standardHeaders: 'draft-8', legacyHeaders: false, handler };

/** Whole-API ceiling to blunt scraping and accidental request storms. */
export const apiLimiter = rateLimit({ ...common, windowMs: 60_000, limit: 600 });

/** Login and password-reset endpoints. Per-account lockout is enforced in the auth service. */
export const authLimiter = rateLimit({ ...common, windowMs: 15 * 60_000, limit: env.AUTH_RATE_LIMIT });
