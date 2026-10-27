import { User } from '../../modules/users/user.model.js';
import { resolvePermissions } from '../../modules/roles/role.service.js';
import { hasPermission } from '../../modules/roles/permissions.js';
import { forbidden, unauthorized } from '../errors.js';

/**
 * Loads the signed-in user on every request (so role changes and disabling take effect
 * immediately) and rejects sessions whose authVersion is stale.
 */
export async function authenticate(req, _res, next) {
  const { userId, authVersion } = req.session ?? {};
  if (!userId) return next(unauthorized());

  const user = await User.findById(userId).lean();
  if (!user || user.status !== 'active' || user.authVersion !== authVersion) {
    delete req.session.userId;
    delete req.session.authVersion;
    return next(unauthorized('Your session has expired. Please sign in again.'));
  }

  req.auth = { user, permissions: await resolvePermissions(user.roles) };
  return next();
}

/** Requires every listed permission. */
export function authorize(...required) {
  return (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    const missing = required.filter((p) => !hasPermission(req.auth.permissions, p));
    return next(missing.length ? forbidden() : undefined);
  };
}

/** Requires at least one of the listed permissions (scoped access resolved later by a policy). */
export function authorizeAny(...options) {
  return (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    return next(options.some((p) => hasPermission(req.auth.permissions, p)) ? undefined : forbidden());
  };
}
