import mongoose from 'mongoose';
import { Employee } from './employee.model.js';
import { hasPermission } from '../roles/permissions.js';

/** IDs of everyone reporting to `managerId`, directly or indirectly. */
export async function getReportIds(managerId) {
  const [row] = await Employee.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(String(managerId)) } },
    {
      $graphLookup: {
        from: 'employees',
        startWith: '$_id',
        connectFromField: '_id',
        connectToField: 'reportingManager',
        as: 'reports',
        maxDepth: 15,
      },
    },
    { $project: { ids: '$reports._id' } },
  ]);
  return new Set((row?.ids ?? []).map(String));
}

/**
 * Who the actor may see. Computed once per request.
 *  all  → employees:read:all
 *  team → direct and indirect reports (employees:read:team), limited fields
 *  self → own profile (any signed-in user with a linked employee record)
 */
export async function getEmployeeScope(req) {
  if (req.employeeScope) return req.employeeScope;
  const { auth } = req;
  const selfId = auth.user.employee ? String(auth.user.employee) : null;
  const all = hasPermission(auth.permissions, 'employees:read:all');
  let teamIds = new Set();
  if (!all && selfId && hasPermission(auth.permissions, 'employees:read:team')) teamIds = await getReportIds(selfId);
  req.employeeScope = { all, teamIds, selfId };
  return req.employeeScope;
}

/** 'full' | 'team' | null — the level of detail the actor may see for this employee. */
export function viewLevel(scope, employeeId) {
  const id = String(employeeId);
  if (scope.all || id === scope.selfId) return 'full';
  if (scope.teamIds.has(id)) return 'team';
  return null;
}

/** Mongo filter restricting a directory query to the actor's scope. */
export function scopeFilter(scope) {
  if (scope.all) return {};
  return { _id: { $in: [...scope.teamIds].map((id) => new mongoose.Types.ObjectId(id)) } };
}
