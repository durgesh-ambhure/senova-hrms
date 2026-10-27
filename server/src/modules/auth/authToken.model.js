import mongoose from 'mongoose';

export const TOKEN_PURPOSES = ['password_reset', 'invite'];

/** Single-use, expiring tokens. Only the SHA-256 hash of the token is stored. */
const authTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, enum: TOKEN_PURPOSES, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// MongoDB removes expired tokens automatically.
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthToken = mongoose.model('AuthToken', authTokenSchema);
