import { OnboardingTemplate } from './onboardingTemplate.model.js';
import { OnboardingTask } from './onboardingTask.model.js';
import { Employee } from '../employees/employee.model.js';
import { getSettings } from '../company/company.service.js';
import { hasPermission } from '../roles/permissions.js';
import { recordAudit } from '../audit/audit.service.js';
import { withTransaction } from '../../db/transaction.js';
import { conflict, forbidden, notFound } from '../../shared/errors.js';
import { addDays, parseDateOnly, toDateOnly, todayIn } from '../../shared/dates.js';

const isHr = (req) => hasPermission(req.auth.permissions, 'onboarding:manage');
const myEmployeeId = (req) => (req.auth.user.employee ? String(req.auth.user.employee) : null);

function toPublicTemplate(t) {
  return {
    id: String(t._id),
    name: t.name,
    kind: t.kind,
    description: t.description,
    isActive: t.isActive,
    tasks: t.tasks.map((x) => ({
      id: String(x._id),
      title: x.title,
      description: x.description,
      assigneeType: x.assigneeType,
      dueOffsetDays: x.dueOffsetDays,
      documentCategory: x.documentCategory,
    })),
    updatedAt: t.updatedAt,
  };
}

export function toPublicTask(t, today) {
  return {
    id: String(t._id),
    employee: t.employee?._id
      ? { id: String(t.employee._id), fullName: t.employee.fullName, employeeCode: t.employee.employeeCode }
      : { id: String(t.employee) },
    kind: t.kind,
    templateName: t.templateName,
    title: t.title,
    description: t.description,
    assigneeType: t.assigneeType,
    dueDate: toDateOnly(t.dueDate),
    overdue: t.status === 'pending' && today ? toDateOnly(t.dueDate) < today : false,
    documentCategory: t.documentCategory,
    document: t.document ? String(t.document) : null,
    status: t.status,
    completedAt: t.completedAt,
    completedByName: t.completedByName,
    note: t.note,
  };
}

const companyToday = async () => todayIn((await getSettings()).timezone);

// Templates

export async function listTemplates() {
  const items = await OnboardingTemplate.find().sort({ kind: 1, name: 1 }).lean();
  return items.map(toPublicTemplate);
}

export async function createTemplate(req, input) {
  const t = await OnboardingTemplate.create({ ...input, createdBy: req.auth.user._id, updatedBy: req.auth.user._id });
  await recordAudit(req, { action: 'checklist.created', entityType: 'OnboardingTemplate', entityId: t._id, summary: `Created ${t.kind} checklist "${t.name}"` });
  return toPublicTemplate(t.toObject());
}

export async function updateTemplate(req, id, input) {
  const t = await OnboardingTemplate.findById(id);
  if (!t) throw notFound('Checklist not found');
  Object.assign(t, input, { updatedBy: req.auth.user._id });
  await t.save();
  await recordAudit(req, { action: 'checklist.updated', entityType: 'OnboardingTemplate', entityId: t._id, summary: `Updated checklist "${t.name}"` });
  return toPublicTemplate(t.toObject());
}

// Assigning checklists

