import mongoose from 'mongoose';
import { Project, Timesheet } from './timesheet.models.js';
import { canApprove, inScope, moduleScope, ownEmployeeId, requireOwnEmployee, scopeMatch } from '../employees/team.js';
import { getSettings } from '../company/company.service.js';
import { recordAudit } from '../audit/audit.service.js';
import { conflict, forbidden, notFound, validationError } from '../../shared/errors.js';
import { addDays, parseDateOnly, toDateOnly, todayIn, weekStartOf, weekdayOf } from '../../shared/dates.js';

const SCOPE = { allPermission: 'timesheets:manage', teamPermission: 'timesheets:approve:team', selfPermission: 'self:timesheets' };
const APPROVAL = { adminPermission: 'timesheets:manage', teamPermission: 'timesheets:approve:team' };
const EDITABLE = ['draft', 'rejected'];

// Projects

const toPublicProject = (p) => ({ id: String(p._id), name: p.name, code: p.code, description: p.description, status: p.status });

export async function listProjects({ includeArchived }) {
  return (await Project.find(includeArchived === 'true' ? {} : { status: 'active' }).sort({ name: 1 }).lean()).map(toPublicProject);
}

export async function createProject(req, input) {
  if (await Project.exists({ code: input.code })) throw conflict('A project with this code already exists');
  const p = await Project.create({ ...input, createdBy: req.auth.user._id, updatedBy: req.auth.user._id });
  await recordAudit(req, { action: 'project.created', entityType: 'Project', entityId: p._id, summary: `Created project ${p.code} ${p.name}` });
  return toPublicProject(p.toObject());
}

export async function updateProject(req, id, input) {
  const p = await Project.findById(id);
  if (!p) throw notFound('Project not found');
  if (input.code && input.code !== p.code && (await Project.exists({ code: input.code }))) throw conflict('A project with this code already exists');
  Object.assign(p, input, { updatedBy: req.auth.user._id });
  await p.save();
  await recordAudit(req, { action: 'project.updated', entityType: 'Project', entityId: p._id, summary: `Updated project ${p.code}` });
  return toPublicProject(p.toObject());
}

// Timesheets

export function toPublicTimesheet(t) {
  return {
    id: t._id ? String(t._id) : null,
    employee: t.employee?._id ? { id: String(t.employee._id), fullName: t.employee.fullName, employeeCode: t.employee.employeeCode } : { id: String(t.employee) },
    weekStart: toDateOnly(t.weekStart),
    weekEnd: addDays(toDateOnly(t.weekStart), 6),
    entries: t.entries.map((e) => ({
      id: e._id ? String(e._id) : undefined,
      date: toDateOnly(e.date),
      project: e.project?._id ? { id: String(e.project._id), name: e.project.name, code: e.project.code } : { id: String(e.project) },
      task: e.task,
      minutes: e.minutes,
      note: e.note,
    })),
    totalMinutes: t.totalMinutes,
    status: t.status,
    submittedAt: t.submittedAt,
    decidedByName: t.decidedByName,
    decidedAt: t.decidedAt,
    comment: t.comment,
    history: t.history,
  };
}

async function assertWeek(employee, weekStart) {
  if (weekdayOf(weekStart) !== 1) throw validationError([{ path: 'weekStart', message: 'Weeks start on Monday' }]);
  const today = todayIn((await getSettings()).timezone);
  if (weekStart > weekStartOf(today)) throw validationError([{ path: 'weekStart', message: 'You cannot fill a future week' }]);
  if (addDays(weekStart, 6) < toDateOnly(employee.joiningDate)) throw validationError([{ path: 'weekStart', message: 'This week is before your joining date' }]);
}

const POPULATE = [
  { path: 'entries.project', select: 'name code' },
  { path: 'employee', select: 'fullName employeeCode' },
];

export async function getMyWeek(req, weekStart) {
  const employee = await requireOwnEmployee(req);
  await assertWeek(employee, weekStart);
  const t = await Timesheet.findOne({ employee: employee._id, weekStart: parseDateOnly(weekStart) }).populate(POPULATE).lean();
  return toPublicTimesheet(t ?? { employee: employee._id, weekStart: parseDateOnly(weekStart), entries: [], totalMinutes: 0, status: 'draft', history: [] });
}

async function validateEntries(entries, weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const perDay = new Map();
  const issues = [];
  entries.forEach((e, i) => {
    if (e.date < weekStart || e.date > weekEnd) issues.push({ path: `entries.${i}.date`, message: 'Date must be within this week' });
    perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.minutes);
  });
  for (const [date, minutes] of perDay) if (minutes > 1440) issues.push({ path: 'entries', message: `More than 24 hours logged on ${date}` });
  const projectIds = [...new Set(entries.map((e) => e.projectId))];
  const active = await Project.countDocuments({ _id: { $in: projectIds }, status: 'active' });
  if (active !== projectIds.length) issues.push({ path: 'entries', message: 'One or more projects are not active' });
  if (issues.length) throw validationError(issues);
}

export async function saveMyWeek(req, weekStart, { entries }) {
  const employee = await requireOwnEmployee(req);
  await assertWeek(employee, weekStart);
  await validateEntries(entries, weekStart);
  const existing = await Timesheet.findOne({ employee: employee._id, weekStart: parseDateOnly(weekStart) });
  if (existing && !EDITABLE.includes(existing.status)) throw conflict(`This timesheet is ${existing.status} and can no longer be edited`);
  const t = existing ?? new Timesheet({ employee: employee._id, weekStart: parseDateOnly(weekStart) });
  t.entries = entries.map((e) => ({ date: parseDateOnly(e.date), project: e.projectId, task: e.task, minutes: e.minutes, note: e.note }));
  t.totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);
  try {
    await t.save();
  } catch (err) {
    if (err.code === 11000) throw conflict('This timesheet was just created elsewhere; reload and try again');
    throw err;
  }
  return toPublicTimesheet((await t.populate(POPULATE)).toObject());
}

