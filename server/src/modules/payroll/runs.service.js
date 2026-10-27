import { PayrollAdjustment, PayrollEntry, PayrollRuleSet, PayrollRun, SalaryRevision } from './payroll.models.js';
import { arrearsForMonth, computeEarnings, computeEntry, salaryBreakdown } from './payroll.engine.js';
import { rulesForMonth } from './rules.service.js';
import { revisionInput } from './salary.service.js';
import { createPayslips } from './payslips.service.js';
import { AttendanceRecord } from '../attendance/attendanceRecord.model.js';
import { buildMonthlySummary } from '../attendance/attendance.service.js';
import { Employee } from '../employees/employee.model.js';
import { getSettings } from '../company/company.service.js';
import { recordAudit } from '../audit/audit.service.js';
import { withTransaction } from '../../db/transaction.js';
import { badRequest, conflict, forbidden, notFound, validationError } from '../../shared/errors.js';
import { escapeRegex } from '../../shared/pagination.js';
import { addDays, eachDate, monthRange, parseDateOnly, toDateOnly, todayIn } from '../../shared/dates.js';
import { paiseToRupees } from '../../shared/money.js';

const EARNING_CODES = (code) => !code.startsWith('ARR_') && !code.startsWith('ADJ_');
const label = (s) => s.replace('_', ' ');
const nextMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

// Shapes

const rupeeTotals = (t) => ({
  employees: t.employees,
  gross: paiseToRupees(t.grossPaise),
  deductions: paiseToRupees(t.deductionsPaise),
  net: paiseToRupees(t.netPaise),
  employerCost: paiseToRupees(t.employerCostPaise),
  rounding: paiseToRupees(t.roundingPaise),
});

export function toPublicRun(r, extra = {}) {
  return {
    id: String(r._id),
    month: r.month,
    type: r.type,
    sequence: r.sequence,
    reason: r.reason,
    status: r.status,
    payDate: toDateOnly(r.payDate),
    ruleVersion: r.ruleVersion,
    totals: rupeeTotals(r.totals),
    issues: r.issues,
    skipped: r.skipped.map((s) => ({ employee: String(s.employee), name: s.name, reason: s.reason })),
    preparedBy: r.preparedBy ? String(r.preparedBy) : null,
    preparedByName: r.preparedByName,
    calculatedAt: r.calculatedAt,
    approvedBy: r.approvedBy ? String(r.approvedBy) : null,
    approvedByName: r.approvedByName,
    approvedAt: r.approvedAt,
    approvalNote: r.approvalNote,
    finalizedByName: r.finalizedByName,
    finalizedAt: r.finalizedAt,
    returnNote: r.returnNote,
    history: r.history,
    createdAt: r.createdAt,
    ...extra,
  };
}

export function toPublicEntry(e) {
  return {
    id: String(e._id),
    employee: { id: String(e.employee), ...e.employeeSnapshot },
    lines: e.lines.map((l) => ({ code: l.code, label: l.label, type: l.type, amount: paiseToRupees(l.amountPaise), basis: l.basis })),
    totals: {
      gross: paiseToRupees(e.totals.grossPaise),
      deductions: paiseToRupees(e.totals.deductionsPaise),
      netBeforeRounding: paiseToRupees(e.totals.netBeforeRoundingPaise),
      rounding: paiseToRupees(e.totals.roundingPaise),
      net: paiseToRupees(e.totals.netPaise),
      employerCost: paiseToRupees(e.totals.employerCostPaise),
    },
    inputs: {
      daysInMonth: e.inputs.daysInMonth,
      window: e.inputs.window,
      paidDays: e.inputs.paidUnits / 2,
      lopDays: e.inputs.lopUnits / 2,
      lopDetail: e.inputs.lopDays,
      segments: e.inputs.segments,
      arrears: (e.inputs.arrears ?? []).map((a) => ({ ...a, amount: paiseToRupees(a.amountPaise) })),
      attendance: e.inputs.attendanceTotals,
    },
    warnings: e.warnings,
    blockers: e.blockers,
    ruleVersion: e.ruleVersion,
  };
}

// Runs

