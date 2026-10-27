import * as roleService from './role.service.js';
import { PERMISSIONS } from './permissions.js';
import { created, noContent, ok } from '../../shared/http.js';

export async function list(_req, res) {
  return ok(res, await roleService.listRoles());
}

export function permissions(_req, res) {
  return ok(res, PERMISSIONS);
}

export async function create(req, res) {
  return created(res, await roleService.createRole(req, req.body));
}

export async function update(req, res) {
  return ok(res, await roleService.updateRole(req, req.params.key, req.body));
}

export async function remove(req, res) {
  await roleService.deleteRole(req, req.params.key);
  return noContent(res);
}
