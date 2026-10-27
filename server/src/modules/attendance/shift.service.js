import { FALLBACK_SHIFT, Shift, isOvernight } from './shift.model.js';
import { Employee } from '../employees/employee.model.js';
import { diffFields, recordAudit } from '../audit/audit.service.js';
import { conflict, notFound, validationError } from '../../shared/errors.js';
import { withTransaction } from '../../db/transaction.js';

const FIELDS = ['name', 'code', 'startTime', 'endTime', 'lateGraceMinutes', 'earlyLeaveGraceMinutes', 'fullDayMinutes', 'halfDayMinutes', 'weeklyOffs', 'isDefault', 'status'];

export function toPublicShift(s) {
  return { id: s._id ? String(s._id) : null, ...Object.fromEntries(FIELDS.map((f) => [f, s[f]])), overnight: isOvernight(s) };
}

/** Snapshot stored on attendance records so later shift edits don't rewrite history. */
export function shiftSnapshot(s) {
  return {
    shift: s._id ?? null,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    lateGraceMinutes: s.lateGraceMinutes,
    earlyLeaveGraceMinutes: s.earlyLeaveGraceMinutes,
    fullDayMinutes: s.fullDayMinutes,
    halfDayMinutes: s.halfDayMinutes,
    weeklyOffs: s.weeklyOffs,
  };
}

export async function getDefaultShift() {
  return (await Shift.findOne({ isDefault: true, status: 'active' }).lean()) ?? FALLBACK_SHIFT;
}

/** The employee's assigned shift, else the company default. */
export async function getEffectiveShift(employee) {
  if (employee.shift) {
    const s = await Shift.findById(employee.shift).lean();
    if (s) return s;
  }
  return getDefaultShift();
}

/** Resolves effective shifts for many employees with two queries. */
export async function getEffectiveShifts(employees) {
  const ids = [...new Set(employees.map((e) => e.shift && String(e.shift)).filter(Boolean))];
  const [assigned, fallback] = await Promise.all([Shift.find({ _id: { $in: ids } }).lean(), getDefaultShift()]);
  const byId = new Map(assigned.map((s) => [String(s._id), s]));
  return new Map(employees.map((e) => [String(e._id), byId.get(String(e.shift)) ?? fallback]));
}

export async function listShifts({ includeArchived }) {
  const filter = includeArchived === 'true' ? {} : { status: 'active' };
  const [items, counts] = await Promise.all([
    Shift.find(filter).sort({ isDefault: -1, name: 1 }).lean(),
    Employee.aggregate([{ $match: { archivedAt: null, lifecycleStatus: { $ne: 'exited' }, shift: { $ne: null } } }, { $group: { _id: '$shift', count: { $sum: 1 } } }]),
  ]);
  const countBy = new Map(counts.map((c) => [String(c._id), c.count]));
  return items.map((s) => ({ ...toPublicShift(s), employeeCount: countBy.get(String(s._id)) ?? 0 }));
}

function assertThresholds(s) {
  if (s.halfDayMinutes >= s.fullDayMinutes) throw validationError([{ path: 'halfDayMinutes', message: 'Half-day minutes must be less than full-day minutes' }]);
}

export async function createShift(req, input) {
  assertThresholds(input);
  if (await Shift.exists({ code: input.code })) throw conflict('A shift with this code already exists');
  const shift = await withTransaction(async (session) => {
    const isFirst = !(await Shift.exists({}).session(session));
    if (input.isDefault || isFirst) await Shift.updateMany({ isDefault: true }, { isDefault: false }, { session });
    const [s] = await Shift.create([{ ...input, isDefault: input.isDefault || isFirst, createdBy: req.auth.user._id, updatedBy: req.auth.user._id }], { session });
    await recordAudit(req, { action: 'shift.created', entityType: 'Shift', entityId: s._id, summary: `Created shift ${s.name} (${s.startTime}–${s.endTime})` }, session);
    return s;
  });
  return toPublicShift(shift.toObject());
}

export async function updateShift(req, id, input) {
  const shift = await withTransaction(async (session) => {
    const s = await Shift.findById(id).session(session);
    if (!s) throw notFound('Shift not found');
    if (input.code && input.code !== s.code && (await Shift.exists({ code: input.code }).session(session))) throw conflict('A shift with this code already exists');
    if (input.isDefault === false && s.isDefault) throw conflict('Choose another default shift instead of unsetting this one');
    if (input.status === 'archived') {
      if (s.isDefault) throw conflict('The default shift cannot be archived');
      if (await Employee.exists({ shift: s._id, archivedAt: null, lifecycleStatus: { $ne: 'exited' } }).session(session)) {
        throw conflict('Move employees off this shift before archiving it');
      }
    }
    const before = s.toObject();
    Object.assign(s, input, { updatedBy: req.auth.user._id });
    assertThresholds(s);
    if (input.isDefault) await Shift.updateMany({ _id: { $ne: s._id }, isDefault: true }, { isDefault: false }, { session });
    await s.save({ session });
    await recordAudit(req, { action: 'shift.updated', entityType: 'Shift', entityId: s._id, summary: `Updated shift ${s.name}`, changes: diffFields(before, s.toObject(), FIELDS) }, session);
    return s;
  });
  return toPublicShift(shift.toObject());
}