export async function listRuns({ month, status, year }) {
  const filter = {};
  if (month) filter.month = month;
  if (status) filter.status = status;
  if (year) filter.month = { $gte: `${year}-01`, $lte: `${year}-12` };
  const runs = await PayrollRun.find(filter).sort({ month: -1, type: 1, sequence: 1 }).limit(200).lean();
  return runs.map((r) => toPublicRun(r));
}

export async function getRun(_req, id) {
  const r = await PayrollRun.findById(id).lean();
  if (!r) throw notFound('Payroll run not found');
  const rules = r.ruleSet ? await PayrollRuleSet.findById(r.ruleSet, { verification: 1, version: 1 }).lean() : await rulesForMonth(r.month);
  return toPublicRun(r, { rulesVerified: Boolean(rules?.verification?.verifiedAt), ruleVersionAvailable: rules?.version ?? null });
}

export async function createRun(req, { month, type, reason, payDate }) {
  const today = todayIn((await getSettings()).timezone);
  if (month > today.slice(0, 7)) throw validationError([{ path: 'month', message: 'Payroll cannot be run for a future month' }]);
  if (type === 'supplementary') {
    if (!(await PayrollRun.exists({ month, type: 'regular', status: 'finalized' }))) throw conflict('Supplementary runs correct a finalized month — finalize the regular run first');
    if (reason.length < 5) throw validationError([{ path: 'reason', message: 'Explain what this supplementary run corrects' }]);
  }
  const sequence = type === 'supplementary' ? (await PayrollRun.countDocuments({ month, type })) + 1 : 0;
  try {
    const run = await PayrollRun.create({
      month,
      type,
      sequence,
      reason,
      payDate: payDate ? parseDateOnly(payDate) : null,
      preparedBy: req.auth.user._id,
      preparedByName: req.auth.user.name,
      history: [{ status: 'draft', byName: req.auth.user.name, at: new Date(), note: reason }],
    });
    await recordAudit(req, { action: 'payroll.run_created', entityType: 'PayrollRun', entityId: run._id, summary: `Created ${type} payroll for ${month}` });
    return getRun(req, run._id);
  } catch (err) {
    if (err.code === 11000) throw conflict(`A regular payroll for ${month} already exists`);
    throw err;
  }
}

// Calculation

function segmentsFor(revisions, from, to, rules) {
  const sorted = [...revisions].sort((a, b) => a.effectiveFrom - b.effectiveFrom || a.revisionNo - b.revisionNo);
  const segments = [];
  sorted.forEach((rev, i) => {
    const start = toDateOnly(rev.effectiveFrom) > from ? toDateOnly(rev.effectiveFrom) : from;
    const next = sorted[i + 1];
    const end = next ? (addDays(toDateOnly(next.effectiveFrom), -1) < to ? addDays(toDateOnly(next.effectiveFrom), -1) : to) : to;
    if (start > end) return;
    const breakdown = salaryBreakdown({ ...revisionInput(rev), rules });
    segments.push({ from: start, to: end, days: eachDate(start, end).length, revisionId: String(rev._id), revisionNo: rev.revisionNo, components: breakdown.components, breakdown, revision: rev });
  });
  return segments;
}

/**
 * Unpaid half-day units per day (P2): unpaid leave, plus unexplained absence on past working days
 * when the rule set counts absence as loss of pay. Missing punches are paid but flagged.
 */
function unpaidDaysFrom(summary, window, includeAbsence, today) {
  const days = [];
  let future = 0;
  let incomplete = 0;
  for (const d of summary.days) {
    if (d.date < window.from || d.date > window.to || d.kind === 'not_employed') continue;
    const working = !d.holiday && !d.weeklyOff;
    const attended = d.record ? (d.record.status === 'present' ? 2 : d.record.status === 'half_day' ? 1 : 0) : 0;
    const leaveUnits = Math.min(2, d.leave?.units ?? 0);
    const unpaidLeave = Math.min(2, d.leave?.unpaidUnits ?? 0);
    if (d.kind === 'incomplete') incomplete += 1;
    let absence = 0;
    if (includeAbsence && working && d.kind !== 'incomplete') {
      if (d.date < today) absence = Math.max(0, 2 - leaveUnits - attended);
      else if (!d.record && !leaveUnits) future += 1;
    }
    const units = Math.min(2, unpaidLeave + absence);
    if (units) days.push({ date: d.date, units, unpaidLeaveUnits: unpaidLeave, absenceUnits: absence, leaveRequests: (d.leave?.types ?? []).map((t) => t.requestId) });
  }
  return { days, future, incomplete };
}

