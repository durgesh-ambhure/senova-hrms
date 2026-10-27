import { PayrollEntry, SalaryRevision, SalaryStructure } from './payroll.models.js';
import { salaryBreakdown } from './payroll.engine.js';
import { latestActiveRules, rulesForMonth } from './rules.service.js';
import { Employee } from '../employees/employee.model.js';
import { ownEmployeeId } from '../employees/team.js';
import { hasPermission } from '../roles/permissions.js';
import { getSettings } from '../company/company.service.js';
import { recordAudit } from '../audit/audit.service.js';
import { withTransaction } from '../../db/transaction.js';
import { conflict, forbidden, notFound, validationError } from '../../shared/errors.js';
import { escapeRegex } from '../../shared/pagination.js';
import { parseDateOnly, toDateOnly, todayIn } from '../../shared/dates.js';
import { paiseToRupees } from '../../shared/money.js';

const canSeeAll = (req) => ['payroll:salary:manage', 'payroll:read'].some((p) => hasPermission(req.auth.permissions, p));

export function revisionInput(r) {
  return {
    annualCtcPaise: r.annualCtcPaise,
    basicBpOfGross: r.basicBpOfGross,
    hraBpOfBasic: r.hraBpOfBasic,
    fixedAllowances: r.fixedAllowances ?? [],
    pfApplicable: r.pfApplicable,
    pfOnFullWage: r.pfOnFullWage,
  };
}

export function toPublicBreakdown(b) {
  return {
    ctcMonthly: paiseToRupees(b.ctcMonthlyPaise),
    gross: paiseToRupees(b.grossPaise),
    components: b.components.map((c) => ({ code: c.code, label: c.label, monthly: paiseToRupees(c.monthlyPaise), pfWage: c.pfWage })),
    employer: { pf: paiseToRupees(b.employer.pfPaise), esi: paiseToRupees(b.employer.esiPaise), gratuity: paiseToRupees(b.employer.gratuityPaise) },
    esiApplicable: b.esiApplicable,
    unallocated: paiseToRupees(b.unallocatedPaise),
    valid: b.valid,
    problem: b.problem,
  };
}

function toPublicRevision(r) {
  return {
    id: String(r._id),
    revisionNo: r.revisionNo,
    effectiveFrom: toDateOnly(r.effectiveFrom),
    annualCtc: paiseToRupees(r.annualCtcPaise),
    basicPercentOfGross: r.basicBpOfGross === null ? null : r.basicBpOfGross / 100,
    hraPercentOfBasic: r.hraBpOfBasic === null ? null : r.hraBpOfBasic / 100,
    fixedAllowances: r.fixedAllowances.map((a) => ({ code: a.code, label: a.label, monthly: paiseToRupees(a.monthlyPaise), pfWage: a.pfWage })),
    pfApplicable: r.pfApplicable,
    pfOnFullWage: r.pfOnFullWage,
    breakdown: toPublicBreakdown(r.breakdown),
    ruleVersion: r.ruleVersion,
    reason: r.reason,
    arrearsSettled: Boolean(r.arrearsSettledRun),
    createdByName: r.createdByName,
    createdAt: r.createdAt,
  };
}

const fromBody = (b) => ({
  annualCtcPaise: b.annualCtc,
  basicBpOfGross: b.basicPercentOfGross ?? null,
  hraBpOfBasic: b.hraPercentOfBasic ?? null,
  fixedAllowances: (b.fixedAllowances ?? []).map((a) => ({ code: a.code, label: a.label, monthlyPaise: a.monthly, pfWage: a.pfWage })),
  pfApplicable: b.pfApplicable ?? true,
  pfOnFullWage: b.pfOnFullWage ?? false,
});

async function rulesFor(effectiveFrom) {
  const rules = (effectiveFrom && (await rulesForMonth(effectiveFrom.slice(0, 7)))) || (await latestActiveRules());
  if (!rules) throw conflict('Activate payroll rules (Payroll → Settings) before defining salaries');
  return rules;
}

export async function previewBreakdown(body) {
  const rules = await rulesFor(body.effectiveFrom);
  return { ruleVersion: rules.version, breakdown: toPublicBreakdown(salaryBreakdown({ ...fromBody(body), rules })) };
}

/** Recomputes the summary row: the revision in effect today, else the earliest future one. */
async function refreshStructure(employeeId, session) {
  const today = parseDateOnly(todayIn((await getSettings()).timezone));
  const revisions = await SalaryRevision.find({ employee: employeeId }).sort({ effectiveFrom: 1, revisionNo: 1 }).session(session).lean();
  if (!revisions.length) {
    await SalaryStructure.deleteOne({ employee: employeeId }, { session });
    return;
  }
  const current = [...revisions].reverse().find((r) => r.effectiveFrom <= today) ?? revisions[0];
  await SalaryStructure.updateOne(
    { employee: employeeId },
    { $set: { currentRevision: current._id, annualCtcPaise: current.annualCtcPaise, effectiveFrom: current.effectiveFrom, revisionCount: revisions.length } },
    { upsert: true, session },
  );
}

function assertAccess(req, employeeId) {
  if (canSeeAll(req)) return;
  if (ownEmployeeId(req) === String(employeeId) && hasPermission(req.auth.permissions, 'self:payslips')) return;
  throw notFound('Employee not found');
}