export async function startChecklist(req, employeeId, { templateId }) {
  const [employee, template] = await Promise.all([
    Employee.findOne({ _id: employeeId, archivedAt: null }).lean(),
    OnboardingTemplate.findOne({ _id: templateId, isActive: true }).lean(),
  ]);
  if (!employee) throw notFound('Employee not found');
  if (!template) throw notFound('Checklist not found or inactive');
  if (template.kind === 'onboarding' && employee.lifecycleStatus === 'exited') throw conflict('This employee has exited');
  if (template.kind === 'offboarding' && !['notice_period', 'exited'].includes(employee.lifecycleStatus)) {
    throw conflict('Start offboarding once the employee is serving notice');
  }

  const today = await companyToday();
  const anchor =
    template.kind === 'onboarding' ? toDateOnly(employee.joiningDate) : toDateOnly(employee.exit?.lastWorkingDate ?? employee.exit?.exitDate) ?? today;

  const created = await withTransaction(async (session) => {
    if (await OnboardingTask.exists({ employee: employee._id, template: template._id }).session(session)) {
      throw conflict(`"${template.name}" has already been started for this employee`);
    }
    const maxOrder = (await OnboardingTask.findOne({ employee: employee._id, kind: template.kind }).sort({ order: -1 }).session(session).lean())?.order ?? 0;
    const docs = template.tasks.map((t, i) => ({
      employee: employee._id,
      kind: template.kind,
      template: template._id,
      templateName: template.name,
      title: t.title,
      description: t.description,
      assigneeType: t.assigneeType,
      dueDate: parseDateOnly(addDays(anchor, t.dueOffsetDays)),
      documentCategory: t.documentCategory,
      order: maxOrder + i + 1,
      createdBy: req.auth.user._id,
    }));
    const tasks = await OnboardingTask.insertMany(docs, { session });
    await recordAudit(
      req,
      { action: `${template.kind}.started`, entityType: 'Employee', entityId: employee._id, summary: `Started "${template.name}" (${tasks.length} tasks) for ${employee.fullName}` },
      session,
    );
    return tasks;
  });
  return created.map((t) => toPublicTask(t.toObject(), today));
}

export async function addTask(req, employeeId, input) {
  const employee = await Employee.findOne({ _id: employeeId, archivedAt: null }, { fullName: 1 }).lean();
  if (!employee) throw notFound('Employee not found');
  const maxOrder = (await OnboardingTask.findOne({ employee: employee._id, kind: input.kind }).sort({ order: -1 }).lean())?.order ?? 0;
  const task = await OnboardingTask.create({ ...input, dueDate: parseDateOnly(input.dueDate), employee: employee._id, order: maxOrder + 1, createdBy: req.auth.user._id });
  await recordAudit(req, { action: 'checklist.task_added', entityType: 'Employee', entityId: employee._id, summary: `Added task "${task.title}" for ${employee.fullName}` });
  return toPublicTask(task.toObject(), await companyToday());
}

// Viewing tasks

/** HR, the employee, and the employee's reporting manager may see an employee's checklist. */
async function assertCanSeeEmployeeTasks(req, employeeId) {
  if (isHr(req)) return;
  const me = myEmployeeId(req);
  if (me && me === String(employeeId) && hasPermission(req.auth.permissions, 'self:onboarding')) return;
  if (me && (await Employee.exists({ _id: employeeId, reportingManager: me }))) return;
  throw notFound('Employee not found');
}

export async function listEmployeeTasks(req, employeeId, { kind }) {
  await assertCanSeeEmployeeTasks(req, employeeId);
  const filter = { employee: employeeId };
  if (kind) filter.kind = kind;
  const [tasks, today] = await Promise.all([OnboardingTask.find(filter).sort({ kind: 1, order: 1 }).lean(), companyToday()]);
  return tasks.map((t) => toPublicTask(t, today));
}

/** Tasks the signed-in user must act on: their own, and manager tasks for their direct reports. */
export async function listMyTasks(req) {
  const me = myEmployeeId(req);
  if (!me) return [];
  const reports = await Employee.find({ reportingManager: me, archivedAt: null }, { _id: 1 }).lean();
  const filter = {
    status: 'pending',
    $or: [
      ...(hasPermission(req.auth.permissions, 'self:onboarding') ? [{ employee: me, assigneeType: 'employee' }] : []),
      { employee: { $in: reports.map((r) => r._id) }, assigneeType: 'manager' },
    ],
  };
  const [tasks, today] = await Promise.all([
    OnboardingTask.find(filter).sort({ dueDate: 1 }).limit(200).populate('employee', 'fullName employeeCode').lean(),
    companyToday(),
  ]);
  return tasks.map((t) => toPublicTask(t, today));
}

