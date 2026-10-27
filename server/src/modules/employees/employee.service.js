import { Employee } from './employee.model.js';
import { EmploymentEvent } from './employmentEvent.model.js';
import { EmployeeSensitive } from './employeeSensitive.model.js';
import { getEmployeeScope, getReportIds, scopeFilter, viewLevel } from './employee.policy.js';
import { Department } from '../organization/department.model.js';
import { Designation } from '../organization/designation.model.js';
import { Shift } from '../attendance/shift.model.js';
import { User } from '../users/user.model.js';
import { createUser } from '../users/user.service.js';
import { getSettings } from '../company/company.service.js';
import { recordAudit } from '../audit/audit.service.js';
import { hasPermission } from '../roles/permissions.js';
import { nextSequence } from '../../db/counter.model.js';
import { withTransaction } from '../../db/transaction.js';
import { badRequest, conflict, forbidden, notFound, validationError } from '../../shared/errors.js';
import { escapeRegex, paginate } from '../../shared/pagination.js';
import { parseDateOnly, toDateOnly, todayIn } from '../../shared/dates.js';
import { decryptField, encryptField, last4 } from '../../shared/security/fieldEncryption.js';

const POPULATE = [
  { path: 'department', select: 'name code' },
  { path: 'designation', select: 'title level' },
  { path: 'reportingManager', select: 'fullName employeeCode' },
  { path: 'shift', select: 'name code startTime endTime' },
];

const ref = (doc, label) => (doc ? { id: String(doc._id ?? doc), [label]: doc[label] ?? null } : null);

