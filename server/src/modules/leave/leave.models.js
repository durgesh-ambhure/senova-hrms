import mongoose from 'mongoose';
import { EMPLOYMENT_TYPES } from '../employees/employee.model.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * Amounts of leave are stored as integer half-day UNITS (1 day = 2 units) so balances are exact
 * and never suffer floating-point drift.
 */
export const UNITS_PER_DAY = 2;

const leaveTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 10 },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    paid: { type: Boolean, default: true },
    // No balance is tracked (e.g. loss of pay). Usage is still recorded.
    unlimited: { type: Boolean, default: false },
    annualQuotaDays: { type: Number, min: 0, max: 365, default: 0 },
    // annual: whole (pro-rated) quota available from the start of the year; monthly: 1/12 per month.
    accrual: { type: String, enum: ['annual', 'monthly'], default: 'monthly' },
    carryForwardMaxDays: { type: Number, min: 0, max: 365, default: 0 },
    allowHalfDay: { type: Boolean, default: true },
    allowNegativeBalance: { type: Boolean, default: false },
    availableDuringProbation: { type: Boolean, default: true },
    // Empty = every employment type.
    employmentTypes: { type: [String], enum: EMPLOYMENT_TYPES, default: [] },
    maxConsecutiveDays: { type: Number, min: 1, max: 365, default: null },
    minNoticeDays: { type: Number, min: 0, max: 90, default: 0 },
    color: { type: String, match: /^#[0-9a-f]{6}$/i, default: '#3459ad' },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const LeaveType = mongoose.model('LeaveType', leaveTypeSchema);

/** One row per employee × leave type × (calendar) year. available = opening + accrued + adjusted − used − pending. */
const leaveBalanceSchema = new mongoose.Schema(
  {
    employee: { type: ObjectId, ref: 'Employee', required: true },
    leaveType: { type: ObjectId, ref: 'LeaveType', required: true },
    year: { type: Number, required: true },
    openingUnits: { type: Number, default: 0 },
    accruedUnits: { type: Number, default: 0 },
    adjustedUnits: { type: Number, default: 0 },
    usedUnits: { type: Number, default: 0 },
    pendingUnits: { type: Number, default: 0 },
    // Each manual adjustment, newest last (bounded; full trail also in the audit log).
    adjustments: {
      type: [{ units: Number, reason: String, by: { type: ObjectId, ref: 'User' }, byName: String, at: Date, _id: false }],
      default: [],
      validate: [(v) => v.length <= 100, 'Too many adjustments'],
    },
  },
  { timestamps: true },
);

leaveBalanceSchema.index({ employee: 1, leaveType: 1, year: 1 }, { unique: true });

export const LeaveBalance = mongoose.model('LeaveBalance', leaveBalanceSchema);

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'cancellation_requested'];
// Statuses that hold days (count towards overlap checks and balances).
export const ACTIVE_LEAVE_STATUSES = ['pending', 'approved', 'cancellation_requested'];

const leaveRequestSchema = new mongoose.Schema(
  {
    employee: { type: ObjectId, ref: 'Employee', required: true },
    leaveType: { type: ObjectId, ref: 'LeaveType', required: true },
    leaveTypeSnapshot: { name: String, code: String, paid: Boolean, unlimited: Boolean, color: String },
    year: { type: Number, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    startSession: { type: String, enum: ['full', 'second_half'], default: 'full' },
    endSession: { type: String, enum: ['full', 'first_half'], default: 'full' },
    units: { type: Number, required: true, min: 1 },
    // Exact days charged — the source of truth for balances, attendance and payroll.
    slots: {
      type: [{ date: Date, half: { type: String, enum: ['full', 'first', 'second'] }, units: Number, _id: false }],
      validate: [(v) => v.length >= 1 && v.length <= 400, 'Invalid leave period'],
    },
    reason: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: LEAVE_STATUSES, default: 'pending' },
    appliedBy: { type: ObjectId, ref: 'User', required: true },
    decidedBy: { type: ObjectId, ref: 'User', default: null },
    decidedByName: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, maxlength: 500, default: '' },
    cancellation: {
      requestedAt: { type: Date, default: null },
      reason: { type: String, trim: true, maxlength: 500, default: '' },
      decidedByName: { type: String, default: null },
      decidedAt: { type: Date, default: null },
      note: { type: String, trim: true, maxlength: 500, default: '' },
    },
  },
  { timestamps: true },
);

leaveRequestSchema.index({ employee: 1, startDate: 1 });
leaveRequestSchema.index({ status: 1, startDate: 1 });
leaveRequestSchema.index({ 'slots.date': 1, status: 1 });

export const LeaveRequest = mongoose.model('LeaveRequest', leaveRequestSchema);
