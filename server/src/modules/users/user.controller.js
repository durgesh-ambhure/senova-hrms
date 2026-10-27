import * as userService from './user.service.js';
import { created, noContent, ok } from '../../shared/http.js';

export async function list(req, res) {
  const { items, meta } = await userService.listUsers(req.validatedQuery);
  return ok(res, items, meta);
}

export async function get(req, res) {
  return ok(res, await userService.getUser(req.params.id));
}

export async function create(req, res) {
  return created(res, await userService.createUser(req, req.body));
}

export async function update(req, res) {
  return ok(res, await userService.updateUser(req, req.params.id, req.body));
}

export async function resendInvite(req, res) {
  await userService.resendInvite(req, req.params.id);
  return noContent(res);
}

export async function sendResetLink(req, res) {
  await userService.sendResetLink(req, req.params.id);
  return noContent(res);
}

export async function revokeSessions(req, res) {
  await userService.revokeSessions(req, req.params.id);
  return noContent(res);
}