/** Shapes an employee for the API. `team` level omits personal details. */
export function toPublicEmployee(e, level) {
  const basic = {
    id: String(e._id),
    employeeCode: e.employeeCode,
    firstName: e.firstName,
    middleName: e.middleName,
    lastName: e.lastName,
    fullName: e.fullName,
    workEmail: e.workEmail,
    phone: e.phone,
    department: ref(e.department, 'name'),
    designation: ref(e.designation, 'title'),
    reportingManager: e.reportingManager ? { id: String(e.reportingManager._id ?? e.reportingManager), fullName: e.reportingManager.fullName ?? null } : null,
    employmentType: e.employmentType,
    workLocation: e.workLocation,
    shift: e.shift ? { id: String(e.shift._id ?? e.shift), name: e.shift.name ?? null } : null,
    joiningDate: toDateOnly(e.joiningDate),
    lifecycleStatus: e.lifecycleStatus,
    probation: { status: e.probation?.status, endDate: toDateOnly(e.probation?.endDate) },
    archived: Boolean(e.archivedAt),
    viewLevel: level,
  };
  if (level !== 'full') return basic;
  return {
    ...basic,
    personalEmail: e.personalEmail,
    dateOfBirth: toDateOnly(e.dateOfBirth),
    gender: e.gender,
    currentAddress: e.currentAddress ?? {},
    permanentAddress: e.permanentAddress ?? {},
    emergencyContact: e.emergencyContact ?? {},
    probation: { ...basic.probation, confirmedOn: toDateOnly(e.probation?.confirmedOn) },
    exit: {
      resignationDate: toDateOnly(e.exit?.resignationDate),
      lastWorkingDate: toDateOnly(e.exit?.lastWorkingDate),
      exitDate: toDateOnly(e.exit?.exitDate),
      reason: e.exit?.reason ?? '',
    },
    archivedAt: e.archivedAt,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

async function companyToday() {
  return todayIn((await getSettings()).timezone);
}

async function addEvent(req, employeeId, { type, effectiveDate, from = null, to = null, note = '' }, session) {
  await EmploymentEvent.create(
    [
      {
        employee: employeeId,
        type,
        effectiveDate: parseDateOnly(effectiveDate),
        from: from === null ? null : String(from),
        to: to === null ? null : String(to),
        note,
        actor: req.auth.user._id,
        actorName: req.auth.user.name,
      },
    ],
    { session },
  );
}

async function loadOrgRefs({ departmentId, designationId, reportingManagerId, shiftId }, employeeId) {
  const refs = {};
  if (shiftId !== undefined) {
    refs.shift = null;
    if (shiftId) {
      refs.shift = await Shift.findOne({ _id: shiftId, status: 'active' }, { name: 1 }).lean();
      if (!refs.shift) throw validationError([{ path: 'shiftId', message: 'Choose an active shift' }]);
    }
  }
  if (departmentId !== undefined) {
    const d = await Department.findOne({ _id: departmentId, status: 'active' }, { name: 1 }).lean();
    if (!d) throw validationError([{ path: 'departmentId', message: 'Choose an active department' }]);
    refs.department = d;
  }
  if (designationId !== undefined) {
    const d = await Designation.findOne({ _id: designationId, status: 'active' }, { title: 1 }).lean();
    if (!d) throw validationError([{ path: 'designationId', message: 'Choose an active designation' }]);
    refs.designation = d;
  }
  if (reportingManagerId !== undefined) {
    refs.reportingManager = null;
    if (reportingManagerId) {
      if (employeeId && String(reportingManagerId) === String(employeeId)) {
        throw validationError([{ path: 'reportingManagerId', message: 'An employee cannot report to themselves' }]);
      }
      const m = await Employee.findOne({ _id: reportingManagerId, archivedAt: null, lifecycleStatus: { $in: ['active', 'notice_period'] } }, { fullName: 1 }).lean();
      if (!m) throw validationError([{ path: 'reportingManagerId', message: 'Reporting manager must be a current employee' }]);
      if (employeeId && (await getReportIds(employeeId)).has(String(m._id))) {
        throw validationError([{ path: 'reportingManagerId', message: `${m.fullName} reports to this employee; that would create a reporting loop` }]);
      }
      refs.reportingManager = m;
    }
  }
  return refs;
}

async function assertWorkEmailFree(workEmail, exceptId) {
  if (await Employee.exists({ workEmail, _id: { $ne: exceptId } })) {
    throw conflict('Another employee already uses this work email', [{ path: 'workEmail', message: 'Already in use' }]);
  }
}

const toDates = (input, fields) => {
  const out = { ...input };
  for (const f of fields) if (out[f] !== undefined) out[f] = out[f] === null ? null : parseDateOnly(out[f]);
  return out;
};

// Directory

export async function listEmployees(req, q) {
  const scope = await getEmployeeScope(req);
  if (!scope.all && !scope.teamIds.size) return { items: [], meta: { page: q.page, limit: q.limit, total: 0, totalPages: 1 } };

  const filter = { ...scopeFilter(scope) };
  if (!(scope.all && q.includeArchived === 'true')) filter.archivedAt = null;
  if (q.department) filter.department = q.department;
  if (q.designation) filter.designation = q.designation;
  if (q.employmentType) filter.employmentType = q.employmentType;
  if (q.status) filter.lifecycleStatus = q.status;
  if (q.manager) filter.reportingManager = q.manager;
  if (q.search) {
    const rx = { $regex: escapeRegex(q.search), $options: 'i' };
    filter.$or = [{ fullName: rx }, { employeeCode: rx }, { workEmail: rx }];
  }
  const { items, meta } = await paginate(Employee, filter, q, { populate: POPULATE });
  return { items: items.map((e) => toPublicEmployee(e, viewLevel(scope, e._id))), meta };
}

// Single record

async function findVisible(req, id) {
  const scope = await getEmployeeScope(req);
  const level = viewLevel(scope, id);
  // 404 rather than 403, so IDs of employees outside the actor's scope cannot be probed.
  if (!level) throw notFound('Employee not found');
  const employee = await Employee.findById(id).populate(POPULATE).lean();
  if (!employee || (employee.archivedAt && !scope.all)) throw notFound('Employee not found');
  return { employee, level, scope };
}

export async function getEmployee(req, id) {
  const { employee, level } = await findVisible(req, id);
  const result = toPublicEmployee(employee, level);
  if (hasPermission(req.auth.permissions, 'users:read')) {
    const account = await User.findOne({ employee: employee._id }, { status: 1, email: 1 }).lean();
    result.account = account ? { id: String(account._id), status: account.status, email: account.email } : null;
  }
  return result;
}

export async function getOwnEmployee(req) {
  if (!req.auth.user.employee) throw notFound('No employee profile is linked to your account');
  return getEmployee(req, req.auth.user.employee);
}

export async function getHistory(req, id) {
  const { level } = await findVisible(req, id);
  if (level !== 'full') throw forbidden();
  const events = await EmploymentEvent.find({ employee: id }).sort({ effectiveDate: -1, createdAt: -1 }).limit(200).lean();
  return events.map((ev) => ({
    id: String(ev._id),
    type: ev.type,
    effectiveDate: toDateOnly(ev.effectiveDate),
    from: ev.from,
    to: ev.to,
    note: ev.note,
    actorName: ev.actorName,
    createdAt: ev.createdAt,
  }));
}

// Create / update

/**
 * Creates an employee. Pass `session` to run inside the caller's transaction (e.g. hiring a candidate);
 * the created document is then returned instead of the API shape.
 */
export async function createEmployee(req, input, { session: outer, sourceApplication = null } = {}) {
  const { departmentId, designationId, reportingManagerId, shiftId, probationEndDate, ...rest } = input;
  await assertWorkEmailFree(rest.workEmail);
  const refs = await loadOrgRefs({ departmentId, designationId, reportingManagerId, shiftId });
  const settings = await getSettings();
  const today = todayIn(settings.timezone);
  const lifecycleStatus = rest.joiningDate > today ? 'pre_joining' : 'active';

  const employee = await withTransaction(async (session) => {
    if (sourceApplication && (await Employee.exists({ sourceApplication }).session(session))) {
      throw conflict('This candidate has already been converted to an employee');
    }
    const seq = await nextSequence('employeeCode', session);
    const [created] = await Employee.create(
      [
        {
          ...toDates(rest, ['joiningDate', 'dateOfBirth']),
          employeeCode: `${settings.employeeCodePrefix}-${String(seq).padStart(4, '0')}`,
          department: refs.department._id,
          designation: refs.designation._id,
          reportingManager: refs.reportingManager?._id ?? null,
          shift: refs.shift?._id ?? null,
          sourceApplication,
          lifecycleStatus,
          probation: probationEndDate ? { status: 'on_probation', endDate: parseDateOnly(probationEndDate) } : { status: 'not_applicable' },
          createdBy: req.auth.user._id,
          updatedBy: req.auth.user._id,
        },
      ],
      { session },
    );
    await addEvent(req, created._id, { type: 'created', effectiveDate: today, to: lifecycleStatus }, session);
    if (lifecycleStatus === 'active') await addEvent(req, created._id, { type: 'joined', effectiveDate: rest.joiningDate }, session);
    await recordAudit(req, { action: 'employee.created', entityType: 'Employee', entityId: created._id, summary: `Created employee ${created.employeeCode} ${created.fullName}` }, session);
    return created;
  }, { session: outer });
  return outer ? employee : getEmployee(req, employee._id);
}

const ORG_EVENTS = [
  ['department', 'department_changed', (d) => d?.name],
  ['designation', 'designation_changed', (d) => d?.title],
  ['reportingManager', 'manager_changed', (d) => d?.fullName ?? 'None'],
  ['shift', 'shift_changed', (d) => d?.name ?? 'Company default'],
];

export async function updateEmployee(req, id, input) {
  const { departmentId, designationId, reportingManagerId, shiftId, probationEndDate, effectiveDate, ...rest } = input;
  const employee = await Employee.findById(id).populate(POPULATE);
  if (!employee) throw notFound('Employee not found');
  if (employee.archivedAt) throw conflict('Restore this employee before editing');
  if (rest.workEmail) await assertWorkEmailFree(rest.workEmail, employee._id);
  if (rest.joiningDate && employee.lifecycleStatus !== 'pre_joining' && rest.joiningDate !== toDateOnly(employee.joiningDate)) {
    throw conflict('The joining date can only be changed before the employee joins');
  }
  if (probationEndDate !== undefined) {
    if (employee.probation.status === 'confirmed') throw conflict('Probation is already confirmed');
    const joining = rest.joiningDate ?? toDateOnly(employee.joiningDate);
    if (probationEndDate && probationEndDate <= joining) {
      throw validationError([{ path: 'probationEndDate', message: 'Probation must end after the joining date' }]);
    }
  }
  const refs = await loadOrgRefs({ departmentId, designationId, reportingManagerId, shiftId }, employee._id);
  const when = effectiveDate ?? (await companyToday());

  await withTransaction(async (session) => {
    const doc = await Employee.findById(id).session(session);
    for (const [field, type, label] of ORG_EVENTS) {
      if (refs[field] === undefined) continue;
      const before = employee[field];
      const after = refs[field];
      if (String(before?._id ?? null) === String(after?._id ?? null)) continue;
      doc[field] = after?._id ?? null;
      await addEvent(req, doc._id, { type, effectiveDate: when, from: label(before) ?? null, to: label(after) ?? null }, session);
    }
    if (rest.employmentType && rest.employmentType !== doc.employmentType) {
      await addEvent(req, doc._id, { type: 'employment_type_changed', effectiveDate: when, from: doc.employmentType, to: rest.employmentType }, session);
    }
    if (rest.workLocation !== undefined && rest.workLocation !== doc.workLocation) {
      await addEvent(req, doc._id, { type: 'location_changed', effectiveDate: when, from: doc.workLocation || null, to: rest.workLocation || null }, session);
    }
    for (const key of ['currentAddress', 'permanentAddress', 'emergencyContact']) {
      if (rest[key]) rest[key] = { ...(doc.toObject()[key] ?? {}), ...rest[key] };
    }
    Object.assign(doc, toDates(rest, ['joiningDate', 'dateOfBirth']), { updatedBy: req.auth.user._id });
    if (probationEndDate !== undefined) {
      doc.probation.endDate = probationEndDate ? parseDateOnly(probationEndDate) : null;
      if (!probationEndDate) doc.probation.status = 'not_applicable';
      else if (doc.probation.status === 'not_applicable') doc.probation.status = 'on_probation';
    }
    const changed = doc.modifiedPaths().filter((p) => !p.includes('.') && p !== 'updatedBy' && p !== 'fullName');
    await doc.save({ session });
    await recordAudit(
      req,
      { action: 'employee.updated', entityType: 'Employee', entityId: doc._id, summary: `Updated ${doc.employeeCode} (${changed.join(', ') || 'no changes'})`, changes: { fields: changed } },
      session,
    );
  });
  return getEmployee(req, id);
}

export async function updateOwnEmployee(req, input) {
  if (!req.auth.user.employee) throw notFound('No employee profile is linked to your account');
  const doc = await Employee.findById(req.auth.user.employee);
  if (!doc || doc.archivedAt) throw notFound('Employee not found');
  for (const key of ['currentAddress', 'emergencyContact']) {
    if (input[key]) input[key] = { ...(doc.toObject()[key] ?? {}), ...input[key] };
  }
  Object.assign(doc, input, { updatedBy: req.auth.user._id });
  const changed = doc.modifiedPaths().filter((p) => !p.includes('.') && p !== 'updatedBy');
  await doc.save();
  await recordAudit(req, { action: 'employee.self_updated', entityType: 'Employee', entityId: doc._id, summary: `${doc.fullName} updated their own profile`, changes: { fields: changed } });
  return getEmployee(req, doc._id);
}

// Lifecycle

export const LIFECYCLE_TRANSITIONS = {
  activate: { from: ['pre_joining'], to: 'active', event: 'joined' },
  start_notice: { from: ['active'], to: 'notice_period', event: 'notice_started' },
  withdraw_notice: { from: ['notice_period'], to: 'active', event: 'notice_withdrawn' },
  exit: { from: ['pre_joining', 'active', 'notice_period'], to: 'exited', event: 'exited' },
};

export async function changeLifecycle(req, id, input) {
  const rule = LIFECYCLE_TRANSITIONS[input.action];
  const today = await companyToday();

  await withTransaction(async (session) => {
    const doc = await Employee.findById(id).session(session);
    if (!doc || doc.archivedAt) throw notFound('Employee not found');
    if (!rule.from.includes(doc.lifecycleStatus)) {
      throw conflict(`Cannot ${input.action.replace('_', ' ')} an employee who is ${doc.lifecycleStatus.replace('_', ' ')}`);
    }
    const from = doc.lifecycleStatus;
    const joining = toDateOnly(doc.joiningDate);

    if (input.action === 'activate') {
      if (input.effectiveDate > today) throw badRequest('An employee cannot join on a future date');
      doc.joiningDate = parseDateOnly(input.effectiveDate);
    }
    if (input.action === 'start_notice') {
      if (input.lastWorkingDate < input.effectiveDate) {
        throw validationError([{ path: 'lastWorkingDate', message: 'Last working day cannot be before the resignation date' }]);
      }
      doc.exit = { resignationDate: parseDateOnly(input.effectiveDate), lastWorkingDate: parseDateOnly(input.lastWorkingDate), exitDate: null, reason: input.reason };
    }
    if (input.action === 'withdraw_notice') doc.exit = { resignationDate: null, lastWorkingDate: null, exitDate: null, reason: '' };
    if (input.action === 'exit') {
      if (from !== 'pre_joining' && input.effectiveDate < joining) throw badRequest('Exit date cannot be before the joining date');
      doc.exit.exitDate = parseDateOnly(input.effectiveDate);
      doc.exit.reason = input.reason;
      // Leavers lose system access immediately.
      const account = await User.findOne({ employee: doc._id, status: { $ne: 'disabled' } }).session(session);
      if (account) {
        account.status = 'disabled';
        account.authVersion += 1;
        await account.save({ session });
        await recordAudit(req, { action: 'user.disabled', entityType: 'User', entityId: account._id, summary: `Disabled ${account.email} on employee exit` }, session);
      }
    }
    doc.lifecycleStatus = rule.to;
    doc.updatedBy = req.auth.user._id;
    await doc.save({ session });
    await addEvent(req, doc._id, { type: rule.event, effectiveDate: input.effectiveDate, from, to: rule.to, note: input.reason ?? input.note ?? '' }, session);
    await recordAudit(
      req,
      { action: `employee.${rule.event}`, entityType: 'Employee', entityId: doc._id, summary: `${doc.employeeCode}: ${from} → ${rule.to}`, changes: { lifecycleStatus: { from, to: rule.to } } },
      session,
    );
  });
  return getEmployee(req, id);
}

export async function changeProbation(req, id, input) {
  await withTransaction(async (session) => {
    const doc = await Employee.findById(id).session(session);
    if (!doc || doc.archivedAt) throw notFound('Employee not found');
    if (!['on_probation', 'extended'].includes(doc.probation.status)) throw conflict('This employee is not on probation');
    if (!['active', 'notice_period'].includes(doc.lifecycleStatus)) throw conflict('Probation can only be changed for current employees');
    const from = doc.probation.status;
    if (input.action === 'confirm') {
      if (input.effectiveDate < toDateOnly(doc.joiningDate)) throw badRequest('Confirmation date cannot be before the joining date');
      doc.probation.status = 'confirmed';
      doc.probation.confirmedOn = parseDateOnly(input.effectiveDate);
    } else {
      if (doc.probation.endDate && input.newEndDate <= toDateOnly(doc.probation.endDate)) {
        throw validationError([{ path: 'newEndDate', message: 'The new end date must be after the current one' }]);
      }
      doc.probation.status = 'extended';
      doc.probation.endDate = parseDateOnly(input.newEndDate);
    }
    doc.updatedBy = req.auth.user._id;
    await doc.save({ session });
    const type = input.action === 'confirm' ? 'probation_confirmed' : 'probation_extended';
    await addEvent(req, doc._id, { type, effectiveDate: input.effectiveDate ?? (await companyToday()), from, to: doc.probation.status, note: input.note }, session);
    await recordAudit(req, { action: `employee.${type}`, entityType: 'Employee', entityId: doc._id, summary: `${doc.employeeCode}: probation ${doc.probation.status}` }, session);
  });
  return getEmployee(req, id);
}

export async function setArchived(req, id, archived) {
  const today = await companyToday();
  await withTransaction(async (session) => {
    const doc = await Employee.findById(id).session(session);
    if (!doc) throw notFound('Employee not found');
    if (archived) {
      if (doc.archivedAt) throw conflict('Employee is already archived');
      if (!['pre_joining', 'exited'].includes(doc.lifecycleStatus)) throw conflict('Only exited or not-yet-joined employees can be archived');
      if (await Employee.exists({ reportingManager: doc._id, archivedAt: null, lifecycleStatus: { $ne: 'exited' } }).session(session)) {
        throw conflict('Reassign this employee’s direct reports before archiving');
      }
      doc.archivedAt = new Date();
    } else {
      if (!doc.archivedAt) throw conflict('Employee is not archived');
      doc.archivedAt = null;
    }
    doc.updatedBy = req.auth.user._id;
    await doc.save({ session });
    await addEvent(req, doc._id, { type: archived ? 'archived' : 'restored', effectiveDate: today }, session);
    await recordAudit(req, { action: archived ? 'employee.archived' : 'employee.restored', entityType: 'Employee', entityId: doc._id, summary: `${archived ? 'Archived' : 'Restored'} ${doc.employeeCode}` }, session);
  });
  return getEmployee(req, id);
}

// Login account

export async function createAccount(req, id, roles = ['employee']) {
  const employee = await Employee.findById(id).lean();
  if (!employee || employee.archivedAt) throw notFound('Employee not found');
  if (employee.lifecycleStatus === 'exited') throw conflict('Exited employees cannot be given a login');
  if (await User.exists({ employee: employee._id })) throw conflict('This employee already has a login account');
  return createUser(req, { name: employee.fullName, email: employee.workEmail, roles, employee: employee._id });
}

// Sensitive data (bank, PAN, Aadhaar last 4, UAN)

function toPublicSensitive(doc, reveal) {
  if (!doc) return { bank: {}, pan: null, aadhaarLast4: null, uan: '', updatedAt: null, revealed: reveal };
  const mask = (l4) => (l4 ? `XXXX${l4}` : null);
  return {
    bank: {
      accountHolderName: doc.bank?.accountHolderName ?? '',
      bankName: doc.bank?.bankName ?? '',
      branch: doc.bank?.branch ?? '',
      ifsc: doc.bank?.ifsc ?? '',
      accountNumber: reveal ? decryptField(doc.bank?.accountNumberEnc) : mask(doc.bank?.accountNumberLast4),
    },
    pan: reveal ? decryptField(doc.panEnc) : mask(doc.panLast4),
    aadhaarLast4: doc.aadhaarLast4,
    uan: doc.uan,
    updatedAt: doc.updatedAt,
    revealed: reveal,
  };
}

export async function getSensitive(req, id, reveal) {
  if (!(await Employee.exists({ _id: id }))) throw notFound('Employee not found');
  const doc = await EmployeeSensitive.findOne({ employee: id }).lean();
  if (reveal && doc) {
    await recordAudit(req, { action: 'employee.sensitive_viewed', entityType: 'Employee', entityId: id, summary: 'Viewed unmasked bank and identity details' });
  }
  return toPublicSensitive(doc, reveal);
}

export async function updateSensitive(req, id, input) {
  if (!(await Employee.exists({ _id: id, archivedAt: null }))) throw notFound('Employee not found');
  const doc = (await EmployeeSensitive.findOne({ employee: id })) ?? new EmployeeSensitive({ employee: id });
  const changed = [];
  if (input.bank) {
    const { accountNumber, ...bank } = input.bank;
    for (const [k, v] of Object.entries(bank)) {
      if (doc.bank[k] !== v) changed.push(`bank.${k}`);
      doc.bank[k] = v;
    }
    if (accountNumber !== undefined) {
      changed.push('bank.accountNumber');
      doc.bank.accountNumberEnc = encryptField(accountNumber);
      doc.bank.accountNumberLast4 = last4(accountNumber);
    }
  }
  if (input.pan !== undefined) {
    changed.push('pan');
    doc.panEnc = encryptField(input.pan);
    doc.panLast4 = last4(input.pan);
  }
  if (input.aadhaarLast4 !== undefined) {
    changed.push('aadhaarLast4');
    doc.aadhaarLast4 = input.aadhaarLast4 || null;
  }
  if (input.uan !== undefined) {
    changed.push('uan');
    doc.uan = input.uan;
  }
  doc.updatedBy = req.auth.user._id;
  await doc.save();
  // Field names only — never the values.
  await recordAudit(req, { action: 'employee.sensitive_updated', entityType: 'Employee', entityId: id, summary: 'Updated bank / identity details', changes: { fields: changed } });
  return toPublicSensitive(doc.toObject(), false);
}
