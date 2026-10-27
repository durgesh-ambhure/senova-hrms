import crypto from 'node:crypto';
import { AppError } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfToken(req) {
  req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Synchronizer-token CSRF protection for every state-changing request. */
export function csrfProtection(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const expected = req.session?.csrfToken;
  const provided = req.get('x-csrf-token');
  if (!expected || !provided || !safeEqual(expected, provided)) {
    return next(new AppError(403, 'CSRF_INVALID', 'Your session security token is missing or expired. Refresh the page and try again.'));
  }
  return next();
}
