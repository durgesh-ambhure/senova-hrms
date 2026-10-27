import { ACTIVE_LEAVE_STATUSES, LeaveBalance, LeaveRequest, LeaveType } from './leave.models.js';
import { accruedUnits, availableUnits, carryForwardUnits, computeLeaveSlots, slotsOverlap } from './leave.rules.js';
import { buildWorkCalendar } from '../attendance/calendar.js';
import { getEffectiveShift } from '../attendance/shift.service.js';
import { Employee } from '../employees/employee.model.js';
import { canApprove, inScope, moduleScope, ownEmployeeId, scopeMatch } from '../employees/team.js';
import { getSettings } from '../company/company.service.js';
import { hasPermission } from '../roles/permissions.js';
import { diffFields, recordAudit } from '../audit/audit.service.js';
import { withTransaction } from '../../db/transaction.js';
import { badRequest, conflict, forbidden, notFound, validationError } from '../../shared/errors.js';
import { addDays, eachDate, parseDateOnly, toDateOnly, todayIn } from '../../shared/dates.js';
import { finalizedMonthsIn } from '../payroll/payroll.locks.js';

/** Leave in a month whose payroll is finalized is frozen (DECISIONS A16); use a supplementary payroll run. */
async function assertPayrollOpen(dates, session) {
  const months = [...new Set(dates.map((d) => (typeof d === 'string' ? d : toDateOnly(d)).slice(0, 7)))];
  const locked = await finalizedMonthsIn(months, session);
  if (locked.length) throw conflict(`Payroll for ${locked.sort().join(', ')} is finalized; leave in that month can no longer change`);
}

const CURRENT = ['active', 'notice_period'];
const APPROVAL = { adminPermission: 'leave:manage', teamPermission: 'leave:approve:team' };
const SCOPE = { allPermission: 'leave:manage', teamPermission: 'leave:approve:team', selfPermission: 'self:leave' };
const TYPE_FIELDS = ['name', 'code', 'description', 'paid', 'unlimited', 'annualQuotaDays', 'accrual', 'carryForwardMaxDays', 'allowHalfDay', 'allowNegativeBalance', 'availableDuringProbation', 'employmentTypes', 'maxConsecutiveDays', 'minNoticeDays', 'color', 'status'];

async function context() {
  const s = await getSettings();
  return { tz: s.timezone, today: todayIn(s.timezone), policy: s.policies.leave };
}

// Leave types

export const toPublicLeaveType = (t) => ({ id: String(t._id), ...Object.fromEntries(TYPE_FIELDS.map((f) => [f, t[f]])) });

export async function listLeaveTypes({ includeArchived }) {
  const items = await LeaveType.find(includeArchived === 'true' ? {} : { status: 'active' }).sort({ name: 1 }).lean();
  return items.map(toPublicLeaveType);
}

function assertTypeConsistent(t) {
  if (t.unlimited && t.paid) throw validationError([{ path: 'unlimited', message: 'Unlimited leave types must be unpaid (e.g. loss of pay)' }]);
  if (!t.unlimited && !t.annualQuotaDays) throw validationError([{ path: 'annualQuotaDays', message: 'Set an annual quota, or mark the type as unlimited' }]);
}

export async function createLeaveType(req, input) {
  assertTypeConsistent(input);
  if (await LeaveType.exists({ code: input.code })) throw conflict('A leave type with this code already exists');
  const t = await LeaveType.create({ ...input, createdBy: req.auth.user._id, updatedBy: req.auth.user._id });
  await recordAudit(req, { action: 'leave_type.created', entityType: 'LeaveType', entityId: t._id, summary: `Created leave type ${t.name}` });
  return toPublicLeaveType(t.toObject());
}

export async function updateLeaveType(req, id, input) {
  const t = await LeaveType.findById(id);
  if (!t) throw notFound('Leave type not found');
  if (input.code && input.code !== t.code && (await LeaveType.exists({ code: input.code }))) throw conflict('A leave type with this code already exists');
  if (input.unlimited !== undefined && input.unlimited !== t.unlimited && (await LeaveBalance.exists({ leaveType: t._id }))) {
    throw conflict('Balances already exist for this type; create a new type instead of changing whether it is unlimited');
  }
  const before = t.toObject();
  Object.assign(t, input, { updatedBy: req.auth.user._id });
  assertTypeConsistent(t);
  await t.save();
  await recordAudit(req, { action: 'leave_type.updated', entityType: 'LeaveType', entityId: t._id, summary: `Updated leave type ${t.name}`, changes: diffFields(before, t.toObject(), TYPE_FIELDS) });
  return toPublicLeaveType(t.toObject());
}

