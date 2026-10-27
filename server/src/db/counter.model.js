import mongoose from 'mongoose';

/** Monotonic sequences (e.g. employee codes). Values are never reused, even after archival. */
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });

export const Counter = mongoose.model('Counter', counterSchema);

export async function nextSequence(key, session) {
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session },
  ).lean();
  return doc.seq;
}
