import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;
const money = { type: Number, default: 0 }; // integer paise
const month = { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ };

/**
 * Versioned payroll rule settings (DECISIONS P3–P9). Statutory values ship EMPTY and disabled: the
 * company's CA must enter and confirm them. Active versions are immutable; changes create a new
 * version. Percentages are basis points (1200 = 12%).
 */
const ruleSetSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true, unique: true },
    effectiveFrom: month,
    status: { type: String, enum: ['draft', 'active'], default: 'draft' },
    template: {
      basicBpOfGross: { type: Number, min: 0, max: 10_000, default: 5000 },
      hraBpOfBasic: { type: Number, min: 0, max: 10_000, default: 4000 },
    },
    pf: {
      enabled: { type: Boolean, default: false },
      employeeBp: { type: Number, min: 0, max: 10_000, default: 0 },
      employerBp: { type: Number, min: 0, max: 10_000, default: 0 },
      // Part of the employer share that goes to the pension scheme, capped at epsCeilingPaise.
      epsBp: { type: Number, min: 0, max: 10_000, default: 0 },
      wageCeilingPaise: { type: Number, min: 0, default: 0 },
      epsCeilingPaise: { type: Number, min: 0, default: 0 },
    },
    esi: {
      enabled: { type: Boolean, default: false },
      employeeBp: { type: Number, min: 0, max: 10_000, default: 0 },
      employerBp: { type: Number, min: 0, max: 10_000, default: 0 },
      wageLimitPaise: { type: Number, min: 0, default: 0 },
    },
    pt: {
      enabled: { type: Boolean, default: false },
      state: { type: String, default: 'MH' },
      slabs: {
        type: [{ fromPaise: Number, toPaise: { type: Number, default: null }, monthlyPaise: Number, februaryPaise: { type: Number, default: null }, _id: false }],
        default: [],
        validate: [(v) => v.length <= 20, 'At most 20 slabs'],
      },
    },
    gratuity: { bpOfBasic: { type: Number, min: 0, max: 10_000, default: 0 } },
    lop: { includeAbsence: { type: Boolean, default: true } },
    notes: { type: String, maxlength: 2000, default: '' },
    verification: {
      verifiedBy: { type: ObjectId, ref: 'User', default: null },
      verifiedByName: { type: String, default: null },
      verifiedAt: { type: Date, default: null },
      reference: { type: String, maxlength: 500, default: '' },
    },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'payrollRuleSets' },
);
ruleSetSchema.index({ status: 1, effectiveFrom: -1 });
export const PayrollRuleSet = mongoose.model('PayrollRuleSet', ruleSetSchema);

/** An effective-dated salary (P3). The newest revision on or before a date applies. */
const salaryRevisionSchema = new mongoose.Schema(
  {
    employee: { type: ObjectId, ref: 'Employee', required: true },
    revisionNo: { type: Number, required: true },
    effectiveFrom: { type: Date, required: true },
    annualCtcPaise: { type: Number, required: true, min: 0 },
    // Overrides of the template; null = use the rule set's template.
    basicBpOfGross: { type: Number, min: 0, max: 10_000, default: null },
    hraBpOfBasic: { type: Number, min: 0, max: 10_000, default: null },
    fixedAllowances: {
      type: [{ code: String, label: String, monthlyPaise: Number, pfWage: { type: Boolean, default: false }, _id: false }],
      default: [],
      validate: [(v) => v.length <= 10, 'At most 10 fixed allowances'],
    },
    pfApplicable: { type: Boolean, default: true },
    // P4: contributions on wages above the ceiling only by explicit opt-in.
    pfOnFullWage: { type: Boolean, default: false },
    // Monthly breakdown computed when the revision was saved (for display; payroll recomputes per run).
    breakdown: { type: mongoose.Schema.Types.Mixed, required: true },
    ruleVersion: { type: Number, required: true },
    reason: { type: String, trim: true, maxlength: 500, default: '' },
    // Set when a finalized run paid the arrears for this (back-dated) revision (P12).
    arrearsSettledRun: { type: ObjectId, ref: 'PayrollRun', default: null },
    createdBy: { type: ObjectId, ref: 'User' },
    createdByName: String,
  },
  { timestamps: true, collection: 'salaryRevisions' },
);
salaryRevisionSchema.index({ employee: 1, effectiveFrom: -1, revisionNo: -1 });
salaryRevisionSchema.index({ employee: 1, revisionNo: 1 }, { unique: true });
export const SalaryRevision = mongoose.model('SalaryRevision', salaryRevisionSchema);

/** Current-salary summary per employee, maintained alongside revisions for fast listing. */
const salaryStructureSchema = new mongoose.Schema(
  {
    employee: { type: ObjectId, ref: 'Employee', required: true, unique: true },
    currentRevision: { type: ObjectId, ref: 'SalaryRevision', required: true },
    annualCtcPaise: { type: Number, required: true },
    effectiveFrom: { type: Date, required: true },
    revisionCount: { type: Number, default: 1 },
  },
  { timestamps: true, collection: 'salaryStructures' },
);
export const SalaryStructure = mongoose.model('SalaryStructure', salaryStructureSchema);

