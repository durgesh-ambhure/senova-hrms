import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 12 },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export const Project = mongoose.model('Project', projectSchema);

export const TIMESHEET_STATUSES = ['draft', 'submitted', 'approved', 'rejected'];
export const MAX_ENTRIES = 100;

/** One weekly timesheet (Monday–Sunday) per employee. Editable only as draft or after rejection. */
const timesheetSchema = new mongoose.Schema(
  {
    employee: { type: ObjectId, ref: 'Employee', required: true },
    weekStart: { type: Date, required: true },
    entries: {
      type: [
        {
          date: { type: Date, required: true },
          project: { type: ObjectId, ref: 'Project', required: true },
          task: { type: String, trim: true, maxlength: 120, default: '' },
          minutes: { type: Number, required: true, min: 1, max: 1440 },
          note: { type: String, trim: true, maxlength: 300, default: '' },
        },
      ],
      default: [],
      validate: [(v) => v.length <= MAX_ENTRIES, `At most ${MAX_ENTRIES} entries per week`],
    },
    totalMinutes: { type: Number, default: 0 },
    status: { type: String, enum: TIMESHEET_STATUSES, default: 'draft' },
    submittedAt: { type: Date, default: null },
    decidedBy: { type: ObjectId, ref: 'User', default: null },
    decidedByName: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    comment: { type: String, trim: true, maxlength: 500, default: '' },
    history: {
      type: [{ status: String, byName: String, at: Date, comment: String, _id: false }],
      default: [],
      validate: [(v) => v.length <= 50, 'Too many status changes'],
    },
  },
  { timestamps: true },
);

timesheetSchema.index({ employee: 1, weekStart: 1 }, { unique: true });
timesheetSchema.index({ status: 1, weekStart: -1 });
timesheetSchema.index({ 'entries.project': 1, weekStart: 1 });

export const Timesheet = mongoose.model('Timesheet', timesheetSchema);
