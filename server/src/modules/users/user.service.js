import { User, toPublicUser } from './user.model.js';
import { assertCanChangeUser } from './user.policy.js';
import { assertRolesExist } from '../roles/role.service.js';
import { SUPER_ADMIN } from '../roles/permissions.js';
import { issueToken, sendInvite, sendPasswordReset } from '../auth/auth.service.js';
import { diffFields, recordAudit } from '../audit/audit.service.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { escapeRegex, paginate } from '../../shared/pagination.js';
import { withTransaction } from '../../db/transaction.js';

export async function listUsers({ page, limit, sort, search, status, role }) {
  const filter = {};
  if (status) filter.status = status;
  if (role) filter.roles = role;
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const { items, meta } = await paginate(User, filter, { page, limit, sort });
  return { items: items.map(toPublicUser), meta };
}

export async function getUser(id) {
  const user = await User.findById(id).lean();
  if (!user) throw notFound('User not found');
  return toPublicUser(user);
}

export async function createUser(req, input) {
  assertCanChangeUser(req.auth, null, input);
  await assertRolesExist(input.roles);
  if (await User.exists({ email: input.email })) throw conflict('A user with this email already exists');

  let inviteToken;
  const user = await withTransaction(async (session) => {
    const [created] = await User.create(
      [{ ...input, status: 'invited', createdBy: req.auth.user._id, updatedBy: req.auth.user._id }],
      { session },
    );
    await recordAudit(
      req,
      {
        action: 'user.created',
        entityType: 'User',
        entityId: created._id,
        summary: `Invited ${created.email}`,
        changes: { roles: { from: [], to: created.roles } },
      },
      session,
    );
    inviteToken = await issueToken(created._id, 'invite', session);
    return created;
  });

  // Email only after commit, so a rolled-back user never receives a link.
  let inviteSent = true;
  try {
    await sendInvite(user, inviteToken);
  } catch (err) {
    inviteSent = false;
    req.log?.error({ err }, 'Failed to send invitation email');
  }
  return { ...toPublicUser(user.toObject()), inviteSent };
}

async function assertNotLastSuperAdmin(target, changes, session) {
  const losesSuperAdmin =
    target.roles.includes(SUPER_ADMIN) &&
    ((changes.roles && !changes.roles.includes(SUPER_ADMIN)) || changes.status === 'disabled');
  if (!losesSuperAdmin) return;
  const others = await User.countDocuments({ _id: { $ne: target._id }, roles: SUPER_ADMIN, status: 'active' }).session(session);
  if (others === 0) throw conflict('At least one active Super Admin must remain');
}

export async function updateUser(req, id, changes) {
  if (changes.roles) await assertRolesExist(changes.roles);
  const updated = await withTransaction(async (session) => {
    const user = await User.findById(id).session(session);
    if (!user) throw notFound('User not found');
    assertCanChangeUser(req.auth, user, changes);
    if (changes.status === 'active' && user.status === 'invited') {
      throw badRequest('Invited users become active by accepting their invitation');
    }
    await assertNotLastSuperAdmin(user, changes, session);

    const before = user.toObject();
    Object.assign(user, changes, { updatedBy: req.auth.user._id });
    // Role or status changes take effect immediately: existing sessions are invalidated.
    if (changes.status === 'disabled' || (changes.roles && JSON.stringify(changes.roles) !== JSON.stringify(before.roles))) {
      user.authVersion += 1;
    }
    await user.save({ session });
    await recordAudit(
      req,
      {
        action: changes.status && changes.status !== before.status ? `user.${changes.status === 'disabled' ? 'disabled' : 'enabled'}` : 'user.updated',
        entityType: 'User',
        entityId: user._id,
        summary: `Updated ${user.email}`,
        changes: diffFields(before, user.toObject(), ['name', 'roles', 'status']),
      },
      session,
    );
    return user;
  });
  return toPublicUser(updated.toObject());
}

export async function resendInvite(req, id) {
  const user = await User.findById(id);
  if (!user) throw notFound('User not found');
  if (user.status !== 'invited') throw badRequest('Only invited users can receive a new invitation');
  await sendInvite(user);
  await recordAudit(req, { action: 'user.invite_resent', entityType: 'User', entityId: user._id, summary: `Re-sent invitation to ${user.email}` });
}

export async function sendResetLink(req, id) {
  const user = await User.findById(id);
  if (!user) throw notFound('User not found');
  if (user.status !== 'active') throw badRequest('Only active users can reset their password');
  await sendPasswordReset(user);
  await recordAudit(req, { action: 'user.password_reset_sent', entityType: 'User', entityId: user._id, summary: `Sent password reset link to ${user.email}` });
}

/** Signs the user out of every device. */
export async function revokeSessions(req, id) {
  const user = await User.findByIdAndUpdate(id, { $inc: { authVersion: 1 } }, { returnDocument: 'after' });
  if (!user) throw notFound('User not found');
  await recordAudit(req, { action: 'user.sessions_revoked', entityType: 'User', entityId: user._id, summary: `Signed ${user.email} out of all sessions` });
}