/** What was already paid for `month`, per component: its regular entry plus arrears paid later. */
async function paidForMonth(employeeId, month) {
  const [sameMonth, later] = await Promise.all([
    PayrollEntry.find({ employee: employeeId, month }).populate({ path: 'run', match: { type: 'regular', status: 'finalized' }, select: '_id' }).lean(),
    PayrollEntry.find({ employee: employeeId, 'inputs.arrears.month': month }).populate({ path: 'run', match: { status: 'finalized' }, select: '_id' }).lean(),
  ]);
  const regular = sameMonth.find((e) => e.run);
  if (!regular) return null;
  const paid = new Map();
  for (const l of regular.lines) if (l.type === 'earning' && EARNING_CODES(l.code)) paid.set(l.code, (paid.get(l.code) ?? 0) + l.amountPaise);
  for (const e of later.filter((x) => x.run)) {
    for (const a of e.inputs.arrears.filter((x) => x.month === month)) paid.set(a.code, (paid.get(a.code) ?? 0) + a.amountPaise);
  }
  return { paid, entry: regular };
}

/**
 * Arrears (P12): for each finalized month since the earliest unsettled back-dated revision, recompute
 * earnings with today's revisions (same rules and unpaid days as originally used) and pay the difference.
 */
async function arrearsFor(employeeId, revisions, month, rulesCache) {
  const monthStart = parseDateOnly(`${month}-01`);
  const backdated = revisions.filter((r) => !r.arrearsSettledRun && r.effectiveFrom < monthStart);
  if (!backdated.length) return { lines: [], detail: [], revisionIds: [] };
  const detail = [];
  for (let m = toDateOnly(backdated.reduce((min, r) => (r.effectiveFrom < min ? r.effectiveFrom : min), backdated[0].effectiveFrom)).slice(0, 7); m < month; m = nextMonth(m)) {
    const paidInfo = await paidForMonth(employeeId, m);
    if (!paidInfo) continue;
    const { entry, paid } = paidInfo;
    if (!rulesCache.has(entry.ruleVersion)) rulesCache.set(entry.ruleVersion, await PayrollRuleSet.findOne({ version: entry.ruleVersion }).lean());
    const segments = segmentsFor(revisions, entry.inputs.window.from, entry.inputs.window.to, rulesCache.get(entry.ruleVersion));
    const recomputed = computeEarnings({ daysInMonth: entry.inputs.daysInMonth, segments, unpaidDays: entry.inputs.lopDays });
    for (const a of arrearsForMonth(recomputed, paid)) detail.push({ month: m, ...a });
  }
  const byCode = new Map();
  for (const d of detail) {
    const cur = byCode.get(d.code) ?? { code: d.code, label: d.label, pfWage: d.pfWage, amountPaise: 0, months: [] };
    cur.amountPaise += d.amountPaise;
    cur.months.push(d.month);
    byCode.set(d.code, cur);
  }
  const lines = [...byCode.values()].filter((a) => a.amountPaise).map((a) => ({ ...a, basis: `For ${[...new Set(a.months)].join(', ')}` }));
  return { lines, detail: detail.map(({ month: mm, code, amountPaise }) => ({ month: mm, code, amountPaise })), revisionIds: backdated.map((r) => String(r._id)) };
}

function snapshotOf(e) {
  return {
    employeeCode: e.employeeCode,
    fullName: e.fullName,
    department: e.department?.name ?? null,
    designation: e.designation?.title ?? null,
    workLocation: e.workLocation,
    joiningDate: toDateOnly(e.joiningDate),
    exitDate: toDateOnly(e.exit?.exitDate),
  };
}

const adjFor = (adjs, employeeId) => {
  const mine = adjs.filter((a) => String(a.employee) === String(employeeId));
  return {
    tdsPaise: mine.filter((a) => a.kind === 'tds').reduce((s, a) => s + a.amountPaise, 0),
    earnings: mine.filter((a) => a.kind === 'earning').map((a) => ({ label: a.label, amountPaise: a.amountPaise })),
    deductions: mine.filter((a) => a.kind === 'deduction').map((a) => ({ label: a.label, amountPaise: a.amountPaise })),
    ids: mine.map((a) => String(a._id)),
  };
};

