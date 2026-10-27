import { PayrollEntry, PayrollRun } from './payroll.models.js';
import { EmployeeSensitive } from '../employees/employeeSensitive.model.js';
import { recordAudit } from '../audit/audit.service.js';
import { conflict, notFound } from '../../shared/errors.js';
import { paiseToRupees } from '../../shared/money.js';
import { decryptField } from '../../shared/security/fieldEncryption.js';

/** Finalized runs only: reports show what was actually paid. */
async function finalizedRuns(month) {
  return PayrollRun.find({ month, status: 'finalized' }, { _id: 1, type: 1, totals: 1 }).lean();
}

export async function monthSummary({ month }) {
  const runs = await finalizedRuns(month);
  const runIds = runs.map((r) => r._id);
  const [components, departments, live] = await Promise.all([
    PayrollEntry.aggregate([
      { $match: { run: { $in: runIds } } },
      { $unwind: '$lines' },
      { $group: { _id: { code: '$lines.code', label: '$lines.label', type: '$lines.type' }, amountPaise: { $sum: '$lines.amountPaise' }, employees: { $sum: 1 } } },
      { $sort: { '_id.type': 1, amountPaise: -1 } },
    ]),
    PayrollEntry.aggregate([
      { $match: { run: { $in: runIds } } },
      {
        $group: {
          _id: '$employeeSnapshot.department',
          employees: { $addToSet: '$employee' },
          grossPaise: { $sum: '$totals.grossPaise' },
          deductionsPaise: { $sum: '$totals.deductionsPaise' },
          netPaise: { $sum: '$totals.netPaise' },
          employerCostPaise: { $sum: '$totals.employerCostPaise' },
        },
      },
      { $sort: { grossPaise: -1 } },
    ]),
    PayrollRun.findOne({ month, type: 'regular', status: { $ne: 'cancelled' } }, { status: 1 }).lean(),
  ]);
  const total = (k) => runs.reduce((s, r) => s + r.totals[k], 0);
  return {
    month,
    regularRunStatus: live?.status ?? null,
    finalizedRuns: runs.length,
    totals: {
      employees: (await PayrollEntry.distinct('employee', { run: { $in: runIds } })).length,
      gross: paiseToRupees(total('grossPaise')),
      deductions: paiseToRupees(total('deductionsPaise')),
      net: paiseToRupees(total('netPaise')),
      employerCost: paiseToRupees(total('employerCostPaise')),
    },
    components: components.map((c) => ({ code: c._id.code, label: c._id.label, type: c._id.type, amount: paiseToRupees(c.amountPaise), employees: c.employees })),
    departments: departments.map((d) => ({
      department: d._id ?? 'Unassigned',
      employees: d.employees.length,
      gross: paiseToRupees(d.grossPaise),
      deductions: paiseToRupees(d.deductionsPaise),
      net: paiseToRupees(d.netPaise),
      employerCost: paiseToRupees(d.employerCostPaise),
    })),
  };
}

export async function history({ from, to }) {
  const rows = await PayrollRun.aggregate([
    { $match: { status: 'finalized', month: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: '$month',
        runs: { $sum: 1 },
        employees: { $max: '$totals.employees' },
        grossPaise: { $sum: '$totals.grossPaise' },
        deductionsPaise: { $sum: '$totals.deductionsPaise' },
        netPaise: { $sum: '$totals.netPaise' },
        employerCostPaise: { $sum: '$totals.employerCostPaise' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((r) => ({ month: r._id, runs: r.runs, employees: r.employees, gross: paiseToRupees(r.grossPaise), deductions: paiseToRupees(r.deductionsPaise), net: paiseToRupees(r.netPaise), employerCost: paiseToRupees(r.employerCostPaise) }));
}

// CSV exports

/** Quotes a CSV cell and neutralizes spreadsheet formula injection (=, +, -, @ at the start). */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (rows) => `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** Payroll register: one row per employee, one column per pay line. */
export async function registerCsv(req, runId) {
  const run = await PayrollRun.findById(runId).lean();
  if (!run) throw notFound('Payroll run not found');
  const entries = await PayrollEntry.find({ run: run._id }).sort({ 'employeeSnapshot.employeeCode': 1 }).lean();
  const columns = [];
  for (const e of entries) for (const l of e.lines) if (!columns.some((c) => c.code === l.code)) columns.push({ code: l.code, label: l.label, type: l.type });
  const order = { earning: 0, deduction: 1, rounding: 2, employer: 3 };
  columns.sort((a, b) => order[a.type] - order[b.type]);
  const header = ['Employee code', 'Name', 'Department', 'Designation', 'Paid days', 'LOP days', ...columns.map((c) => `${c.label} (${c.type})`), 'Gross', 'Deductions', 'Net pay', 'Employer cost'];
  const rows = entries.map((e) => {
    const by = new Map(e.lines.map((l) => [l.code, l.amountPaise]));
    return [
      e.employeeSnapshot.employeeCode,
      e.employeeSnapshot.fullName,
      e.employeeSnapshot.department,
      e.employeeSnapshot.designation,
      e.inputs.paidUnits / 2,
      e.inputs.lopUnits / 2,
      ...columns.map((c) => (by.has(c.code) ? (by.get(c.code) / 100).toFixed(2) : '')),
      (e.totals.grossPaise / 100).toFixed(2),
      (e.totals.deductionsPaise / 100).toFixed(2),
      (e.totals.netPaise / 100).toFixed(2),
      (e.totals.employerCostPaise / 100).toFixed(2),
    ];
  });
  await recordAudit(req, { action: 'payroll.register_exported', entityType: 'PayrollRun', entityId: run._id, summary: `Exported payroll register for ${run.month}` });
  return { fileName: `payroll-register-${run.month}${run.type === 'supplementary' ? `-supp${run.sequence}` : ''}.csv`, body: csv([header, ...rows]) };
}

/** Bank transfer advice with full account numbers. Finalized runs only; every export is audited. */
export async function bankAdviceCsv(req, runId) {
  const run = await PayrollRun.findById(runId).lean();
  if (!run) throw notFound('Payroll run not found');
  if (run.status !== 'finalized') throw conflict('Bank advice is available once the payroll is finalized');
  const entries = await PayrollEntry.find({ run: run._id, 'totals.netPaise': { $gt: 0 } }).sort({ 'employeeSnapshot.employeeCode': 1 }).lean();
  const sensitive = await EmployeeSensitive.find({ employee: { $in: entries.map((e) => e.employee) } }).lean();
  const bank = new Map(sensitive.map((s) => [String(s.employee), s.bank]));
  const missing = [];
  const rows = entries.map((e) => {
    const b = bank.get(String(e.employee));
    if (!b?.accountNumberEnc) missing.push(e.employeeSnapshot.employeeCode);
    return [e.employeeSnapshot.employeeCode, b?.accountHolderName || e.employeeSnapshot.fullName, b?.bankName ?? '', b?.ifsc ?? '', b?.accountNumberEnc ? decryptField(b.accountNumberEnc) : 'MISSING', (e.totals.netPaise / 100).toFixed(2)];
  });
  await recordAudit(req, { action: 'payroll.bank_advice_exported', entityType: 'PayrollRun', entityId: run._id, summary: `Exported bank advice for ${run.month} (${rows.length} payments${missing.length ? `, ${missing.length} without bank details` : ''})` });
  return { fileName: `bank-advice-${run.month}.csv`, body: csv([['Employee code', 'Account holder', 'Bank', 'IFSC', 'Account number', 'Amount (INR)'], ...rows]), missing };
}
