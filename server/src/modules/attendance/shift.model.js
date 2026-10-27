import mongoose from 'mongoose';

const time = { type: String, required: true, match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:mm'] };

/**
 * A work schedule. Times are wall-clock times in the company time zone. A shift whose end is
 * earlier than its start runs overnight. Thresholds are provisional defaults (DECISIONS A1–A3).
 */
const shiftSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 12 },
    startTime: time,
    endTime: time,
    lateGraceMinutes: { type: Number, min: 0, max: 120, default: 15 },
    earlyLeaveGraceMinutes: { type: Number, min: 0, max: 120, default: 15 },
    fullDayMinutes: { type: Number, min: 60, max: 960, default: 480 },
    halfDayMinutes: { type: Number, min: 30, max: 720, default: 240 },
    // 0 = Sunday … 6 = Saturday
    weeklyOffs: { type: [Number], default: [0, 6], validate: [(v) => v.every((d) => d >= 0 && d <= 6) && new Set(v).size === v.length, 'Invalid weekly offs'] },
    isDefault: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

shiftSchema.index({ isDefault: 1 });

export const Shift = mongoose.model('Shift', shiftSchema);

/** Used only when no shift exists at all (fresh install): DECISIONS A1–A3 provisional defaults. */
export const FALLBACK_SHIFT = Object.freeze({
  _id: null,
  name: 'Standard (built-in)',
  code: 'STD',
  startTime: '09:30',
  endTime: '18:30',
  lateGraceMinutes: 15,
  earlyLeaveGraceMinutes: 15,
  fullDayMinutes: 480,
  halfDayMinutes: 240,
  weeklyOffs: [0, 6],
});

export const isOvernight = (shift) => shift.endTime <= shift.startTime;