export async function calculateRun(req, id) {
  const run = await PayrollRun.findById(id).lean();
  if (!run) throw notFound('Payroll run not found');
  if (!['draft', 'calculated'].includes(run.status)) throw conflict(`A run that is ${label(run.status)} cannot be recalculated`);
  const rules = await rulesForMonth(run.month);
  if (!rules) throw conflict(`No active payroll rules apply to ${run.month}. Activate a rule set first.`);

  const { from: monthStart, to: monthEnd } = monthRange(run.month);
  const D = eachDate(monthStart, monthEnd).length;
  const today = todayIn((await getSettings()).timezone);
  const adjustments = await PayrollAdjustment.find({ run: run._id }).lean();
  const supplementary = run.type === 'supplementary';
  const employeeFilter = supplementary
    ? { _id: { $in: [...new Set(adjustments.map((a) => String(a.employee)))] } }
    : { lifecycleStatus: { $in: ['active', 'notice_period', 'exited'] }, joiningDate: { $lte: parseDateOnly(monthEnd) }, $or: [{ 'exit.exitDate': null }, { 'exit.exitDate': { $gte: parseDateOnly(monthStart) } }] };
  const employees = await Employee.find(employeeFilter).populate('department', 'name').populate('designation', 'title').sort({ employeeCode: 1 }).lean();

  const entries = [];
  const skipped = [];
  const rulesCache = new Map();
  // Supplementary runs pay one-off corrections only; statutory amounts are not recomputed.
  const statutoryOff = { ...rules, pf: { ...rules.pf, enabled: false }, esi: { ...rules.esi, enabled: false }, pt: { ...rules.pt, enabled: false }, gratuity: { bpOfBasic: 0 } };

  for (const e of employees) {
    const window = { from: toDateOnly(e.joiningDate) > monthStart ? toDateOnly(e.joiningDate) : monthStart, to: e.exit?.exitDate && toDateOnly(e.exit.exitDate) < monthEnd ? toDateOnly(e.exit.exitDate) : monthEnd };
    const adj = adjFor(adjustments, e._id);
    const warnings = [];
    let earnings = [];
    let arrears = { lines: [], detail: [], revisionIds: [] };
    let segments = [];
    let unpaid = { days: [], future: 0, incomplete: 0 };
    let attendanceTotals = null;
    let flags = { pfApplicable: false, pfOnFullWage: false, esiApplicable: false };

    if (!supplementary) {
      const revisions = await SalaryRevision.find({ employee: e._id, effectiveFrom: { $lte: parseDateOnly(window.to) } }).lean();
      if (!revisions.length) {
        skipped.push({ employee: e._id, name: `${e.employeeCode} ${e.fullName}`, reason: 'No salary structure' });
        continue;
      }
      segments = segmentsFor(revisions, window.from, window.to, rules);
      const covered = segments.reduce((s, x) => s + x.days, 0);
      const windowDays = eachDate(window.from, window.to).length;
      if (covered < windowDays) warnings.push(`${windowDays - covered} day(s) before the first salary revision are unpaid`);
      if (segments.some((s) => !s.breakdown.valid)) warnings.push('A salary revision no longer fits under its CTC with current rules; review it');
      const summary = await buildMonthlySummary(e, run.month);
      attendanceTotals = summary.totals;
      unpaid = unpaidDaysFrom(summary, window, rules.lop.includeAbsence, today);
      if (unpaid.incomplete) warnings.push(`${unpaid.incomplete} day(s) with missing punches were paid; resolve the corrections`);
      if (unpaid.future) warnings.push(`${unpaid.future} future working day(s) assumed present (month not over)`);
      earnings = computeEarnings({ daysInMonth: D, segments, unpaidDays: unpaid.days });
      arrears = await arrearsFor(e._id, revisions, run.month, rulesCache);
      if (arrears.lines.length) warnings.push(`Includes arrears from back-dated revisions (${arrears.lines.map((a) => a.basis).join('; ')})`);
      const last = segments.at(-1);
      flags = { pfApplicable: last.revision.pfApplicable, pfOnFullWage: last.revision.pfOnFullWage, esiApplicable: last.breakdown.esiApplicable };
    }

    const lopUnits = unpaid.days.reduce((s, d) => s + d.units, 0);
    const coveredDays = segments.reduce((s, x) => s + x.days, 0);
    const result = computeEntry({
      earnings,
      arrears: arrears.lines,
      flags,
      adjustments: adj,
      rules: supplementary ? statutoryOff : rules,
      isFebruary: run.month.endsWith('-02'),
      daysInMonth: D,
      paidUnits: 2 * coveredDays - lopUnits,
    });
    entries.push({
      run: run._id,
      employee: e._id,
      month: run.month,
      employeeSnapshot: snapshotOf(e),
      lines: result.lines,
      totals: result.totals,
      inputs: {
        daysInMonth: D,
        window,
        segments: segments.map(({ from, to, days, revisionId, revisionNo }) => ({ from, to, days, revisionId, revisionNo })),
        revisionIds: segments.map((s) => s.revisionId),
        paidUnits: 2 * coveredDays - lopUnits,
        lopUnits,
        lopDays: unpaid.days,
        attendanceTotals,
        arrears: arrears.detail,
        arrearsRevisionIds: arrears.revisionIds,
        adjustmentIds: adj.ids,
      },
      warnings,
      blockers: result.blockers,
      ruleVersion: rules.version,
    });
  }

  const sum = (k) => entries.reduce((s, x) => s + x.totals[k], 0);
  const totals = { employees: entries.length, grossPaise: sum('grossPaise'), deductionsPaise: sum('deductionsPaise'), netPaise: sum('netPaise'), employerCostPaise: sum('employerCostPaise'), roundingPaise: sum('roundingPaise') };
  const issues = { blockers: entries.reduce((s, x) => s + x.blockers.length, 0), warnings: entries.reduce((s, x) => s + x.warnings.length, 0) + skipped.length };

  await withTransaction(async (session) => {
    const updated = await PayrollRun.findOneAndUpdate(
      { _id: run._id, status: { $in: ['draft', 'calculated'] } },
      {
        $set: { status: 'calculated', totals, issues, skipped, ruleSet: rules._id, ruleVersion: rules.version, calculatedAt: new Date() },
        $push: { history: { status: 'calculated', byName: req.auth.user.name, at: new Date(), note: `${entries.length} employees, ${skipped.length} skipped` } },
      },
      { session },
    );
    if (!updated) throw conflict('The run changed while calculating; reload and try again');
    await PayrollEntry.deleteMany({ run: run._id }, { session });
    if (entries.length) await PayrollEntry.insertMany(entries, { session });
    await recordAudit(req, { action: 'payroll.run_calculated', entityType: 'PayrollRun', entityId: run._id, summary: `Calculated ${run.month} payroll: ${entries.length} employees, net ₹${paiseToRupees(totals.netPaise)}` }, session);
  });
  return getRun(req, run._id);
}

