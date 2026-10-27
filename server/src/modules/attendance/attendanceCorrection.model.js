import mongoose from 'mongoose';

export const CORRECTION_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

/** Missing-punch / regularization request. Approval rewrites the attendance record (source: regularized). */
const attendanceCorrectionSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: Date, required: true },
    requestedCheckIn: { type: Date, required: true },
    requestedCheckOut: { type: Date, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: CORRECTION_STATUSES, default: 'pending' },
    // What the record looked like when the request was made (for reviewers and the audit trail).
    original: {
      checkIn: { type: Date, default: null },
      checkOut: { type: Date, default: null },
      status: { type: String, default: null },
    },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedByName: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true },
);

attendanceCorrectionSchema.index({ employee: 1, date: 1, status: 1 });
attendanceCorrectionSchema.index({ status: 1, createdAt: -1 });

export const AttendanceCorrection = mongoose.model('AttendanceCorrection', attendanceCorrectionSchema);
