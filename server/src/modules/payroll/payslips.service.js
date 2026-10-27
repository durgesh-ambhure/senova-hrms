import PDFDocument from 'pdfkit';
import { Payslip } from './payroll.models.js';
import { getSettings } from '../company/company.service.js';
import { ownEmployeeId } from '../employees/team.js';
import { hasPermission } from '../roles/permissions.js';
import { recordAudit } from '../audit/audit.service.js';
import { notFound } from '../../shared/errors.js';
import { paiseToRupees } from '../../shared/money.js';

/** First month of the financial year containing `month` (company setting; April in India). */
export function financialYearStart(month, startMonth) {
  const [y, m] = month.split('-').map(Number);
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${String(startMonth).padStart(2, '0')}`;
}

const ytdKeys = ['grossPaise', 'deductionsPaise', 'tdsPaise', 'netPaise'];

/**
 * Creates immutable payslip snapshots for a finalized run (P13: earnings, deductions, net and
 * year-to-date totals; employer contributions are not shown). Runs inside the finalize transaction.
 */
export async function createPayslips(run, entries, session) {
  const settings = await getSettings();
  const fyStart = financialYearStart(run.month, settings.financialYearStartMonth);
  const prior = await Payslip.aggregate([
    { $match: { employee: { $in: entries.map((e) => e.employee) }, month: { $gte: fyStart, $lte: run.month } } },
    { $group: { _id: '$employee', ...Object.fromEntries(ytdKeys.map((k) => [k, { $sum: `$snapshot.totals.${k}` }])) } },
  ]).session(session);
  const priorBy = new Map(prior.map((p) => [String(p._id), p]));
  const docs = entries.map((e) => {
    const tds = e.lines.filter((l) => l.code === 'TDS').reduce((s, l) => s + l.amountPaise, 0);
    const totals = { grossPaise: e.totals.grossPaise, deductionsPaise: e.totals.deductionsPaise, tdsPaise: tds, roundingPaise: e.totals.roundingPaise, netPaise: e.totals.netPaise };
    const before = priorBy.get(String(e.employee)) ?? {};
    return {
      run: run._id,
      entry: e._id,
      employee: e.employee,
      month: run.month,
      runType: run.type,
      snapshot: {
        company: { legalName: settings.legalName, displayName: settings.displayName, address: settings.address },
        employee: e.employeeSnapshot,
        month: run.month,
        runType: run.type,
        payDate: run.payDate,
        daysInMonth: e.inputs.daysInMonth,
        paidDays: e.inputs.paidUnits / 2,
        lopDays: e.inputs.lopUnits / 2,
        lines: e.lines.filter((l) => ['earning', 'deduction', 'rounding'].includes(l.type)),
        totals,
        ytd: { from: fyStart, ...Object.fromEntries(ytdKeys.map((k) => [k, (before[k] ?? 0) + totals[k]])) },
        ruleVersion: e.ruleVersion,
      },
    };
  });
  if (docs.length) await Payslip.insertMany(docs, { session });
}

const toPublicPayslip = (p) => ({
  id: String(p._id),
  month: p.month,
  runType: p.runType,
  employee: { id: String(p.employee), fullName: p.snapshot.employee.fullName, employeeCode: p.snapshot.employee.employeeCode, department: p.snapshot.employee.department },
  paidDays: p.snapshot.paidDays,
  lopDays: p.snapshot.lopDays,
  daysInMonth: p.snapshot.daysInMonth,
  lines: p.snapshot.lines.map((l) => ({ code: l.code, label: l.label, type: l.type, amount: paiseToRupees(l.amountPaise), basis: l.basis })),
  totals: Object.fromEntries(Object.entries(p.snapshot.totals).map(([k, v]) => [k.replace('Paise', ''), paiseToRupees(v)])),
  ytd: { from: p.snapshot.ytd.from, ...Object.fromEntries(ytdKeys.map((k) => [k.replace('Paise', ''), paiseToRupees(p.snapshot.ytd[k])])) },
  generatedAt: p.generatedAt,
});

const canSeeAll = (req) => hasPermission(req.auth.permissions, 'payslips:read:all');

/** Employees see their own payslips only; payslips:read:all sees everyone's. Others get 404. */
async function findAccessible(req, id) {
  const p = await Payslip.findById(id).lean();
  const own = p && ownEmployeeId(req) === String(p.employee) && hasPermission(req.auth.permissions, 'self:payslips');
  if (!p || (!own && !canSeeAll(req))) throw notFound('Payslip not found');
  return p;
}

export async function listPayslips(req, { employee, month, year }) {
  const filter = {};
  if (canSeeAll(req)) {
    if (employee) filter.employee = employee;
  } else {
    const me = ownEmployeeId(req);
    if (!me || !hasPermission(req.auth.permissions, 'self:payslips')) return [];
    if (employee && employee !== me) throw notFound('Employee not found');
    filter.employee = me;
  }
  if (month) filter.month = month;
  if (year) filter.month = { $gte: `${year}-01`, $lte: `${year}-12` };
  const items = await Payslip.find(filter).sort({ month: -1, runType: 1 }).limit(500).lean();
  return items.map(toPublicPayslip);
}

export async function getPayslip(req, id) {
  return toPublicPayslip(await findAccessible(req, id));
}

const inr = (paise) => `INR ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Renders a payslip PDF from its stored snapshot, so a re-download is always identical in content. */
export async function renderPayslipPdf(req, id) {
  const p = await findAccessible(req, id);
  await recordAudit(req, { action: 'payslip.downloaded', entityType: 'Employee', entityId: p.employee, summary: `Downloaded payslip for ${p.month}` });
  const s = p.snapshot;
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Payslip ${s.month} ${s.employee.employeeCode}`, Author: s.company.displayName } });

  const navy = '#14306b';
  doc.fillColor(navy).fontSize(18).font('Helvetica-Bold').text(s.company.legalName || s.company.displayName);
  const addr = [s.company.address?.line1, s.company.address?.city, s.company.address?.state, s.company.address?.postalCode].filter(Boolean).join(', ');
  if (addr) doc.fillColor('#475569').fontSize(9).font('Helvetica').text(addr);
  doc.moveDown(0.8).fillColor(navy).fontSize(13).font('Helvetica-Bold').text(`Payslip for ${monthName(s.month)}${s.runType === 'supplementary' ? ' (supplementary)' : ''}`);
  doc.moveDown(0.5);

  const info = [
    ['Employee', `${s.employee.fullName} (${s.employee.employeeCode})`],
    ['Designation', s.employee.designation ?? '—'],
    ['Department', s.employee.department ?? '—'],
    ['Date of joining', s.employee.joiningDate ?? '—'],
    ['Paid days', `${s.paidDays} of ${s.daysInMonth}`],
    ['Loss of pay days', String(s.lopDays)],
  ];
  doc.fontSize(9).fillColor('#0f172a');
  const startY = doc.y;
  info.forEach(([k, v], i) => {
    const x = i % 2 === 0 ? 48 : 300;
    const y = startY + Math.floor(i / 2) * 16;
    doc.font('Helvetica').fillColor('#64748b').text(k, x, y, { width: 100 });
    doc.font('Helvetica-Bold').fillColor('#0f172a').text(v, x + 100, y, { width: 150 });
  });
  doc.y = startY + Math.ceil(info.length / 2) * 16 + 14;

  const earnings = s.lines.filter((l) => l.type === 'earning');
  const deductions = s.lines.filter((l) => l.type === 'deduction');
  const tableTop = doc.y;
  const col = (title, rows, x, total) => {
    doc.rect(x, tableTop, 240, 20).fill(navy);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text(title, x + 8, tableTop + 6, { width: 150 });
    doc.text('Amount', x + 150, tableTop + 6, { width: 82, align: 'right' });
    let y = tableTop + 26;
    for (const r of rows) {
      doc.fillColor('#0f172a').font('Helvetica').text(r.label, x + 8, y, { width: 140 });
      doc.text(inr(r.amountPaise), x + 150, y, { width: 82, align: 'right' });
      y += 16;
    }
    return { y, total, x };
  };
  const left = col('Earnings', earnings, 48);
  const right = col('Deductions', deductions, 307);
  const bottom = Math.max(left.y, right.y) + 4;
  doc.moveTo(48, bottom).lineTo(547, bottom).strokeColor('#cbd5e1').stroke();
  doc.font('Helvetica-Bold').fillColor('#0f172a');
  doc.text('Gross earnings', 56, bottom + 6, { width: 140 }).text(inr(s.totals.grossPaise), 198, bottom + 6, { width: 82, align: 'right' });
  doc.text('Total deductions', 315, bottom + 6, { width: 140 }).text(inr(s.totals.deductionsPaise), 457, bottom + 6, { width: 82, align: 'right' });

  let y = bottom + 34;
  if (s.totals.roundingPaise) {
    doc.font('Helvetica').fillColor('#64748b').fontSize(8).text(`Includes rounding of ${inr(s.totals.roundingPaise)} to the nearest rupee`, 48, y);
    y += 14;
  }
  doc.rect(48, y, 499, 30).fill('#eef3fb');
  doc.fillColor(navy).font('Helvetica-Bold').fontSize(12).text('Net pay', 60, y + 9).text(inr(s.totals.netPaise), 300, y + 9, { width: 235, align: 'right' });
  y += 48;

  doc.fillColor(navy).font('Helvetica-Bold').fontSize(10).text(`Year to date (from ${monthName(s.ytd.from)})`, 48, y);
  y += 16;
  [['Gross', s.ytd.grossPaise], ['Deductions', s.ytd.deductionsPaise], ['Income tax (TDS)', s.ytd.tdsPaise], ['Net pay', s.ytd.netPaise]].forEach(([k, v], i) => {
    doc.font('Helvetica').fillColor('#475569').fontSize(9).text(k, 48 + i * 125, y, { width: 120 });
    doc.font('Helvetica-Bold').fillColor('#0f172a').text(inr(v), 48 + i * 125, y + 12, { width: 120 });
  });
  doc.font('Helvetica').fillColor('#94a3b8').fontSize(8).text('This is a system-generated payslip and does not require a signature.', 48, 770, { width: 499, align: 'center' });
  doc.end();
  return { doc, fileName: `payslip-${s.month}-${s.employee.employeeCode}.pdf` };
}
