import { Role } from './role.model.js';
import { User } from '../users/user.model.js';
import { DEFAULT_ROLES, PERMISSION_KEYS, SUPER_ADMIN, WILDCARD, hasPermission } from './permissions.js';
import { conflict, forbidden, notFound, validationError } from '../../shared/errors.js';
import { diffFields, recordAudit } from '../audit/audit.service.js';

export function toPublicRole(role, userCount) {
  return {
    key: role.key,
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    isSystem: role.isSystem,
    editable: role.key !== SUPER_ADMIN,
    ...(userCount !== undefined ? { userCount } : {}),
    updatedAt: role.updatedAt,
  };
}

/** Union of permissions across the given role keys. */
export async function resolvePermissions(roleKeys) {
  if (!roleKeys?.length) return new Set();
  const roles = await Role.find({ key: { $in: roleKeys } }, { permissions: 1 }).lean();
  return new Set(roles.flatMap((r) => r.permissions));
}

/**
 * Idempotent: creates missing system roles, and adds permissions that newer releases introduced to
 * a role's defaults. Never re-adds a default an admin deliberately removed.
 */
export async function ensureDefaultRoles() {
  for (const role of DEFAULT_ROLES) {
    const existing = await Role.findOne({ key: role.key });
    if (!existing) {
      await Role.create({ ...role, isSystem: true, defaultsApplied: role.permissions });
      continue;
    }
    // Roles created before tracking existed (empty defaultsApplied) receive any missing defaults once.
    const applied = new Set(existing.defaultsApplied);
    const added = role.permissions.filter((p) => !applied.has(p));
    if (added.length) {
      existing.permissions = [...new Set([...existing.permissions, ...added])];
      existing.defaultsApplied = [...new Set([...applied, ...role.permissions])];
      await existing.save();
    }
  }
  // super_admin must always be exactly the wildcard.
  await Role.updateOne({ key: SUPER_ADMIN }, { $set: { permissions: [WILDCARD] } });
}

export async function listRoles() {
  const [roles, counts] = await Promise.all([
    Role.find().sort({ isSystem: -1, name: 1 }).lean(),
    User.aggregate([{ $unwind: '$roles' }, { $group: { _id: '$roles', count: { $sum: 1 } } }]),
  ]);
  const countByKey = new Map(counts.map((c) => [c._id, c.count]));
  return roles.map((r) => toPublicRole(r, countByKey.get(r.key) ?? 0));
}

export async function assertRolesExist(roleKeys) {
  const found = await Role.countDocuments({ key: { $in: roleKeys } });
  if (found !== new Set(roleKeys).size) throw validationError([{ path: 'roles', message: 'One or more roles do not exist' }]);
}

function assertGrantable(actorPermissions, permissions) {
  const unknown = permissions.filter((p) => !PERMISSION_KEYS.has(p));
  if (unknown.length) throw validationError([{ path: 'permissions', message: `Unknown permissions: ${unknown.join(', ')}` }]);
  // Anti-escalation: an actor may only grant permissions they hold themselves.
  const notHeld = permissions.filter((p) => !hasPermission(actorPermissions, p));
  if (notHeld.length) throw forbidden('You cannot grant permissions you do not hold');
}

export async function createRole(req, input) {
  assertGrantable(req.auth.permissions, input.permissions);
  if (await Role.exists({ key: input.key })) throw conflict('A role with this key already exists');
  const role = await Role.create({ ...input, isSystem: false, createdBy: req.auth.user._id, updatedBy: req.auth.user._id });
  await recordAudit(req, {
    action: 'role.created',
    entityType: 'Role',
    entityId: role.key,
    summary: `Created role ${role.name}`,
    changes: { permissions: { from: [], to: role.permissions } },
  });
  return toPublicRole(role.toObject(), 0);
}

export async function updateRole(req, key, input) {
  if (key === SUPER_ADMIN) throw forbidden('The Super Admin role cannot be modified');
  const role = await Role.findOne({ key });
  if (!role) throw notFound('Role not found');
  if (input.permissions) assertGrantable(req.auth.permissions, input.permissions);
  const before = role.toObject();
  Object.assign(role, input, { updatedBy: req.auth.user._id });
  await role.save();
  await recordAudit(req, {
    action: 'role.updated',
    entityType: 'Role',
    entityId: role.key,
    summary: `Updated role ${role.name}`,
    changes: diffFields(before, role.toObject(), ['name', 'description', 'permissions']),
  });
  return toPublicRole(role.toObject());
}

export async function deleteRole(req, key) {
  const role = await Role.findOne({ key });
  if (!role) throw notFound('Role not found');
  if (role.isSystem) throw forbidden('System roles cannot be deleted');
  if (await User.exists({ roles: key })) throw conflict('Remove this role from all users before deleting it');
  await role.deleteOne();
  await recordAudit(req, { action: 'role.deleted', entityType: 'Role', entityId: key, summary: `Deleted role ${role.name}` });
}
