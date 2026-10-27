import mongoose from 'mongoose';

export const ATTENDANCE_STATUSES = ['present', 'half_day', 'absent', 'incomplete'];
export const MAX_BREAKS = 10;

const shiftSnapshotSchema = new mongoose.Schema(
  {
    shift: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', default: null },
    name: String,
    startTime: String,
    endTime: String,
    lateGraceMinutes: Number,
    earlyLeaveGraceMinutes: Number,
    fullDayMinutes: Number,
    halfDayMinutes: Number,
    weeklyOffs: [Number],
  },
  { _id: false },
);

/**
 * One row per employee per attendance date (the calendar date the shift starts on).
 * The shift is snapshotted so later shift edits don't change past calculations.
 */
const attendanceRecordSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: Date, required: true },
    shift: { type: shiftSnapshotSchema, required: true },
    checkIn: { type: Date, default: null },
    checkOut: { type: Date, default: null },
    breaks: {
      type: [{ start: { type: Date, required: true }, end: { type: Date, default: null }, _id: false }],
      default: [],
      validate: [(v) => v.length <= MAX_BREAKS, `At most ${MAX_BREAKS} breaks per day`],
    },
    workedMinutes: { type: Number, default: 0 },
    breakMinutes: { type: Number, default: 0 },
    lateByMinutes: { type: Number, default: 0 },
    earlyByMinutes: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    status: { type: String, enum: ATTENDANCE_STATUSES, default: 'incomplete' },
    source: { type: String, enum: ['web', 'regularized'], default: 'web' },
    correction: { type: mongoose.Schema.Types.ObjectId, ref: 'AttendanceCorrection', default: null },
    // Set when a finalized payroll has consumed this record (Phase 5); locked records cannot change.
    lockedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

attendanceRecordSchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceRecordSchema.index({ date: 1 });

export const AttendanceRecord = mongoose.model('AttendanceRecord', attendanceRecordSchema);
