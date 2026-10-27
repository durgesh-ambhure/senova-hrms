import { AttendanceRecord, MAX_BREAKS } from './attendanceRecord.model.js';
import { AttendanceCorrection } from './attendanceCorrection.model.js';
import { attendanceDateFor, attendanceUnits, computeAttendance, shiftWindow } from './attendance.rules.js';
import { buildWorkCalendar } from './calendar.js';
import { getEffectiveShift, getEffectiveShifts, shiftSnapshot } from './shift.service.js';
import { Employee } from '../employees/employee.model.js';
import { LeaveRequest } from '../leave/leave.models.js';
import { holidaysBetween } from '../holidays/holiday.service.js';
import { getSettings } from '../company/company.service.js';
import { canApprove, inScope, moduleScope, ownEmployeeId, requireOwnEmployee, scopeMatch } from '../employees/team.js';
import { recordAudit } from '../audit/audit.service.js';
import { withTransaction } from '../../db/transaction.js';
import { badRequest, conflict, forbidden, notFound, validationError } from '../../shared/errors.js';
import { addDays, eachDate, monthRange, parseDateOnly, toDateOnly, todayIn, zonedToUtc } from '../../shared/dates.js';
import { isMonthFinalized } from '../payroll/payroll.locks.js';

const CURRENT = ['active', 'notice_period'];
const OPEN_PUNCH_HOURS = 20;

const SCOPE = { allPermission: 'attendance:read:all', teamPermission: 'attendance:read:team', selfPermission: 'self:attendance' };
const APPROVAL = { adminPermission: 'attendance:manage', teamPermission: 'attendance:approve:team' };

async function context() {
  const settings = await getSettings();
  return { tz: settings.timezone, policy: settings.policies.attendance, today: todayIn(settings.timezone) };
}

export function toPublicRecord(r) {
  return {
    id: String(r._id),
    employee: r.employee?._id ? { id: String(r.employee._id), fullName: r.employee.fullName, employeeCode: r.employee.employeeCode } : String(r.employee),
    date: toDateOnly(r.date),
    shift: { name: r.shift.name, startTime: r.shift.startTime, endTime: r.shift.endTime },
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    breaks: r.breaks,
    onBreak: r.breaks.some((b) => !b.end),
    workedMinutes: r.workedMinutes,
    breakMinutes: r.breakMinutes,
    lateByMinutes: r.lateByMinutes,
    earlyByMinutes: r.earlyByMinutes,
    overtimeMinutes: r.overtimeMinutes,
    status: r.status,
    source: r.source,
    locked: Boolean(r.lockedAt),
  };
}

function recompute(record, ctx) {
  Object.assign(
    record,
    computeAttendance({
      shift: record.shift,
      date: toDateOnly(record.date),
      checkIn: record.checkIn,
      checkOut: record.checkOut,
      breaks: record.breaks,
      tz: ctx.tz,
      overtimeEnabled: ctx.policy.overtimeEnabled,
    }),
  );
}

async function currentEmployee(req) {
  const employee = await requireOwnEmployee(req);
  if (!CURRENT.includes(employee.lifecycleStatus)) throw forbidden('Only current employees can record attendance');
  return employee;
}

const findOpenRecord = (employeeId, now) =>
  AttendanceRecord.findOne({ employee: employeeId, checkIn: { $gte: new Date(now - OPEN_PUNCH_HOURS * 3600_000) }, checkOut: null }).sort({ checkIn: -1 });

// Punches

export async function checkIn(req, now = new Date()) {
  const ctx = await context();
  const employee = await currentEmployee(req);
  const shift = await getEffectiveShift(employee);
  const date = attendanceDateFor(now, shift, ctx.tz, ctx.policy.overnightCutoffHours);
  if (date < toDateOnly(employee.joiningDate)) throw badRequest('You cannot check in before your joining date');

  const existing = await AttendanceRecord.findOne({ employee: employee._id, date: parseDateOnly(date) }).lean();
  if (existing?.checkIn) throw conflict(`You have already checked in for ${date}`);
  if (existing?.lockedAt) throw conflict('Attendance for this day is locked by payroll');
  const record = new AttendanceRecord({ employee: employee._id, date: parseDateOnly(date), shift: shiftSnapshot(shift), checkIn: now });
  recompute(record, ctx);
  try {
    await record.save();
  } catch (err) {
    // Two simultaneous check-ins: the unique index lets only one through.
    if (err.code === 11000) throw conflict(`You have already checked in for ${date}`);
    throw err;
  }
  return toPublicRecord(record.toObject());
}