// Balances

/**
 * Returns the balance for (employee, type, year), creating it with any carry-forward from the
 * previous year, and refreshing accrual to `today`. Accrual is recalculated from scratch each time,
 * so it is idempotent.
 */
export async function ensureBalance(employee, type, year, today, session) {
  const joining = toDateOnly(employee.joiningDate);
  let balance = await LeaveBalance.findOne({ employee: employee._id, leaveType: type._id, year }).session(session ?? null);
  if (!balance) {
    let opening = 0;
    if (type.carryForwardMaxDays && Number(joining.slice(0, 4)) < year) {
      const prev = await ensureBalance(employee, type, year - 1, today, session);
      opening = carryForwardUnits(type, prev.toObject());
    }
    try {
      [balance] = await LeaveBalance.create([{ employee: employee._id, leaveType: type._id, year, openingUnits: opening }], { session });
    } catch (err) {
      if (err.code !== 11000) throw err;
      balance = await LeaveBalance.findOne({ employee: employee._id, leaveType: type._id, year }).session(session ?? null);
    }
  }
  const accrued = accruedUnits({ type, year, joiningDate: joining, asOf: today });
  if (balance.accruedUnits !== accrued) {
    balance.accruedUnits = accrued;
    await balance.save({ session });
  }
  return balance;
}

function toPublicBalance(type, b) {
  return {
    leaveType: { id: String(type._id), name: type.name, code: type.code, paid: type.paid, unlimited: type.unlimited, color: type.color, allowHalfDay: type.allowHalfDay },
    year: b.year,
    openingUnits: b.openingUnits,
    accruedUnits: b.accruedUnits,
    adjustedUnits: b.adjustedUnits,
    usedUnits: b.usedUnits,
    pendingUnits: b.pendingUnits,
    availableUnits: type.unlimited ? null : availableUnits(b),
    adjustments: b.adjustments?.map((a) => ({ units: a.units, reason: a.reason, byName: a.byName, at: a.at })) ?? [],
  };
}

async function resolveEmployee(req, employeeId) {
  const scope = await moduleScope(req, SCOPE);
  const id = employeeId ?? ownEmployeeId(req);
  if (!id || !inScope(scope, id)) throw notFound('Employee not found');
  const employee = await Employee.findById(id).lean();
  if (!employee) throw notFound('Employee not found');
  return employee;
}

const applicable = (type, employee) => !type.employmentTypes?.length || type.employmentTypes.includes(employee.employmentType);

export async function getBalances(req, { employee: employeeId, year }) {
  const employee = await resolveEmployee(req, employeeId);
  const ctx = await context();
  const y = year ?? Number(ctx.today.slice(0, 4));
  const types = await LeaveType.find({ status: 'active' }).sort({ name: 1 }).lean();
  const out = [];
  for (const type of types.filter((t) => applicable(t, employee))) {
    out.push(toPublicBalance(type, (await ensureBalance(employee, type, y, ctx.today)).toObject()));
  }
  return { employee: { id: String(employee._id), fullName: employee.fullName, employeeCode: employee.employeeCode }, year: y, balances: out };
}

export async function adjustBalance(req, { employeeId, leaveTypeId, year, units, reason }) {
  const ctx = await context();
  const [employee, type] = await Promise.all([Employee.findById(employeeId).lean(), LeaveType.findById(leaveTypeId).lean()]);
  if (!employee) throw notFound('Employee not found');
  if (!type) throw notFound('Leave type not found');
  if (type.unlimited) throw badRequest('Unlimited leave types have no balance to adjust');
  if (String(employee._id) === ownEmployeeId(req)) throw forbidden('You cannot adjust your own leave balance');
  const result = await withTransaction(async (session) => {
    const balance = await ensureBalance(employee, type, year, ctx.today, session);
    balance.adjustedUnits += units;
    balance.adjustments.push({ units, reason, by: req.auth.user._id, byName: req.auth.user.name, at: new Date() });
    if (availableUnits(balance) < 0 && !type.allowNegativeBalance) throw conflict('This adjustment would make the balance negative');
    await balance.save({ session });
    await recordAudit(
      req,
      { action: 'leave.balance_adjusted', entityType: 'Employee', entityId: employee._id, summary: `${units > 0 ? 'Added' : 'Deducted'} ${Math.abs(units) / 2} day(s) of ${type.code} for ${year}: ${reason}` },
      session,
    );
    return balance;
  });
  return toPublicBalance(type, result.toObject());
}

// Requests

