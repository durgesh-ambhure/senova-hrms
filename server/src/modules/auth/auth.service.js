import { User, toPublicUser } from '../users/user.model.js';
import { AuthToken } from './authToken.model.js';
import { resolvePermissions } from '../roles/role.service.js';
import { recordAudit } from '../audit/audit.service.js';
import { AppError, badRequest, unauthorized } from '../../shared/errors.js';
import { generateToken, hashPassword, hashToken, verifyDummy, verifyPassword } from '../../shared/security/password.js';
import { issueCsrfToken } from '../../shared/middleware/csrf.js';
import { sendMail } from '../../shared/mailer.js';
import { withTransaction } from '../../db/transaction.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
const TOKEN_TTL_MINUTES = { password_reset: 30, invite: 72 * 60 };

const invalidCredentials = () => unauthorized('Invalid email or password');

const regenerate = (req) => new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
const destroy = (req) => new Promise((resolve, reject) => req.session.destroy((e) => (e ? reject(e) : resolve())));

export async function buildSessionPayload(user) {
  const permissions = await resolvePermissions(user.roles);
  return { user: toPublicUser(user), permissions: [...permissions].sort() };
}

export async function login(req, { email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash +failedLoginCount +lockedUntil');
  if (!user || !user.passwordHash) {
    await verifyDummy(password);
    throw invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes or reset your password.`);
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    user.failedLoginCount += 1;
    if (user.failedLoginCount >= MAX_FAILED_LOGINS) {
      user.failedLoginCount = 0;
      user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
      await recordAudit(req, {
        action: 'auth.account_locked',
        entityType: 'User',
        entityId: user._id,
        summary: `Account locked after ${MAX_FAILED_LOGINS} failed sign-in attempts`,
        actor: user,
      });
    }
    await user.save();
    throw invalidCredentials();
  }
  // Disabled / not-yet-activated accounts get the same answer as a wrong password.
  if (user.status !== 'active') throw invalidCredentials();

  user.failedLoginCount = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  await regenerate(req);
  req.session.userId = String(user._id);
  req.session.authVersion = user.authVersion;
  const csrfToken = issueCsrfToken(req);

  await recordAudit(req, { action: 'auth.login', entityType: 'User', entityId: user._id, summary: 'Signed in', actor: user });
  return { ...(await buildSessionPayload(user.toObject())), csrfToken };
}

export async function logout(req) {
  const userId = req.session?.userId;
  if (userId) {
    const user = await User.findById(userId, { name: 1 }).lean();
    if (user) await recordAudit(req, { action: 'auth.logout', entityType: 'User', entityId: userId, summary: 'Signed out', actor: user });
  }
  await destroy(req);
}

/** Creates a single-use token, revoking older unused tokens of the same purpose. Returns the raw token. */
export async function issueToken(userId, purpose, session) {
  await AuthToken.updateMany({ user: userId, purpose, usedAt: null }, { $set: { usedAt: new Date() } }, { session });
  const { token, tokenHash } = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES[purpose] * 60_000);
  await AuthToken.create([{ user: userId, purpose, tokenHash, expiresAt }], { session });
  return token;
}

/** Sends an invitation email. Pass `token` when it was issued inside a transaction that has committed. */
export async function sendInvite(user, token) {
  token ??= await issueToken(user._id, 'invite');
  const link = `${env.APP_URL}/reset-password?token=${token}&invite=1`;
  await sendMail({
    to: user.email,
    subject: 'You have been invited to Senova HRMS',
    text: `Hello ${user.name},\n\nAn account has been created for you in Senova HRMS.\nSet your password within 72 hours using this link:\n\n${link}\n\nIf you were not expecting this, you can ignore this email.`,
  });
}

export async function sendPasswordReset(user) {
  const token = await issueToken(user._id, 'password_reset');
  const link = `${env.APP_URL}/reset-password?token=${token}`;
  await sendMail({
    to: user.email,
    subject: 'Reset your Senova HRMS password',
    text: `Hello ${user.name},\n\nUse this link within 30 minutes to reset your password:\n\n${link}\n\nIf you did not request this, you can ignore this email — your password will not change.`,
  });
}

/** Always resolves the same way so the response does not reveal whether the email exists. */
export async function forgotPassword(req, { email }) {
  const user = await User.findOne({ email, status: 'active' }).lean();
  if (!user) return;
  try {
    await sendPasswordReset(user);
    await recordAudit(req, {
      action: 'auth.password_reset_requested',
      entityType: 'User',
      entityId: user._id,
      summary: 'Password reset requested',
      actor: user,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to send password reset email');
  }
}

export async function resetPassword(req, { token, password }) {
  const record = await AuthToken.findOne({ tokenHash: hashToken(token), usedAt: null, expiresAt: { $gt: new Date() } });
  if (!record) throw badRequest('This link is invalid or has expired. Request a new one.');

  const passwordHash = await hashPassword(password);
  const purpose = record.purpose;
  await withTransaction(async (session) => {
    const user = await User.findById(record.user).session(session);
    if (!user || user.status === 'disabled') throw badRequest('This link is invalid or has expired. Request a new one.');
    // Mark this and every other outstanding token for the user as used.
    const used = await AuthToken.updateMany({ user: user._id, usedAt: null }, { $set: { usedAt: new Date() } }, { session });
    if (!used.modifiedCount) throw badRequest('This link has already been used.');

    user.passwordHash = passwordHash;
    user.passwordChangedAt = new Date();
    user.authVersion += 1;
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    if (user.status === 'invited') user.status = 'active';
    await user.save({ session });

    await recordAudit(
      req,
      {
        action: purpose === 'invite' ? 'auth.invite_accepted' : 'auth.password_reset',
        entityType: 'User',
        entityId: user._id,
        summary: purpose === 'invite' ? 'Account activated' : 'Password reset via email link',
        actor: user,
      },
      session,
    );
  });
  return { purpose };
}

export async function changePassword(req, { currentPassword, newPassword }) {
  const user = await User.findById(req.auth.user._id).select('+passwordHash');
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Validation failed', [{ in: 'body', path: 'currentPassword', message: 'Current password is incorrect' }]);
  }
  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.authVersion += 1;
  await user.save();
  // Other sessions are now invalid; keep this one.
  req.session.authVersion = user.authVersion;
  await recordAudit(req, { action: 'auth.password_changed', entityType: 'User', entityId: user._id, summary: 'Password changed' });
}