export async function checkOut(req, now = new Date()) {
  const ctx = await context();
  const employee = await currentEmployee(req);
  const record = await findOpenRecord(employee._id, now);
  if (!record) throw conflict('You have not checked in, or your check-in is too old — request a correction instead');
  if (record.lockedAt) throw conflict('Attendance for this day is locked by payroll');
  const openBreak = record.breaks.find((b) => !b.end);
  if (openBreak) openBreak.end = now;
  record.checkOut = now;
  recompute(record, ctx);
  await record.save();
  return toPublicRecord(record.toObject());
}

export async function startBreak(req, now = new Date()) {
  const employee = await currentEmployee(req);
  const record = await findOpenRecord(employee._id, now);
  if (!record) throw conflict('Check in before starting a break');
  if (record.breaks.some((b) => !b.end)) throw conflict('You are already on a break');
  if (record.breaks.length >= MAX_BREAKS) throw conflict(`At most ${MAX_BREAKS} breaks per day`);
  record.breaks.push({ start: now });
  await record.save();
  return toPublicRecord(record.toObject());
}

export async function endBreak(req, now = new Date()) {
  const employee = await currentEmployee(req);
  const record = await findOpenRecord(employee._id, now);
  const open = record?.breaks.find((b) => !b.end);
  if (!open) throw conflict('You are not on a break');
  open.end = now;
  await record.save();
  return toPublicRecord(record.toObject());
}

/** The actor's attendance state right now: today's record and the shift window. */
export async function getMyToday(req, now = new Date()) {
  const ctx = await context();
  const employee = await requireOwnEmployee(req);
  const shift = await getEffectiveShift(employee);
  const date = attendanceDateFor(now, shift, ctx.tz, ctx.policy.overnightCutoffHours);
  const [record, open, calendar] = await Promise.all([
    AttendanceRecord.findOne({ employee: employee._id, date: parseDateOnly(date) }).lean(),
    findOpenRecord(employee._id, now).lean(),
    buildWorkCalendar(employee, shift, date, date),
  ]);
  const window = shiftWindow(shift, date, ctx.tz);
  return {
    date,
    shift: { name: shift.name, startTime: shift.startTime, endTime: shift.endTime, start: window.start, end: window.end },
    day: calendar.get(date),
    record: record ? toPublicRecord(record) : null,
    openRecord: open && (!record || String(open._id) !== String(record._id)) ? toPublicRecord(open) : null,
    canPunch: CURRENT.includes(employee.lifecycleStatus),
  };
}

// Reading records

async function resolveTarget(req, employeeId) {
  const scope = await moduleScope(req, SCOPE);
  const id = employeeId ?? ownEmployeeId(req);
  if (!id || !inScope(scope, id)) throw notFound('Employee not found');
  const employee = await Employee.findById(id).lean();
  if (!employee) throw notFound('Employee not found');
  return employee;
}

export async function listRecords(req, { employee, from, to }) {
  if (to < from) throw validationError([{ path: 'to', message: 'End date must be on or after the start date' }]);
  if (eachDate(from, to).length > 62) throw validationError([{ path: 'to', message: 'Choose a range of at most 62 days' }]);
  const target = await resolveTarget(req, employee);
  const items = await AttendanceRecord.find({ employee: target._id, date: { $gte: parseDateOnly(from), $lte: parseDateOnly(to) } }).sort({ date: -1 }).lean();
  return items.map(toPublicRecord);
}

/**
 * Who is in today, for the actor's scope (team or company). Uses each person's attendance date
 * (overnight shifts) and shows approved leave and holidays.
 */