export async function submitMyWeek(req, weekStart) {
  const employee = await requireOwnEmployee(req);
  const t = await Timesheet.findOne({ employee: employee._id, weekStart: parseDateOnly(weekStart) });
  if (!t || !t.entries.length) throw conflict('Add at least one entry before submitting');
  if (!EDITABLE.includes(t.status)) throw conflict(`This timesheet is already ${t.status}`);
  t.status = 'submitted';
  t.submittedAt = new Date();
  t.history.push({ status: 'submitted', byName: req.auth.user.name, at: new Date(), comment: '' });
  await t.save();
  await recordAudit(req, { action: 'timesheet.submitted', entityType: 'Employee', entityId: employee._id, summary: `Submitted timesheet for week of ${weekStart}` });
  return toPublicTimesheet((await t.populate(POPULATE)).toObject());
}

export async function listTimesheets(req, { scope: which, status, employee, from, to, page, limit }) {
  const filter = {};
  if (which === 'approvals') {
    const scope = await moduleScope(req, { allPermission: APPROVAL.adminPermission, teamPermission: APPROVAL.teamPermission });
    if (!scope.all && !scope.ids.size) return { items: [], meta: { page, limit, total: 0, totalPages: 1 } };
    Object.assign(filter, scopeMatch(scope));
    const me = ownEmployeeId(req);
    if (me) filter.employee = { ...(filter.employee ?? {}), $ne: me };
    filter.status = status ?? 'submitted';
  } else {
    const scope = await moduleScope(req, SCOPE);
    if (which === 'mine') filter.employee = ownEmployeeId(req) ?? new mongoose.Types.ObjectId();
    else Object.assign(filter, scopeMatch(scope));
    if (employee) {
      if (!inScope(scope, employee)) throw notFound('Employee not found');
      filter.employee = employee;
    }
    if (status) filter.status = status;
  }
  if (from || to) filter.weekStart = { ...(from ? { $gte: parseDateOnly(weekStartOf(from)) } : {}), ...(to ? { $lte: parseDateOnly(to) } : {}) };
  const [items, total] = await Promise.all([
    Timesheet.find(filter).sort({ weekStart: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).populate(POPULATE).lean(),
    Timesheet.countDocuments(filter),
  ]);
  return { items: items.map(toPublicTimesheet), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function getTimesheet(req, id) {
  const t = await Timesheet.findById(id).populate(POPULATE).lean();
  if (!t) throw notFound('Timesheet not found');
  if (!inScope(await moduleScope(req, SCOPE), t.employee._id)) throw notFound('Timesheet not found');
  return toPublicTimesheet(t);
}

export async function decideTimesheet(req, id, { decision, comment }) {
  const t = await Timesheet.findById(id);
  if (!t) throw notFound('Timesheet not found');
  if (!(await canApprove(req, t.employee, APPROVAL))) {
    throw String(t.employee) === ownEmployeeId(req) ? forbidden('You cannot approve your own timesheet') : notFound('Timesheet not found');
  }
  if (t.status !== 'submitted') throw conflict(`This timesheet is ${t.status}, not awaiting approval`);
  Object.assign(t, { status: decision, decidedBy: req.auth.user._id, decidedByName: req.auth.user.name, decidedAt: new Date(), comment });
  t.history.push({ status: decision, byName: req.auth.user.name, at: new Date(), comment });
  await t.save();
  await recordAudit(req, { action: `timesheet.${decision}`, entityType: 'Employee', entityId: t.employee, summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} timesheet for week of ${toDateOnly(t.weekStart)}` });
  return toPublicTimesheet((await t.populate(POPULATE)).toObject());
}

/** Hours by employee and project for the actor's scope. Defaults to approved timesheets only. */
export async function report(req, { from, to, employee, project, status }) {
  const scope = await moduleScope(req, SCOPE);
  if (employee && !inScope(scope, employee)) throw notFound('Employee not found');
  const match = { ...scopeMatch(scope), status: status ?? 'approved', weekStart: { $gte: parseDateOnly(addDays(weekStartOf(from), 0)), $lte: parseDateOnly(to) } };
  if (employee) match.employee = new mongoose.Types.ObjectId(employee);
  const entryMatch = { 'entries.date': { $gte: parseDateOnly(from), $lte: parseDateOnly(to) } };
  if (project) entryMatch['entries.project'] = new mongoose.Types.ObjectId(project);
  const rows = await Timesheet.aggregate([
    { $match: match },
    { $unwind: '$entries' },
    { $match: entryMatch },
    { $group: { _id: { employee: '$employee', project: '$entries.project' }, minutes: { $sum: '$entries.minutes' } } },
    { $lookup: { from: 'employees', localField: '_id.employee', foreignField: '_id', as: 'employee' } },
    { $lookup: { from: 'projects', localField: '_id.project', foreignField: '_id', as: 'project' } },
    { $unwind: '$employee' },
    { $unwind: '$project' },
    { $sort: { 'employee.fullName': 1, 'project.name': 1 } },
    { $limit: 2000 },
  ]);
  return rows.map((r) => ({
    employee: { id: String(r.employee._id), fullName: r.employee.fullName, employeeCode: r.employee.employeeCode },
    project: { id: String(r.project._id), name: r.project.name, code: r.project.code },
    minutes: r.minutes,
  }));
}