/** HR progress board: one row per employee with an onboarding/offboarding checklist. */
export async function getOverview({ kind, state }) {
  const today = await companyToday();
  const rows = await OnboardingTask.aggregate([
    { $match: { kind } },
    {
      $group: {
        _id: '$employee',
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        waived: { $sum: { $cond: [{ $eq: ['$status', 'waived'] }, 1, 0] } },
        overdue: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'pending'] }, { $lt: ['$dueDate', parseDateOnly(today)] }] }, 1, 0] } },
        nextDue: { $min: { $cond: [{ $eq: ['$status', 'pending'] }, '$dueDate', null] } },
        lastCompletedAt: { $max: '$completedAt' },
      },
    },
    { $addFields: { open: { $subtract: ['$total', { $add: ['$completed', '$waived'] }] } } },
    ...(state === 'open' ? [{ $match: { open: { $gt: 0 } } }] : state === 'completed' ? [{ $match: { open: 0 } }] : []),
    { $lookup: { from: 'employees', localField: '_id', foreignField: '_id', as: 'employee' } },
    { $unwind: '$employee' },
    { $match: { 'employee.archivedAt': null } },
    { $lookup: { from: 'departments', localField: 'employee.department', foreignField: '_id', as: 'department' } },
    { $sort: { overdue: -1, nextDue: 1 } },
    { $limit: 500 },
  ]);
  return rows.map((r) => ({
    employee: {
      id: String(r.employee._id),
      fullName: r.employee.fullName,
      employeeCode: r.employee.employeeCode,
      joiningDate: toDateOnly(r.employee.joiningDate),
      lifecycleStatus: r.employee.lifecycleStatus,
      department: r.department[0]?.name ?? null,
    },
    total: r.total,
    completed: r.completed,
    waived: r.waived,
    open: r.open,
    overdue: r.overdue,
    progress: Math.round(((r.completed + r.waived) / r.total) * 100),
    nextDue: toDateOnly(r.nextDue),
    lastCompletedAt: r.lastCompletedAt,
  }));
}

// Acting on tasks

async function assertCanComplete(req, task) {
  if (isHr(req)) return;
  const me = myEmployeeId(req);
  if (task.assigneeType === 'employee' && me === String(task.employee) && hasPermission(req.auth.permissions, 'self:onboarding')) return;
  if (task.assigneeType === 'manager' && me && (await Employee.exists({ _id: task.employee, reportingManager: me }))) return;
  throw forbidden('This task is assigned to someone else');
}

async function loadTask(req, id) {
  const task = await OnboardingTask.findById(id);
  if (!task) throw notFound('Task not found');
  try {
    await assertCanSeeEmployeeTasks(req, task.employee);
  } catch {
    throw notFound('Task not found');
  }
  return task;
}

export async function completeTask(req, id, { note }) {
  const task = await loadTask(req, id);
  await assertCanComplete(req, task);
  if (task.status !== 'pending') throw conflict(`This task is already ${task.status}`);
  if (task.documentCategory && !task.document) throw conflict('Upload the required document before completing this task');
  Object.assign(task, { status: 'completed', completedAt: new Date(), completedBy: req.auth.user._id, completedByName: req.auth.user.name, note });
  await task.save();
  await recordAudit(req, { action: `${task.kind}.task_completed`, entityType: 'Employee', entityId: task.employee, summary: `Completed "${task.title}"` });
  return toPublicTask(task.toObject(), await companyToday());
}

export async function waiveTask(req, id, { note }) {
  const task = await loadTask(req, id);
  if (task.status !== 'pending') throw conflict(`This task is already ${task.status}`);
  Object.assign(task, { status: 'waived', completedAt: new Date(), completedBy: req.auth.user._id, completedByName: req.auth.user.name, note });
  await task.save();
  await recordAudit(req, { action: `${task.kind}.task_waived`, entityType: 'Employee', entityId: task.employee, summary: `Waived "${task.title}"${note ? `: ${note}` : ''}` });
  return toPublicTask(task.toObject(), await companyToday());
}

export async function reopenTask(req, id, { note }) {
  const task = await loadTask(req, id);
  if (task.status === 'pending') throw conflict('This task is already open');
  Object.assign(task, { status: 'pending', completedAt: null, completedBy: null, completedByName: null, note });
  await task.save();
  await recordAudit(req, { action: `${task.kind}.task_reopened`, entityType: 'Employee', entityId: task.employee, summary: `Reopened "${task.title}"` });
  return toPublicTask(task.toObject(), await companyToday());
}

export async function countPendingHrTasks() {
  return OnboardingTask.countDocuments({ status: 'pending', assigneeType: 'hr' });
}
