import mongoose from 'mongoose';

export const USER_STATUSES = ['invited', 'active', 'disabled'];

/**
 * A login account. Deliberately separate from the employee profile (Phase 2): not every employee
 * needs a login, and some accounts (e.g. external recruiters) are not employees.
 */
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, select: false, default: null },
    roles: { type: [String], default: ['employee'] },
    status: { type: String, enum: USER_STATUSES, default: 'invited', index: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    // Incremented to invalidate every existing session (password change, disable, sign out everywhere).
    authVersion: { type: Number, default: 0 },
    failedLoginCount: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

userSchema.index({ roles: 1 });
userSchema.index({ employee: 1 }, { unique: true, partialFilterExpression: { employee: { $type: 'objectId' } } });

/** Shape returned by the API. Never includes hashes, lockout counters or auth versions. */
export function toPublicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    roles: user.roles,
    status: user.status,
    employee: user.employee ? String(user.employee) : null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export const User = mongoose.model('User', userSchema);