export async function getEmployeeSalary(req, employeeId) {
  assertAccess(req, employeeId);
  const employee = await Employee.findById(employeeId, { fullName: 1, employeeCode: 1, joiningDate: 1 }).lean();
  if (!employee) throw notFound('Employee not found');
  const [revisions, structure] = await Promise.all([
    SalaryRevision.find({ employee: employeeId }).sort({ effectiveFrom: -1, revisionNo: -1 }).lean(),
    SalaryStructure.findOne({ employee: employeeId }).lean(),
  ]);
  return {
    employee: { id: String(employee._id), fullName: employee.fullName, employeeCode: employee.employeeCode, joiningDate: toDateOnly(employee.joiningDate) },
    currentRevision: structure ? String(structure.currentRevision) : null,
    revisions: revisions.map(toPublicRevision),
  };
}

/** Separation of duties: nobody changes their own pay, even with payroll:salary:manage. */
function assertNotOwnSalary(req, employeeId) {
  if (ownEmployeeId(req) === String(employeeId)) throw forbidden('You cannot change your own salary; ask another payroll administrator');
}

export async function createRevision(req, employeeId, body) {
  assertNotOwnSalary(req, employeeId);
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw notFound('Employee not found');
  if (body.effectiveFrom < toDateOnly(employee.joiningDate)) throw validationError([{ path: 'effectiveFrom', message: 'Salary cannot start before the joining date' }]);
  const rules = await rulesFor(body.effectiveFrom);
  const input = fromBody(body);
  const breakdown = salaryBreakdown({ ...input, rules });
  if (!breakdown.valid) throw validationError([{ path: 'fixedAllowances', message: breakdown.problem }]);

  const revision = await withTransaction(async (session) => {
    if (await SalaryRevision.exists({ employee: employeeId, effectiveFrom: parseDateOnly(body.effectiveFrom) }).session(session)) {
      throw conflict('A revision already starts on that date; delete it or pick another date');
    }
    const last = await SalaryRevision.findOne({ employee: employeeId }).sort({ revisionNo: -1 }).session(session).lean();
    const [r] = await SalaryRevision.create(
      [{ ...input, employee: employeeId, revisionNo: (last?.revisionNo ?? 0) + 1, effectiveFrom: parseDateOnly(body.effectiveFrom), breakdown, ruleVersion: rules.version, reason: body.reason, createdBy: req.auth.user._id, createdByName: req.auth.user.name }],
      { session },
    );
    await refreshStructure(employeeId, session);
    await recordAudit(req, { action: 'salary.revised', entityType: 'Employee', entityId: employeeId, summary: `Salary revision #${r.revisionNo} from ${body.effectiveFrom}${body.reason ? `: ${body.reason}` : ''}` }, session);
    return r;
  });
  return toPublicRevision(revision.toObject());
}

/** Only revisions that no payroll has used can be deleted (they are part of the pay record otherwise). */
export async function deleteRevision(req, employeeId, revisionId) {
  assertNotOwnSalary(req, employeeId);
  await withTransaction(async (session) => {
    const r = await SalaryRevision.findOne({ _id: revisionId, employee: employeeId }).session(session);
    if (!r) throw notFound('Revision not found');
    const used = await PayrollEntry.exists({ employee: employeeId, 'inputs.revisionIds': String(r._id) }).session(session);
    if (used || r.arrearsSettledRun) throw conflict('This revision has been used in payroll; add a new revision instead');
    await r.deleteOne({ session });
    await refreshStructure(employeeId, session);
    await recordAudit(req, { action: 'salary.revision_deleted', entityType: 'Employee', entityId: employeeId, summary: `Deleted unused salary revision #${r.revisionNo}` }, session);
  });
}

export async function listSalaries(req, { search, department, missing, page, limit }) {
  const filter = { archivedAt: null, lifecycleStatus: { $in: ['pre_joining', 'active', 'notice_period'] } };
  if (department) filter.department = department;
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ fullName: rx }, { employeeCode: rx }];
  }
  if (missing === 'true') filter._id = { $nin: await SalaryStructure.distinct('employee') };
  const [employees, total] = await Promise.all([
    Employee.find(filter, { fullName: 1, employeeCode: 1, department: 1, designation: 1, lifecycleStatus: 1 }).sort({ fullName: 1 }).skip((page - 1) * limit).limit(limit).populate('department', 'name').populate('designation', 'title').lean(),
    Employee.countDocuments(filter),
  ]);
  const structures = await SalaryStructure.find({ employee: { $in: employees.map((e) => e._id) } }).lean();
  const byEmp = new Map(structures.map((s) => [String(s.employee), s]));
  return {
    items: employees.map((e) => {
      const s = byEmp.get(String(e._id));
      return {
        employee: { id: String(e._id), fullName: e.fullName, employeeCode: e.employeeCode, department: e.department?.name ?? null, designation: e.designation?.title ?? null, lifecycleStatus: e.lifecycleStatus },
        annualCtc: s ? paiseToRupees(s.annualCtcPaise) : null,
        effectiveFrom: s ? toDateOnly(s.effectiveFrom) : null,
        revisionCount: s?.revisionCount ?? 0,
      };
    }),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

