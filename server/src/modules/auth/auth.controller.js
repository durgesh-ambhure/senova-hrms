import * as authService from './auth.service.js';
import { issueCsrfToken } from '../../shared/middleware/csrf.js';
import { noContent, ok } from '../../shared/http.js';
import { SESSION_COOKIE } from '../../config/session.js';

export function csrf(req, res) {
  return ok(res, { csrfToken: req.session.csrfToken ?? issueCsrfToken(req) });
}

export async function login(req, res) {
  return ok(res, await authService.login(req, req.body));
}

export async function logout(req, res) {
  await authService.logout(req);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  return noContent(res);
}

export async function me(req, res) {
  return ok(res, await authService.buildSessionPayload(req.auth.user));
}

export async function forgotPassword(req, res) {
  await authService.forgotPassword(req, req.body);
  return ok(res, { message: 'If an active account exists for that email, a reset link has been sent.' });
}

export async function resetPassword(req, res) {
  return ok(res, await authService.resetPassword(req, req.body));
}

export async function changePassword(req, res) {
  await authService.changePassword(req, req.body);
  return noContent(res);
}
