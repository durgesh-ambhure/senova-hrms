import mongoose from 'mongoose';
import { Employee } from './employee.model.js';
import { getReportIds } from './employee.policy.js';
import { hasPermission } from '../roles/permissions.js';
import { notFound } from '../../shared/errors.js';

/** The actor's own employee id, or null when the login has no employee profile. */
export const ownEmployeeId = (req) => (req.auth.user.employee ? String(req.auth.user.employee) : null);

/** Direct and indirect reports of the actor (cached per request). */
export async function myTeamIds(req) {
  if (!req.teamIds) {
    const me = ownEmployeeId(req);
    req.teamIds = me ? await getReportIds(me) : new Set();
  }
  return req.teamIds;
}

/**
 * Record-level scope for a module: `all` with the admin/read-all permission, otherwise the
 * actor's team (when they hold the team permission) plus themself (when `includeSelf`).
 */
export async function moduleScope(req, { allPermission, teamPermission, selfPermission }) {
  const can = (p) => p && hasPermission(req.auth.permissions, p);
  if (can(allPermission)) return { all: true, ids: null };
  const ids = new Set();
  if (can(teamPermission)) (await myTeamIds(req)).forEach((id) => ids.add(id));
  const me = ownEmployeeId(req);
  if (me && can(selfPermission)) ids.add(me);
  return { all: false, ids };
}

export const inScope = (scope, employeeId) => scope.all || scope.ids.has(String(employeeId));

export function scopeMatch(scope, field = 'employee') {
  if (scope.all) return {};
  return { [field]: { $in: [...scope.ids].map((id) => new mongoose.Types.ObjectId(id)) } };
}

/**
 * May the actor approve something for `employeeId`? Admins may (except for themselves); otherwise the
 * employee must be in the actor's team and the actor must hold the team-approval permission.
 */
export async function canApprove(req, employeeId, { adminPermission, teamPermission }) {
  if (String(employeeId) === ownEmployeeId(req)) return false;
  if (hasPermission(req.auth.permissions, adminPermission)) return true;
  return hasPermission(req.auth.permissions, teamPermission) && (await myTeamIds(req)).has(String(employeeId));
}

/** The actor's employee record, required for self-service actions. */
export async function requireOwnEmployee(req, projection) {
  const id = ownEmployeeId(req);
  const employee = id ? await Employee.findById(id, projection).lean() : null;
  if (!employee || employee.archivedAt) throw notFound('No employee profile is linked to your account');
  return employee;
}