// Entries & inputs

export async function listEntries(_req, runId, { search, issues }) {
  const filter = { run: runId };
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ 'employeeSnapshot.fullName': rx }, { 'employeeSnapshot.employeeCode': rx }];
  }
  if (issues === 'true') filter.$and = [{ $or: [{ 'warnings.0': { $exists: true } }, { 'blockers.0': { $exists: true } }] }];
  const items = await PayrollEntry.find(filter).sort({ 'employeeSnapshot.employeeCode': 1 }).lean();
  return items.map(toPublicEntry);
}

export async function getEntry(_req, runId, entryId) {
  const e = await PayrollEntry.findOne({ _id: entryId, run: runId }).lean();
  if (!e) throw notFound('Entry not found');
  return toPublicEntry(e);
}

async function editableRun(runId, session) {
  const run = await PayrollRun.findById(runId).session(session ?? null);
  if (!run) throw notFound('Payroll run not found');
  if (!['draft', 'calculated'].includes(run.status)) throw conflict(`Inputs cannot change once the run is ${label(run.status)}`);
  return run;
}

/** Any input change sends the run back to draft so it must be recalculated before review. */
async function markStale(req, run, note, session) {
  if (run.status === 'calculated') {
    run.status = 'draft';
    run.history.push({ status: 'draft', byName: req.auth.user.name, at: new Date(), note });
  }
  await run.save({ session });
}

