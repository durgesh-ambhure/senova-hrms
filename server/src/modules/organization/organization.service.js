import { Department } from './department.model.js';
import { Designation } from './designation.model.js';
import { Employee } from '../employees/employee.model.js';
import { diffFields, recordAudit } from '../audit/audit.service.js';
import { conflict, notFound, validationError } from '../../shared/errors.js';

const ACTIVE_EMPLOYEE = { archivedAt: null, lifecycleStatus: { $ne: 'exited' } };

async function countsBy(field) {
  const rows = await Employee.aggregate([{ $match: ACTIVE_EMPLOYEE }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

function toPublicDepartment(d, counts) {
  return {
    id: String(d._id),
    name: d.name,
    code: d.code,
    description: d.description,
    head: d.head ? { id: String(d.head._id ?? d.head), name: d.head.fullName ?? null } : null,
    status: d.status,
    ...(counts ? { employeeCount: counts.get(String(d._id)) ?? 0 } : {}),
    updatedAt: d.updatedAt,
  };
}

function toPublicDesignation(d, counts) {
  return {
    id: String(d._id),
    title: d.title,
    level: d.level,
    description: d.description,
    status: d.status,
    ...(counts ? { employeeCount: counts.get(String(d._id)) ?? 0 } : {}),
    updatedAt: d.updatedAt,
  };
}

// Departments

export async function listDepartments({ includeArchived }) {
  const filter = includeArchived === 'true' ? {} : { status: 'active' };
  const [items, counts] = await Promise.all([
    Department.find(filter).sort({ name: 1 }).populate('head', 'fullName').lean(),
    countsBy('department'),
  ]);
  return items.map((d) => toPublicDepartment(d, counts));
}

async function assertHead(headId) {
  if (!headId) return null;
  const head = await Employee.findOne({ _id: headId, ...ACTIVE_EMPLOYEE }, { _id: 1 }).lean();
  if (!head) throw validationError([{ path: 'headId', message: 'Department head must be a current employee' }]);
  return head._id;
}

async function assertUniqueDepartment({ name, code }, exceptId) {
  const or = [];
  if (name) or.push({ nameKey: name.trim().toLowerCase() });
  if (code) or.push({ code });
  if (!or.length) return;
  const clash = await Department.findOne({ $or: or, _id: { $ne: exceptId } }).lean();
  if (clash) throw conflict(clash.code === code ? 'A department with this code already exists' : 'A department with this name already exists');
}

export async function createDepartment(req, { headId, ...input }) {
  await assertUniqueDepartment(input);
  const head = await assertHead(headId);
  const dept = await Department.create({ ...input, head, createdBy: req.auth.user._id, updatedBy: req.auth.user._id });
  await recordAudit(req, { action: 'department.created', entityType: 'Department', entityId: dept._id, summary: `Created department ${dept.name}` });
  return toPublicDepartment(dept.toObject());
}

export async function updateDepartment(req, id, { headId, ...changes }) {
  const dept = await Department.findById(id);
  if (!dept) throw notFound('Department not found');
  await assertUniqueDepartment(changes, dept._id);
  if (changes.status === 'archived' && dept.status !== 'archived') {
    const inUse = await Employee.countDocuments({ department: dept._id, ...ACTIVE_EMPLOYEE });
    if (inUse) throw conflict(`Move the ${inUse} current employee(s) out of this department before archiving it`);
  }
  const before = dept.toObject();
  if (headId !== undefined) dept.head = await assertHead(headId);
  Object.assign(dept, changes, { updatedBy: req.auth.user._id });
  await dept.save();
  await recordAudit(req, {
    action: 'department.updated',
    entityType: 'Department',
    entityId: dept._id,
    summary: `Updated department ${dept.name}`,
    changes: diffFields(before, dept.toObject(), ['name', 'code', 'description', 'head', 'status']),
  });
  return toPublicDepartment((await dept.populate('head', 'fullName')).toObject());
}

// Designations

export async function listDesignations({ includeArchived }) {
  const filter = includeArchived === 'true' ? {} : { status: 'active' };
  const [items, counts] = await Promise.all([Designation.find(filter).sort({ level: 1, title: 1 }).lean(), countsBy('designation')]);
  return items.map((d) => toPublicDesignation(d, counts));
}

export async function createDesignation(req, input) {
  if (await Designation.exists({ titleKey: input.title.toLowerCase() })) throw conflict('A designation with this title already exists');
  const d = await Designation.create({ ...input, createdBy: req.auth.user._id, updatedBy: req.auth.user._id });
  await recordAudit(req, { action: 'designation.created', entityType: 'Designation', entityId: d._id, summary: `Created designation ${d.title}` });
  return toPublicDesignation(d.toObject());
}

export async function updateDesignation(req, id, changes) {
  const d = await Designation.findById(id);
  if (!d) throw notFound('Designation not found');
  if (changes.title && (await Designation.exists({ titleKey: changes.title.toLowerCase(), _id: { $ne: d._id } }))) {
    throw conflict('A designation with this title already exists');
  }
  if (changes.status === 'archived' && d.status !== 'archived') {
    const inUse = await Employee.countDocuments({ designation: d._id, ...ACTIVE_EMPLOYEE });
    if (inUse) throw conflict(`${inUse} current employee(s) hold this designation; reassign them before archiving it`);
  }
  const before = d.toObject();
  Object.assign(d, changes, { updatedBy: req.auth.user._id });
  await d.save();
  await recordAudit(req, {
    action: 'designation.updated',
    entityType: 'Designation',
    entityId: d._id,
    summary: `Updated designation ${d.title}`,
    changes: diffFields(before, d.toObject(), ['title', 'level', 'description', 'status']),
  });
  return toPublicDesignation(d.toObject());
}