// Runs

export const RUN_STATUSES = ['draft', 'calculated', 'under_review', 'approved', 'finalized', 'cancelled'];

const payrollRunSchema = new mongoose.Schema(
  {
    month,
    type: { type: String, enum: ['regular', 'supplementary'], default: 'regular' },
    sequence: { type: Number, default: 0 },
    reason: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: RUN_STATUSES, default: 'draft' },
    payDate: { type: Date, default: null },
    ruleSet: { type: ObjectId, ref: 'PayrollRuleSet', default: null },
    ruleVersion: { type: Number, default: null },
    totals: {
      employees: { type: Number, default: 0 },
      grossPaise: money,
      deductionsPaise: money,
      netPaise: money,
      employerCostPaise: money,
      roundingPaise: money,
    },
    issues: { blockers: { type: Number, default: 0 }, warnings: { type: Number, default: 0 } },
    skipped: { type: [{ employee: { type: ObjectId, ref: 'Employee' }, name: String, reason: String, _id: false }], default: [] },
    preparedBy: { type: ObjectId, ref: 'User', required: true },
    preparedByName: String,
    calculatedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    approvedBy: { type: ObjectId, ref: 'User', default: null },
    approvedByName: String,
    approvedAt: { type: Date, default: null },
    approvalNote: { type: String, maxlength: 500, default: '' },
    finalizedBy: { type: ObjectId, ref: 'User', default: null },
    finalizedByName: String,
    finalizedAt: { type: Date, default: null },
    returnNote: { type: String, maxlength: 500, default: '' },
    history: { type: [{ status: String, byName: String, at: Date, note: String, _id: false }], default: [] },
  },
  { timestamps: true, optimisticConcurrency: true },
);
// One live regular run per month (P1). Cancelled runs don't block a new one.
payrollRunSchema.index({ month: 1, type: 1 }, { unique: true, partialFilterExpression: { type: 'regular', status: { $in: ['draft', 'calculated', 'under_review', 'approved', 'finalized'] } } });
payrollRunSchema.index({ month: -1, createdAt: -1 });
export const PayrollRun = mongoose.model('PayrollRun', payrollRunSchema);

const lineSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: ['earning', 'deduction', 'employer', 'rounding'], required: true },
    amountPaise: { type: Number, required: true },
    basis: { type: String, default: '' },
  },
  { _id: false },
);

/** One employee's calculation in a run, with every input needed to reproduce it. */
const payrollEntrySchema = new mongoose.Schema(
  {
    run: { type: ObjectId, ref: 'PayrollRun', required: true },
    employee: { type: ObjectId, ref: 'Employee', required: true },
    month,
    employeeSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    lines: { type: [lineSchema], default: [] },
    totals: {
      grossPaise: money,
      deductionsPaise: money,
      netBeforeRoundingPaise: money,
      roundingPaise: money,
      netPaise: money,
      employerCostPaise: money,
    },
    inputs: { type: mongoose.Schema.Types.Mixed, required: true },
    warnings: { type: [String], default: [] },
    // Problems that block submitting the run for review (e.g. negative net pay).
    blockers: { type: [String], default: [] },
    ruleVersion: { type: Number, required: true },
  },
  { timestamps: true },
);
payrollEntrySchema.index({ run: 1, employee: 1 }, { unique: true });
payrollEntrySchema.index({ employee: 1, month: -1 });
export const PayrollEntry = mongoose.model('PayrollEntry', payrollEntrySchema);

/** Per-run inputs entered by the Payroll Admin: imported TDS (P7) and one-off earnings/deductions. */
const payrollAdjustmentSchema = new mongoose.Schema(
  {
    run: { type: ObjectId, ref: 'PayrollRun', required: true },
    employee: { type: ObjectId, ref: 'Employee', required: true },
    kind: { type: String, enum: ['tds', 'earning', 'deduction'], required: true },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    amountPaise: { type: Number, required: true, min: 1 },
    reason: { type: String, trim: true, maxlength: 300, default: '' },
    createdBy: { type: ObjectId, ref: 'User' },
    createdByName: String,
  },
  { timestamps: true },
);
payrollAdjustmentSchema.index({ run: 1, employee: 1 });
export const PayrollAdjustment = mongoose.model('PayrollAdjustment', payrollAdjustmentSchema);

/** Immutable payslip snapshot created at finalization; PDFs are rendered from it on demand. */
const payslipSchema = new mongoose.Schema(
  {
    run: { type: ObjectId, ref: 'PayrollRun', required: true },
    entry: { type: ObjectId, ref: 'PayrollEntry', required: true },
    employee: { type: ObjectId, ref: 'Employee', required: true },
    month,
    runType: { type: String, enum: ['regular', 'supplementary'], required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
payslipSchema.index({ run: 1, employee: 1 }, { unique: true });
payslipSchema.index({ employee: 1, month: -1 });
export const Payslip = mongoose.model('Payslip', payslipSchema);
