import mongoose from 'mongoose';

export const EVENT_TYPES = [
  'created',
  'joined',
  'department_changed',
  'designation_changed',
  'manager_changed',
  'employment_type_changed',
  'location_changed',
  'shift_changed',
  'probation_confirmed',
  'probation_extended',
  'notice_started',
  'notice_withdrawn',
  'exited',
  'archived',
  'restored',
];

/** Employment history: one immutable row per change, kept out of the employee document. */
const employmentEventSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    type: { type: String, enum: EVENT_TYPES, required: true },
    effectiveDate: { type: Date, required: true },
    from: { type: String, default: null },
    to: { type: String, default: null },
    note: { type: String, maxlength: 500, default: '' },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

employmentEventSchema.index({ employee: 1, effectiveDate: -1, createdAt: -1 });

export const EmploymentEvent = mongoose.model('EmploymentEvent', employmentEventSchema);