export function toPublicRequest(r) {
  return {
    id: String(r._id),
    employee: r.employee?._id ? { id: String(r.employee._id), fullName: r.employee.fullName, employeeCode: r.employee.employeeCode } : { id: String(r.employee) },
    leaveType: { id: String(r.leaveType), ...r.leaveTypeSnapshot },
    startDate: toDateOnly(r.startDate),
    endDate: toDateOnly(r.endDate),
    startSession: r.startSession,
    endSession: r.endSession,
    units: r.units,
    days: r.slots.map((s) => ({ date: toDateOnly(s.date), half: s.half })),
    reason: r.reason,
    status: r.status,
    decidedByName: r.decidedByName,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    cancellation: r.cancellation?.requestedAt ? r.cancellation : null,
    createdAt: r.createdAt,
  };
}

/** Validates a leave application and computes the exact days it charges. Exported for preview. */
export async function planLeave(employee, type, input, ctx) {
  const { startDate, endDate, startSession, endSession } = input;
  const issue = (path, message) => validationError([{ path, message }]);
  if (endDate < startDate) throw issue('endDate', 'End date must be on or after the start date');
  if (startDate.slice(0, 4) !== endDate.slice(0, 4)) throw issue('endDate', 'Leave cannot span two calendar years — submit two requests');
  if (startDate === endDate && startSession === 'second_half' && endSession === 'first_half') throw issue('endSession', 'Choose either the first or the second half');
  if ((startSession !== 'full' || endSession !== 'full') && !type.allowHalfDay) throw issue('startSession', `${type.name} cannot be taken in half days`);
  if (!applicable(type, employee)) throw issue('leaveTypeId', `${type.name} does not apply to your employment type`);
  if (!type.availableDuringProbation && ['on_probation', 'extended'].includes(employee.probation?.status)) throw issue('leaveTypeId', `${type.name} is not available during probation`);
  if (startDate < toDateOnly(employee.joiningDate)) throw issue('startDate', 'Leave cannot start before the joining date');
  if (employee.exit?.lastWorkingDate && endDate > toDateOnly(employee.exit.lastWorkingDate)) throw issue('endDate', 'Leave cannot extend past the last working day');
  if (startDate < addDays(ctx.today, -ctx.policy.backdatedDays)) throw issue('startDate', `Leave can be applied at most ${ctx.policy.backdatedDays} days back`);
  if (endDate > addDays(ctx.today, ctx.policy.maxAdvanceDays)) throw issue('endDate', `Leave can be planned at most ${ctx.policy.maxAdvanceDays} days ahead`);
  if (type.minNoticeDays && startDate >= ctx.today && startDate < addDays(ctx.today, type.minNoticeDays)) {
    throw issue('startDate', `${type.name} needs ${type.minNoticeDays} days' notice`);
  }
  const shift = await getEffectiveShift(employee);
  const calendar = await buildWorkCalendar(employee, shift, startDate, endDate);
  const slots = computeLeaveSlots({ startDate, endDate, startSession, endSession, calendar, countNonWorkingDays: ctx.policy.countNonWorkingDays });
  const units = slots.reduce((s, x) => s + x.units, 0);
  if (!units) throw issue('startDate', 'The selected dates contain no working days');
  if (type.maxConsecutiveDays && eachDate(startDate, endDate).length > type.maxConsecutiveDays) throw issue('endDate', `${type.name} is limited to ${type.maxConsecutiveDays} consecutive days`);
  return { slots, units };
}

async function assertNoOverlap(employeeId, slots, session, exceptId) {
  const dates = slots.map((s) => parseDateOnly(s.date));
  const others = await LeaveRequest.find({ employee: employeeId, status: { $in: ACTIVE_LEAVE_STATUSES }, 'slots.date': { $in: dates }, _id: { $ne: exceptId } })
    .session(session)
    .lean();
  for (const o of others) {
    if (slotsOverlap(o.slots.map((s) => ({ ...s, date: toDateOnly(s.date) })), slots)) {
      throw conflict(`This overlaps your ${o.leaveTypeSnapshot.name} from ${toDateOnly(o.startDate)} to ${toDateOnly(o.endDate)}`);
    }
  }
}