export async function teamToday(req, now = new Date()) {
  const scope = await moduleScope(req, { allPermission: SCOPE.allPermission, teamPermission: SCOPE.teamPermission });
  if (!scope.all && !scope.ids.size) return [];
  const ctx = await context();
  const employees = await Employee.find({ archivedAt: null, lifecycleStatus: { $in: CURRENT }, ...scopeMatch(scope, '_id') }, { fullName: 1, employeeCode: 1, shift: 1, workLocation: 1, department: 1 })
    .populate('department', 'name')
    .sort({ fullName: 1 })
    .limit(1000)
    .lean();
  const shifts = await getEffectiveShifts(employees);
  const dates = new Map(employees.map((e) => [String(e._id), attendanceDateFor(now, shifts.get(String(e._id)), ctx.tz, ctx.policy.overnightCutoffHours)]));
  const allDates = [...new Set(dates.values())].sort();
  const from = allDates[0] ?? ctx.today;
  const to = allDates.at(-1) ?? ctx.today;
  const [records, leaves, holidays] = await Promise.all([
    AttendanceRecord.find({ employee: { $in: employees.map((e) => e._id) }, date: { $gte: parseDateOnly(from), $lte: parseDateOnly(to) } }).lean(),
    LeaveRequest.find({ employee: { $in: employees.map((e) => e._id) }, status: { $in: ['approved', 'cancellation_requested'] }, 'slots.date': { $gte: parseDateOnly(from), $lte: parseDateOnly(to) } }).lean(),
    holidaysBetween(from, to),
  ]);
  const recordBy = new Map(records.map((r) => [`${r.employee}:${toDateOnly(r.date)}`, r]));
  const rows = [];
  for (const e of employees) {
    const id = String(e._id);
    const date = dates.get(id);
    const day = (await buildWorkCalendar(e, shifts.get(id), date, date, holidays)).get(date);
    const record = recordBy.get(`${id}:${date}`);
    const leave = leaves.find((l) => String(l.employee) === id && l.slots.some((s) => toDateOnly(s.date) === date));
    const leaveSlot = leave?.slots.find((s) => toDateOnly(s.date) === date);
    let state = 'not_checked_in';
    if (record?.checkOut) state = 'checked_out';
    else if (record?.checkIn) state = record.breaks.some((b) => !b.end) ? 'on_break' : 'checked_in';
    else if (leaveSlot?.half === 'full') state = 'on_leave';
    else if (day.holiday) state = 'holiday';
    else if (day.weeklyOff) state = 'weekly_off';
    rows.push({
      employee: { id, fullName: e.fullName, employeeCode: e.employeeCode, department: e.department?.name ?? null },
      date,
      state,
      leave: leaveSlot ? { type: leave.leaveTypeSnapshot.name, half: leaveSlot.half } : null,
      holiday: day.holiday?.name ?? null,
      checkIn: record?.checkIn ?? null,
      checkOut: record?.checkOut ?? null,
      lateByMinutes: record?.lateByMinutes ?? 0,
    });
  }
  return rows;
}

// Monthly summary — also the input for payroll attendance adjustments (Phase 5).

export async function monthlySummary(req, { employee: employeeId, month }) {
  const target = await resolveTarget(req, employeeId);
  return buildMonthlySummary(target, month);
}

/**
 * Day-by-day attendance for one employee and month, combining punches, approved leave, holidays
 * and weekly offs. All totals are in half-day units except minutes.
 */