const toPublicAdjustment = (a) => ({ id: String(a._id), employee: String(a.employee), kind: a.kind, label: a.label, amount: paiseToRupees(a.amountPaise), reason: a.reason, createdByName: a.createdByName });

export async function listAdjustments(runId) {
  return (await PayrollAdjustment.find({ run: runId }).sort({ createdAt: 1 }).lean()).map(toPublicAdjustment);
}

export async function addAdjustment(req, runId, { employeeId, kind, label: lbl, amount, reason }) {
  const result = await withTransaction(async (session) => {
    const run = await editableRun(runId, session);
    const employee = await Employee.findById(employeeId, { fullName: 1 }).session(session).lean();
    if (!employee) throw validationError([{ path: 'employeeId', message: 'Employee not found' }]);
    if (kind !== 'tds' && !lbl) throw validationError([{ path: 'label', message: 'Describe the adjustment' }]);
    // One TDS figure per employee per run (P7): a new value replaces the old one.
    if (kind === 'tds') await PayrollAdjustment.deleteMany({ run: run._id, employee: employeeId, kind: 'tds' }, { session });
    const [a] = await PayrollAdjustment.create([{ run: run._id, employee: employeeId, kind, label: kind === 'tds' ? 'Income tax (TDS)' : lbl, amountPaise: amount, reason, createdBy: req.auth.user._id, createdByName: req.auth.user.name }], { session });
    await markStale(req, run, 'Inputs changed', session);
    await recordAudit(req, { action: 'payroll.adjustment_added', entityType: 'PayrollRun', entityId: run._id, summary: `${kind.toUpperCase()} ₹${paiseToRupees(amount)} for ${employee.fullName}${reason ? `: ${reason}` : ''}` }, session);
    return a;
  });
  return toPublicAdjustment(result.toObject());
}

export async function removeAdjustment(req, runId, adjustmentId) {
  await withTransaction(async (session) => {
    const run = await editableRun(runId, session);
    const a = await PayrollAdjustment.findOneAndDelete({ _id: adjustmentId, run: run._id }, { session });
    if (!a) throw notFound('Adjustment not found');
    await markStale(req, run, 'Inputs changed', session);
    await recordAudit(req, { action: 'payroll.adjustment_removed', entityType: 'PayrollRun', entityId: run._id, summary: `Removed ${a.kind} "${a.label}" ₹${paiseToRupees(a.amountPaise)}` }, session);
  });
}

/** Bulk TDS import by employee code (P7). Unknown codes are reported, nothing is half-applied. */
export async function importTds(req, runId, { rows }) {
  const codes = [...new Set(rows.map((r) => r.employeeCode.toUpperCase()))];
  const employees = await Employee.find({ employeeCode: { $in: codes } }, { employeeCode: 1 }).lean();
  const byCode = new Map(employees.map((e) => [e.employeeCode, e._id]));
  const unknown = codes.filter((c) => !byCode.has(c));
  if (unknown.length) throw validationError(unknown.map((c) => ({ path: 'rows', message: `Unknown employee code ${c}` })));
  await withTransaction(async (session) => {
    const run = await editableRun(runId, session);
    await PayrollAdjustment.deleteMany({ run: run._id, kind: 'tds', employee: { $in: [...byCode.values()] } }, { session });
    const docs = rows.filter((r) => r.amount > 0).map((r) => ({ run: run._id, employee: byCode.get(r.employeeCode.toUpperCase()), kind: 'tds', label: 'Income tax (TDS)', amountPaise: r.amount, reason: 'Imported', createdBy: req.auth.user._id, createdByName: req.auth.user.name }));
    if (docs.length) await PayrollAdjustment.insertMany(docs, { session });
    await markStale(req, run, 'TDS imported', session);
    await recordAudit(req, { action: 'payroll.tds_imported', entityType: 'PayrollRun', entityId: run._id, summary: `Imported TDS for ${rows.length} employee(s)` }, session);
  });
  return listAdjustments(runId);
}

// Approval chain (P10): prepare → review → approve (different person) → finalize (a third person)

const TRANSITIONS = {
  submit: { from: ['calculated'], to: 'under_review' },
  return: { from: ['under_review', 'approved'], to: 'calculated' },
  approve: { from: ['under_review'], to: 'approved' },
  finalize: { from: ['approved'], to: 'finalized' },
  cancel: { from: ['draft', 'calculated'], to: 'cancelled' },
};