export async function applyLeave(req, input) {
  const ctx = await context();
  const onBehalf = input.employeeId && input.employeeId !== ownEmployeeId(req);
  if (onBehalf && !hasPermission(req.auth.permissions, 'leave:manage')) throw forbidden('You cannot apply leave for someone else');
  if (!onBehalf && !hasPermission(req.auth.permissions, 'self:leave')) throw forbidden();
  const employeeId = input.employeeId ?? ownEmployeeId(req);
  const employee = employeeId ? await Employee.findById(employeeId).lean() : null;
  if (!employee || employee.archivedAt) throw notFound('No employee profile is linked to your account');
  if (!CURRENT.includes(employee.lifecycleStatus)) throw conflict('Leave can only be applied for current employees');
  const type = await LeaveType.findOne({ _id: input.leaveTypeId, status: 'active' }).lean();
  if (!type) throw validationError([{ path: 'leaveTypeId', message: 'Choose an active leave type' }]);

  const { slots, units } = await planLeave(employee, type, input, ctx);
  const year = Number(input.startDate.slice(0, 4));
  const request = await withTransaction(async (session) => {
    await assertPayrollOpen(slots.map((s) => s.date), session);
    await assertNoOverlap(employee._id, slots, session);
    const balance = await ensureBalance(employee, type, year, ctx.today, session);
    if (!type.unlimited && !type.allowNegativeBalance && availableUnits(balance) < units) {
      throw conflict(`Not enough ${type.name} balance: ${availableUnits(balance) / 2} day(s) available, ${units / 2} requested`);
    }
    balance.pendingUnits += units;
    await balance.save({ session });
    const [r] = await LeaveRequest.create(
      [
        {
          employee: employee._id,
          leaveType: type._id,
          leaveTypeSnapshot: { name: type.name, code: type.code, paid: type.paid, unlimited: type.unlimited, color: type.color },
          year,
          startDate: parseDateOnly(input.startDate),
          endDate: parseDateOnly(input.endDate),
          startSession: input.startSession,
          endSession: input.endSession,
          units,
          slots: slots.map((s) => ({ ...s, date: parseDateOnly(s.date) })),
          reason: input.reason,
          appliedBy: req.auth.user._id,
        },
      ],
      { session },
    );
    await recordAudit(
      req,
      { action: 'leave.applied', entityType: 'Employee', entityId: employee._id, summary: `${type.code} ${input.startDate} → ${input.endDate} (${units / 2} day(s))${onBehalf ? ' applied by HR' : ''}` },
      session,
    );
    return r;
  });
  return toPublicRequest(request.toObject());
}

/** Moves units between the pending/used buckets of a request's balance. */
async function moveUnits(request, { pending = 0, used = 0 }, session) {
  await LeaveBalance.updateOne(
    { employee: request.employee, leaveType: request.leaveType, year: request.year },
    { $inc: { pendingUnits: pending, usedUnits: used } },
    { session },
  );
}

async function loadForApproval(req, id, session) {
  const r = await LeaveRequest.findById(id).session(session);
  if (!r) throw notFound('Leave request not found');
  if (!(await canApprove(req, r.employee, APPROVAL))) {
    throw String(r.employee) === ownEmployeeId(req) ? forbidden('You cannot approve your own leave') : notFound('Leave request not found');
  }
  return r;
}

