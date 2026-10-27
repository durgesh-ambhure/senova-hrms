import mongoose from 'mongoose';

/**
 * Runs `work(session)` inside a MongoDB transaction with automatic retry on transient errors.
 * Requires a replica set (Atlas, self-hosted replica set, or `npm run db:dev`).
 * Pass an existing `session` to join a transaction the caller already started.
 */
export async function withTransaction(work, { session: outer } = {}) {
  if (outer) return work(outer);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