export async function buildMonthlySummary(employee, month) {
  const ctx = await context();
  const { from, to } = monthRange(month);
  const shift = await getEffectiveShift(employee);
  const [calendar, records, leaves] = await Promise.all([
    buildWorkCalendar(employee, shift, from, to),
    AttendanceRecord.find({ employee: employee._id, date: { $gte: parseDateOnly(from), $lte: parseDateOnly(to) } }).lean(),
    LeaveRequest.find({ employee: employee._id, status: { $in: ['approved', 'cancellation_requested'] }, 'slots.date': { $gte: parseDateOnly(from), $lte: parseDateOnly(to) } }).lean(),
  ]);
  const recordBy = new Map(records.map((r) => [toDateOnly(r.date), r]));
  const leaveBy = new Map();
  for (const l of leaves) {
    for (const s of l.slots) {
      const date = toDateOnly(s.date);
      if (date < from || date > to) continue;
      const entry = leaveBy.get(date) ?? { units: 0, paidUnits: 0, unpaidUnits: 0, types: [] };
      entry.units += s.units;
      entry[l.leaveTypeSnapshot.paid ? 'paidUnits' : 'unpaidUnits'] += s.units;
      entry.types.push({ code: l.leaveTypeSnapshot.code, name: l.leaveTypeSnapshot.name, half: s.half, requestId: String(l._id) });
      leaveBy.set(date, entry);
    }
  }

  const joining = toDateOnly(employee.joiningDate);
  const exit = toDateOnly(employee.exit?.exitDate);
  const totals = { workingDays: 0, presentUnits: 0, paidLeaveUnits: 0, unpaidLeaveUnits: 0, absentUnits: 0, incompleteDays: 0, holidays: 0, weeklyOffs: 0, lateDays: 0, workedMinutes: 0, overtimeMinutes: 0 };
  const days = [];
  for (const date of eachDate(from, to)) {
    const cal = calendar.get(date);
    const record = recordBy.get(date);
    const leave = leaveBy.get(date) ?? null;
    if (date < joining || (exit && date > exit)) {
      days.push({ date, kind: 'not_employed' });
      continue;
    }
    const attended = record ? attendanceUnits(record.status) : 0;
    const leaveUnits = Math.min(2, leave?.units ?? 0);
    let kind;
    if (cal.holiday) kind = 'holiday';
    else if (cal.weeklyOff) kind = 'weekly_off';
    else if (record?.status === 'incomplete') kind = 'incomplete';
    else if (leaveUnits === 2) kind = 'leave';
    else if (date > ctx.today) kind = leaveUnits ? 'leave' : 'upcoming';
    else if (date === ctx.today && !record) kind = leaveUnits ? 'leave' : 'today';
    else kind = record ? record.status : leaveUnits ? 'leave' : 'absent';

    if (cal.working) {
      totals.workingDays += 1;
      if (date < ctx.today || (date === ctx.today && record?.checkOut)) {
        if (kind === 'incomplete') totals.incompleteDays += 1;
        else totals.absentUnits += Math.max(0, 2 - leaveUnits - attended);
      }
    }
    if (cal.holiday) totals.holidays += 1;
    else if (cal.weeklyOff) totals.weeklyOffs += 1;
    totals.presentUnits += attended;
    if (leave) {
      totals.paidLeaveUnits += leave.paidUnits;
      totals.unpaidLeaveUnits += leave.unpaidUnits;
    }
    if (record?.lateByMinutes) totals.lateDays += 1;
    totals.workedMinutes += record?.workedMinutes ?? 0;
    totals.overtimeMinutes += record?.overtimeMinutes ?? 0;
    days.push({
      date,
      kind,
      holiday: cal.holiday?.name ?? null,
      weeklyOff: cal.weeklyOff,
      leave,
      record: record ? toPublicRecord(record) : null,
    });
  }
  return { employee: { id: String(employee._id), fullName: employee.fullName, employeeCode: employee.employeeCode }, month, shift: { name: shift.name, startTime: shift.startTime, endTime: shift.endTime }, days, totals };
}

// Corrections

function toPublicCorrection(c) {
  return {
    id: String(c._id),
    employee: c.employee?._id ? { id: String(c.employee._id), fullName: c.employee.fullName, employeeCode: c.employee.employeeCode } : { id: String(c.employee) },
    date: toDateOnly(c.date),
    requestedCheckIn: c.requestedCheckIn,
    requestedCheckOut: c.requestedCheckOut,
    reason: c.reason,
    status: c.status,
    original: c.original,
    reviewedByName: c.reviewedByName,
    reviewedAt: c.reviewedAt,
    reviewNote: c.reviewNote,
    createdAt: c.createdAt,
  };
}