export async function transitionRun(req, id, action, { note = '' } = {}) {
  const rule = TRANSITIONS[action];
  const me = String(req.auth.user._id);
  await withTransaction(async (session) => {
    const run = await PayrollRun.findById(id).session(session);
    if (!run) throw notFound('Payroll run not found');
    if (!rule.from.includes(run.status)) throw conflict(`Cannot ${action} a run that is ${label(run.status)}`);

    if (action === 'submit') {
      if (!run.totals.employees) throw conflict('There is nothing to submit: no employees were calculated');
      if (run.issues.blockers) throw conflict(`Resolve ${run.issues.blockers} blocking problem(s) before review`);
      run.submittedAt = new Date();
    }
    if (action === 'return') {
      if (note.trim().length < 3) throw validationError([{ path: 'note', message: 'Say what needs to change' }]);
      run.returnNote = note;
      run.approvedBy = null;
      run.approvedByName = null;
      run.approvedAt = null;
    }
    if (action === 'approve') {
      if (String(run.preparedBy) === me) throw forbidden('You prepared this payroll; someone else must approve it');
      Object.assign(run, { approvedBy: req.auth.user._id, approvedByName: req.auth.user.name, approvedAt: new Date(), approvalNote: note });
    }
    if (action === 'finalize') {
      if (String(run.preparedBy) === me || String(run.approvedBy) === me) throw forbidden('Finalizing needs a third person: not the preparer or the approver');
      const rules = await PayrollRuleSet.findById(run.ruleSet).session(session).lean();
      if (!rules?.verification?.verifiedAt) throw conflict(`Payroll rules v${run.ruleVersion} have not been verified by a payroll professional yet`);
      await finalizeEffects(req, run, session);
    }
    run.status = rule.to;
    run.history.push({ status: rule.to, byName: req.auth.user.name, at: new Date(), note });
    await run.save({ session });
    await recordAudit(req, { action: `payroll.run_${action === 'return' ? 'returned' : rule.to}`, entityType: 'PayrollRun', entityId: run._id, summary: `${run.month} ${run.type} payroll ${action === 'return' ? 'returned for changes' : label(rule.to)}${note ? `: ${note}` : ''}` }, session);
  });
  return getRun(req, id);
}

/** Reconcile, lock source data, settle arrears and snapshot payslips — all in the finalize transaction. */
async function finalizeEffects(req, run, session) {
  const entries = await PayrollEntry.find({ run: run._id }).session(session).lean();
  const sum = (k) => entries.reduce((s, x) => s + x.totals[k], 0);
  const lineSum = entries.reduce((s, e) => s + e.lines.filter((l) => l.type === 'earning').reduce((t, l) => t + l.amountPaise, 0) - e.lines.filter((l) => l.type === 'deduction').reduce((t, l) => t + l.amountPaise, 0) + e.totals.roundingPaise, 0);
  if (entries.length !== run.totals.employees || sum('netPaise') !== run.totals.netPaise || sum('grossPaise') !== run.totals.grossPaise || lineSum !== run.totals.netPaise) {
    throw conflict('Payroll totals do not reconcile with the employee entries; recalculate the run');
  }
  if (entries.some((e) => e.blockers.length)) throw badRequest('Entries have blocking problems');
  const { from, to } = monthRange(run.month);
  const employeeIds = entries.map((e) => e.employee);
  if (run.type === 'regular') {
    await AttendanceRecord.updateMany({ employee: { $in: employeeIds }, date: { $gte: parseDateOnly(from), $lte: parseDateOnly(to) }, lockedAt: null }, { $set: { lockedAt: new Date() } }, { session });
    // Revisions paid through this month no longer generate arrears for it.
    await SalaryRevision.updateMany({ employee: { $in: employeeIds }, effectiveFrom: { $lte: parseDateOnly(to) }, arrearsSettledRun: null }, { $set: { arrearsSettledRun: run._id } }, { session });
  }
  Object.assign(run, { finalizedBy: req.auth.user._id, finalizedByName: req.auth.user.name, finalizedAt: new Date() });
  await createPayslips(run, entries, session);
}
