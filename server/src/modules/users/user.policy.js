import { SUPER_ADMIN, WILDCARD } from '../roles/permissions.js';
import { forbidden } from '../../shared/errors.js';

const isSuperAdmin = (auth) => auth.permissions.has(WILDCARD);

/**
 * Account-management guardrails against privilege escalation and self-lockout.
 * `target` is the user being changed (null on create); `changes` the validated update.
 */
export function assertCanChangeUser(auth, target, changes) {
  const touchesSuperAdmin =
    changes.roles?.includes(SUPER_ADMIN) || (target?.roles.includes(SUPER_ADMIN) && (changes.roles || changes.status));
  if (touchesSuperAdmin && !isSuperAdmin(auth)) {
    throw forbidden('Only a Super Admin can grant, revoke or change Super Admin accounts');
  }
  if (target && String(target._id) === String(auth.user._id) && (changes.roles || changes.status)) {
    throw forbidden('You cannot change your own roles or status');
  }
}