export async function requestCorrection(req, { date, checkIn, checkOut, reason }, now = new Date()) {
  const ctx = await context();
  const employee = await currentEmployee(req);
  if (date > ctx.today) throw validationError([{ path: 'date', message: 'You cannot correct a future day' }]);
  if (date < addDays(ctx.today, -ctx.policy.correctionWindowDays)) {
    throw validationError([{ path: 'date', message: `Corrections must be requested within ${ctx.policy.correctionWindowDays} days` }]);
  }
  if (date < toDateOnly(employee.joiningDate)) throw validationError([{ path: 'date', message: 'This date is before your joining date' }]);
  const inAt = zonedToUtc(date, checkIn, ctx.tz);
  // A check-out time earlier than check-in means the shift ran past midnight.
  const outAt = zonedToUtc(checkOut <= checkIn ? addDays(date, 1) : date, checkOut, ctx.tz);
  if (outAt > now) throw validationError([{ path: 'checkOut', message: 'Check-out cannot be in the future' }]);
  if (outAt - inAt > 20 * 3600_000) throw validationError([{ path: 'checkOut', message: 'A working day cannot exceed 20 hours' }]);

  const record = await AttendanceRecord.findOne({ employee: employee._id, date: parseDateOnly(date) }).lean();
  if (record?.lockedAt || (await isMonthFinalized(date.slice(0, 7)))) throw conflict('Attendance for this day is locked by payroll');
  if (await AttendanceCorrection.exists({ employee: employee._id, date: parseDateOnly(date), status: 'pending' })) {
    throw conflict('You already have a pending correction for this day');
  }
  const c = await AttendanceCorrection.create({
    employee: employee._id,
    date: parseDateOnly(date),
    requestedCheckIn: inAt,
    requestedCheckOut: outAt,
    reason,
    original: { checkIn: record?.checkIn ?? null, checkOut: record?.checkOut ?? null, status: record?.status ?? null },
    requestedBy: req.auth.user._id,
  });
  await recordAudit(req, { action: 'attendance.correction_requested', entityType: 'Employee', entityId: employee._id, summary: `Requested attendance correction for ${date}` });
  return toPublicCorrection(c.toObject());
}

export async function listCorrections(req, { scope: which, status }) {
  const filter = {};
  if (status) filter.status = status;
  if (which === 'mine') {
    const me = ownEmployeeId(req);
    if (!me) return [];
    filter.employee = me;
  } else {
    const scope = await moduleScope(req, { allPermission: APPROVAL.adminPermission, teamPermission: APPROVAL.teamPermission });
    if (!scope.all && !scope.ids.size) return [];
    Object.assign(filter, scopeMatch(scope));
    // Nobody reviews their own requests.
    const me = ownEmployeeId(req);
    if (me) filter.employee = { ...(filter.employee ?? {}), $ne: me };
  }
  const items = await AttendanceCorrection.find(filter).sort({ createdAt: -1 }).limit(200).populate('employee', 'fullName employeeCode').lean();
  return items.map(toPublicCorrection);
}

export async function reviewCorrection(req, id, { decision, note }) {
  const ctx = await context();
  const result = await withTransaction(async (session) => {
    const c = await AttendanceCorrection.findById(id).session(session);
    if (!c) throw notFound('Correction not found');
    if (!(await canApprove(req, c.employee, APPROVAL))) throw notFound('Correction not found');
    if (c.status !== 'pending') throw conflict(`This request is already ${c.status}`);
    if (decision === 'approved' && (await isMonthFinalized(toDateOnly(c.date).slice(0, 7), session))) throw conflict('Payroll for this month is finalized; the day can no longer change');
    Object.assign(c, { status: decision, reviewedBy: req.auth.user._id, reviewedByName: req.auth.user.name, reviewedAt: new Date(), reviewNote: note });
    if (decision === 'approved') {
      let record = await AttendanceRecord.findOne({ employee: c.employee, date: c.date }).session(session);
      if (record?.lockedAt) throw conflict('Attendance for this day is locked by payroll');
      if (!record) {
        const employee = await Employee.findById(c.employee).session(session).lean();
        record = new AttendanceRecord({ employee: c.employee, date: c.date, shift: shiftSnapshot(await getEffectiveShift(employee)) });
      }
      record.checkIn = c.requestedCheckIn;
      record.checkOut = c.requestedCheckOut;
      record.breaks = record.breaks.filter((b) => b.end && b.start >= c.requestedCheckIn && b.end <= c.requestedCheckOut);
      record.source = 'regularized';
      record.correction = c._id;
      recompute(record, ctx);
      await record.save({ session });
    }
    await c.save({ session });
    await recordAudit(
      req,
      { action: `attendance.correction_${decision}`, entityType: 'Employee', entityId: c.employee, summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} attendance correction for ${toDateOnly(c.date)}` },
      session,
    );
    return c;
  });
  return toPublicCorrection(result.toObject());
}

export async function cancelCorrection(req, id) {
  const c = await AttendanceCorrection.findOne({ _id: id, employee: ownEmployeeId(req) });
  if (!c) throw notFound('Correction not found');
  if (c.status !== 'pending') throw conflict(`This request is already ${c.status}`);
  c.status = 'cancelled';
  await c.save();
  return toPublicCorrection(c.toObject());
}