export async function decideLeave(req, id, { decision, note }) {
  const r = await withTransaction(async (session) => {
    const request = await loadForApproval(req, id, session);
    if (decision === 'approved') await assertPayrollOpen(request.slots.map((s) => s.date), session);
    if (request.status !== 'pending') throw conflict(`This request is already ${request.status.replace('_', ' ')}`);
    request.status = decision;
    Object.assign(request, { decidedBy: req.auth.user._id, decidedByName: req.auth.user.name, decidedAt: new Date(), decisionNote: note });
    await moveUnits(request, decision === 'approved' ? { pending: -request.units, used: request.units } : { pending: -request.units }, session);
    await request.save({ session });
    await recordAudit(req, { action: `leave.${decision}`, entityType: 'Employee', entityId: request.employee, summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} ${request.leaveTypeSnapshot.code} from ${toDateOnly(request.startDate)}` }, session);
    return request;
  });
  return toPublicRequest(r.toObject());
}

/**
 * Pending requests are withdrawn immediately. Approved leave needs the approver to accept the
 * cancellation, unless HR (leave:manage) cancels it.
 */
export async function cancelLeave(req, id, { reason }) {
  const r = await withTransaction(async (session) => {
    const request = await LeaveRequest.findById(id).session(session);
    const isOwner = request && String(request.employee) === ownEmployeeId(req);
    const isHr = hasPermission(req.auth.permissions, 'leave:manage');
    if (!request || (!isOwner && !isHr)) throw notFound('Leave request not found');
    if (request.status !== 'pending') await assertPayrollOpen(request.slots.map((s) => s.date), session);
    if (request.status === 'pending') {
      request.status = 'cancelled';
      await moveUnits(request, { pending: -request.units }, session);
    } else if (request.status === 'approved') {
      if (isHr && !isOwner) {
        request.status = 'cancelled';
        Object.assign(request.cancellation, { requestedAt: new Date(), reason, decidedByName: req.auth.user.name, decidedAt: new Date() });
        await moveUnits(request, { used: -request.units }, session);
      } else {
        request.status = 'cancellation_requested';
        Object.assign(request.cancellation, { requestedAt: new Date(), reason });
      }
    } else throw conflict(`This request is already ${request.status.replace('_', ' ')}`);
    await request.save({ session });
    await recordAudit(req, { action: `leave.${request.status}`, entityType: 'Employee', entityId: request.employee, summary: `${request.status === 'cancelled' ? 'Cancelled' : 'Requested cancellation of'} ${request.leaveTypeSnapshot.code} from ${toDateOnly(request.startDate)}` }, session);
    return request;
  });
  return toPublicRequest(r.toObject());
}

export async function decideCancellation(req, id, { decision, note }) {
  const r = await withTransaction(async (session) => {
    const request = await loadForApproval(req, id, session);
    if (request.status !== 'cancellation_requested') throw conflict('There is no cancellation request to review');
    if (decision === 'approved') await assertPayrollOpen(request.slots.map((s) => s.date), session);
    Object.assign(request.cancellation, { decidedByName: req.auth.user.name, decidedAt: new Date(), note });
    if (decision === 'approved') {
      request.status = 'cancelled';
      await moveUnits(request, { used: -request.units }, session);
    } else request.status = 'approved';
    await request.save({ session });
    await recordAudit(req, { action: `leave.cancellation_${decision}`, entityType: 'Employee', entityId: request.employee, summary: `Cancellation ${decision} for ${request.leaveTypeSnapshot.code} from ${toDateOnly(request.startDate)}` }, session);
    return request;
  });
  return toPublicRequest(r.toObject());
}

export async function listRequests(req, { scope: which, status, employee, from, to, page, limit }) {
  const filter = {};
  if (which === 'mine') {
    const me = ownEmployeeId(req);
    if (!me) return { items: [], meta: { page, limit, total: 0, totalPages: 1 } };
    filter.employee = me;
  } else if (which === 'approvals') {
    const scope = await moduleScope(req, { allPermission: APPROVAL.adminPermission, teamPermission: APPROVAL.teamPermission });
    if (!scope.all && !scope.ids.size) return { items: [], meta: { page, limit, total: 0, totalPages: 1 } };
    Object.assign(filter, scopeMatch(scope));
    const me = ownEmployeeId(req);
    if (me) filter.employee = { ...(filter.employee ?? {}), $ne: me };
    filter.status = status ?? { $in: ['pending', 'cancellation_requested'] };
  } else {
    const scope = await moduleScope(req, SCOPE);
    Object.assign(filter, scopeMatch(scope));
  }
  if (employee) {
    const scope = await moduleScope(req, SCOPE);
    if (!inScope(scope, employee)) throw notFound('Employee not found');
    filter.employee = employee;
  }
  if (status && which !== 'approvals') filter.status = status;
  if (from) filter.endDate = { $gte: parseDateOnly(from) };
  if (to) filter.startDate = { $lte: parseDateOnly(to) };
  const [items, total] = await Promise.all([
    LeaveRequest.find(filter).sort({ startDate: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).populate('employee', 'fullName employeeCode').lean(),
    LeaveRequest.countDocuments(filter),
  ]);
  return { items: items.map(toPublicRequest), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function getRequest(req, id) {
  const r = await LeaveRequest.findById(id).populate('employee', 'fullName employeeCode').lean();
  if (!r) throw notFound('Leave request not found');
  const scope = await moduleScope(req, SCOPE);
  if (!inScope(scope, r.employee._id)) throw notFound('Leave request not found');
  return toPublicRequest(r);
}

/** Dry run for the apply form: the days that would be charged and the resulting balance. */
export async function previewLeave(req, input) {
  const ctx = await context();
  const employee = await resolveEmployee(req, input.employeeId);
  const type = await LeaveType.findOne({ _id: input.leaveTypeId, status: 'active' }).lean();
  if (!type) throw validationError([{ path: 'leaveTypeId', message: 'Choose an active leave type' }]);
  const { slots, units } = await planLeave(employee, type, input, ctx);
  const balance = await ensureBalance(employee, type, Number(input.startDate.slice(0, 4)), ctx.today);
  return { units, days: slots, availableUnits: type.unlimited ? null : availableUnits(balance) };
}
