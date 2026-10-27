import { beforeAll, describe, expect, it } from 'vitest';
import { createEmployeeRecord, signedInAs, signedInAsEmployee } from '../../../test/helpers.js';
import { PayrollRuleSet, Payslip } from './payroll.models.js';
import { AttendanceRecord } from '../attendance/attendanceRecord.model.js';
import { LeaveRequest } from '../leave/leave.models.js';
import { EmployeeSensitive } from '../employees/employeeSensitive.model.js';
import { parseDateOnly } from '../../shared/dates.js';
import { encryptField } from '../../shared/security/fieldEncryption.js';

// TEST VALUES ONLY — not a statement of current statutory rates.
const ruleBody = {
  effectiveFrom: '2024-01',
  template: { basicPercentOfGross: '50', hraPercentOfBasic: '40' },
  pf: { enabled: true, employeePercent: '12', employerPercent: '12', epsPercent: '8.33', wageCeiling: '15000', epsCeiling: '15000' },
  esi: { enabled: true, employeePercent: '0.75', employerPercent: '3.25', wageLimit: '21000' },
  pt: { enabled: true, state: 'MH', slabs: [{ from: '0', to: '7500', monthly: '0' }, { from: '7500.01', to: '10000', monthly: '175' }, { from: '10000.01', to: null, monthly: '200', february: '300' }] },
  lop: { includeAbsence: false },
};

let payroll; // Payroll Admin: prepares
let hr; // HR Admin: approves
let root; // Super Admin: finalizes
let ruleSetId;

beforeAll(async () => {
  payroll = (await signedInAs(['payroll_admin'])).client;
  hr = (await signedInAs(['hr_admin'])).client;
  root = (await signedInAs(['super_admin'])).client;
  const draft = await payroll.post('/api/v1/payroll/rules').send(ruleBody);
  expect(draft.status).toBe(201);
  ruleSetId = draft.body.data.id;
  expect((await payroll.post(`/api/v1/payroll/rules/${ruleSetId}/activate`)).status).toBe(200);
});

async function employeeWithSalary(annualCtc = '1800000', overrides = {}, effectiveFrom = '2024-01-15') {
  const emp = await createEmployeeRecord({ joiningDate: parseDateOnly('2024-01-15'), ...overrides });
  const res = await payroll.post(`/api/v1/payroll/salaries/${emp._id}/revisions`).send({ effectiveFrom, annualCtc, reason: 'Joining salary' });
  expect(res.status).toBe(201);
  return emp;
}

async function runFor(month, client = payroll) {
  const run = await client.post('/api/v1/payroll/runs').send({ month });
  expect(run.status).toBe(201);
  const calc = await client.post(`/api/v1/payroll/runs/${run.body.data.id}/calculate`);
  expect(calc.status).toBe(200);
  return calc.body.data;
}
const entryOf = async (runId, emp) => (await payroll.get(`/api/v1/payroll/runs/${runId}/entries`)).body.data.find((e) => e.employee.id === String(emp._id));
const line = (entry, code) => entry.lines.find((l) => l.code === code)?.amount;

async function finalize(runId) {
  expect((await payroll.post(`/api/v1/payroll/runs/${runId}/submit`).send({})).status).toBe(200);
  expect((await hr.post(`/api/v1/payroll/runs/${runId}/approve`).send({})).status).toBe(200);
  const res = await root.post(`/api/v1/payroll/runs/${runId}/finalize`).send({});
  expect(res.status).toBe(200);
  return res.body.data;
}

describe('rule settings', () => {
  it('locks active versions, validates consistency and restricts editing', async () => {
    expect((await payroll.patch(`/api/v1/payroll/rules/${ruleSetId}`).send({ notes: 'x' })).status).toBe(409);
    const bad = await payroll.post('/api/v1/payroll/rules').send({ effectiveFrom: '2030-01', pf: { enabled: true, employeePercent: '0' } });
    expect(bad.status).toBe(422);
    expect((await hr.post('/api/v1/payroll/rules').send({ effectiveFrom: '2030-01' })).status).toBe(403);
    expect((await payroll.post(`/api/v1/payroll/rules/${ruleSetId}/verify`).send({ reference: 'CA confirmed' })).status).toBe(403);
    const rules = (await payroll.get('/api/v1/payroll/rules')).body.data[0];
    expect(rules).toMatchObject({ status: 'active', pf: { employeePercent: 12, wageCeiling: 15000 }, esi: { employeePercent: 0.75 }, verification: null });
  });
});

describe('salary structures', () => {
  it('derives the breakdown from CTC, rejects dates before joining, and keeps history', async () => {
    const emp = await employeeWithSalary('1800000');
    const s = (await payroll.get(`/api/v1/payroll/salaries/${emp._id}`)).body.data;
    expect(s.revisions[0].breakdown).toMatchObject({ ctcMonthly: 150000, gross: 148200, employer: { pf: 1800, esi: 0 } });
    expect(s.revisions[0].breakdown.components.map((c) => c.monthly)).toEqual([74100, 29640, 44460]);
    expect((await payroll.post(`/api/v1/payroll/salaries/${emp._id}/revisions`).send({ effectiveFrom: '2023-12-01', annualCtc: '1000000' })).status).toBe(422);
    expect((await payroll.post(`/api/v1/payroll/salaries/${emp._id}/revisions`).send({ effectiveFrom: '2024-01-15', annualCtc: '1000000' })).status).toBe(409);
  });

  it('shows employees their own salary only; managers see none', async () => {
    const { client: me, employee } = await signedInAsEmployee(['employee'], { joiningDate: parseDateOnly('2024-01-15') });
    await payroll.post(`/api/v1/payroll/salaries/${employee._id}/revisions`).send({ effectiveFrom: '2024-01-15', annualCtc: '600000' });
    expect((await me.get('/api/v1/payroll/salaries/me')).body.data.revisions).toHaveLength(1);
    const other = await employeeWithSalary();
    expect((await me.get(`/api/v1/payroll/salaries/${other._id}`)).status).toBe(404);
    const { client: mgr } = await signedInAs(['manager']);
    expect((await mgr.get('/api/v1/payroll/salaries')).status).toBe(403);
    expect((await mgr.get(`/api/v1/payroll/salaries/${other._id}`)).status).toBe(404);
  });

  it('does not let payroll staff change their own salary', async () => {
    const { client: self, employee } = await signedInAsEmployee(['payroll_admin'], { joiningDate: parseDateOnly('2024-01-15') });
    const res = await self.post(`/api/v1/payroll/salaries/${employee._id}/revisions`).send({ effectiveFrom: '2024-01-15', annualCtc: '9000000' });
    expect(res.status).toBe(403);
    expect((await payroll.post(`/api/v1/payroll/salaries/${employee._id}/revisions`).send({ effectiveFrom: '2024-01-15', annualCtc: '900000' })).status).toBe(201);
  });
});

describe('payroll run lifecycle', () => {
  it('calculates, enforces three-person approval and verified rules, then locks and issues payslips', async () => {
    const { client: me, employee: emp } = await signedInAsEmployee(['employee'], { joiningDate: parseDateOnly('2024-01-15') });
    await payroll.post(`/api/v1/payroll/salaries/${emp._id}/revisions`).send({ effectiveFrom: '2024-01-15', annualCtc: '1800000' });
    await AttendanceRecord.create({ employee: emp._id, date: parseDateOnly('2025-03-05'), shift: { name: 'S', startTime: '09:30', endTime: '18:30', lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15, fullDayMinutes: 480, halfDayMinutes: 240, weeklyOffs: [0, 6] }, status: 'present', checkIn: new Date('2025-03-05T04:00:00Z'), checkOut: new Date('2025-03-05T13:00:00Z') });

    const run = await runFor('2025-03');
    expect(run).toMatchObject({ status: 'calculated', ruleVersion: 1, rulesVerified: false });
    const entry = await entryOf(run.id, emp);
    expect(entry.totals).toMatchObject({ gross: 148200 });
    expect(line(entry, 'PF_EE')).toBe(1800);
    expect(line(entry, 'PT')).toBe(200);
    expect(entry.totals.net).toBe(148200 - 1800 - 200);
    expect((await payroll.post('/api/v1/payroll/runs').send({ month: '2025-03' })).status).toBe(409);

    // Inputs invalidate the calculation.
    expect((await payroll.post(`/api/v1/payroll/runs/${run.id}/adjustments`).send({ employeeId: String(emp._id), kind: 'tds', amount: '12345.67' })).status).toBe(201);
    expect((await payroll.post(`/api/v1/payroll/runs/${run.id}/submit`).send({})).status).toBe(409); // back to draft
    await payroll.post(`/api/v1/payroll/runs/${run.id}/calculate`);
    const withTds = await entryOf(run.id, emp);
    expect(line(withTds, 'TDS')).toBe(12345.67);
    expect(withTds.totals.net % 1).toBe(0);

    expect((await payroll.post(`/api/v1/payroll/runs/${run.id}/submit`).send({})).status).toBe(200);
    expect((await payroll.post(`/api/v1/payroll/runs/${run.id}/approve`).send({})).status).toBe(403); // lacks permission
    expect((await hr.post(`/api/v1/payroll/runs/${run.id}/approve`).send({})).status).toBe(200);
    expect((await hr.post(`/api/v1/payroll/runs/${run.id}/finalize`).send({})).status).toBe(403);
    expect((await root.post(`/api/v1/payroll/runs/${run.id}/finalize`).send({})).status).toBe(409); // rules not verified
    expect((await root.post(`/api/v1/payroll/rules/${ruleSetId}/verify`).send({ reference: 'Test fixture values' })).status).toBe(200);
    const done = await root.post(`/api/v1/payroll/runs/${run.id}/finalize`).send({});
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('finalized');

    expect((await payroll.post(`/api/v1/payroll/runs/${run.id}/calculate`)).status).toBe(409);
    expect((await AttendanceRecord.findOne({ employee: emp._id, date: parseDateOnly('2025-03-05') })).lockedAt).toBeTruthy();

    const slips = (await me.get('/api/v1/payroll/payslips')).body.data;
    expect(slips).toHaveLength(1);
    expect(slips[0]).toMatchObject({ month: '2025-03', totals: { net: withTds.totals.net }, ytd: { from: '2024-04', tds: 12345.67 } }); // financial year starts in April
    expect(slips[0].lines.some((l) => l.type === 'employer')).toBe(false);
    const pdf = await me.get(`/api/v1/payroll/payslips/${slips[0].id}/pdf`).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');

    const { client: stranger } = await signedInAsEmployee(['employee']);
    expect((await stranger.get(`/api/v1/payroll/payslips/${slips[0].id}`)).status).toBe(404);
    expect((await stranger.get(`/api/v1/payroll/payslips/${slips[0].id}/pdf`)).status).toBe(404);
  });

  it('a preparer who can also approve still cannot approve their own run', async () => {
    await employeeWithSalary();
    const run = await runFor('2025-05', root);
    await root.post(`/api/v1/payroll/runs/${run.id}/submit`).send({});
    expect((await root.post(`/api/v1/payroll/runs/${run.id}/approve`).send({})).status).toBe(403);
    expect((await hr.post(`/api/v1/payroll/runs/${run.id}/return`).send({})).status).toBe(422);
    expect((await hr.post(`/api/v1/payroll/runs/${run.id}/return`).send({ note: 'Check TDS' })).body.data.status).toBe('calculated');
  });

  it('freezes leave in a finalized month', async () => {
    const run = (await payroll.get('/api/v1/payroll/runs?month=2025-03')).body.data[0];
    expect(run.status).toBe('finalized');
    const { client: me, employee } = await signedInAsEmployee(['employee'], { joiningDate: parseDateOnly('2024-01-15') });
    const leave = await LeaveRequest.create({ employee: employee._id, leaveType: employee._id, leaveTypeSnapshot: { name: 'Casual', code: 'CL', paid: true }, year: 2025, startDate: parseDateOnly('2025-03-10'), endDate: parseDateOnly('2025-03-10'), units: 2, slots: [{ date: parseDateOnly('2025-03-10'), half: 'full', units: 2 }], status: 'approved', appliedBy: employee._id });
    const res = await me.post(`/api/v1/leave/requests/${leave._id}/cancel`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/finalized/);
  });
});

describe('calculation rules', () => {
  it('pro-rates a mid-month joiner by calendar days (P11)', async () => {
    const emp = await employeeWithSalary('1800000', { joiningDate: parseDateOnly('2025-06-16') }, '2025-06-16');
    const run = await runFor('2025-06');
    const entry = await entryOf(run.id, emp);
    expect(entry.inputs).toMatchObject({ daysInMonth: 30, paidDays: 15, window: { from: '2025-06-16', to: '2025-06-30' } });
    expect(line(entry, 'BASIC')).toBe(37050);
  });

  it('deducts unpaid leave at monthly ÷ calendar days and links the source request (P2)', async () => {
    const emp = await employeeWithSalary('1200000');
    const lop = await LeaveRequest.create({ employee: emp._id, leaveType: emp._id, leaveTypeSnapshot: { name: 'Loss of pay', code: 'LOP', paid: false }, year: 2025, startDate: parseDateOnly('2025-07-14'), endDate: parseDateOnly('2025-07-15'), units: 4, slots: [{ date: parseDateOnly('2025-07-14'), half: 'full', units: 2 }, { date: parseDateOnly('2025-07-15'), half: 'full', units: 2 }], status: 'approved', appliedBy: emp._id });
    const run = await runFor('2025-07');
    const entry = await entryOf(run.id, emp);
    expect(entry.inputs.lopDays).toBe(2);
    expect(entry.inputs.lopDetail[0]).toMatchObject({ date: '2025-07-14', units: 2, leaveRequests: [String(lop._id)] });
    const structure = (await payroll.get(`/api/v1/payroll/salaries/${emp._id}`)).body.data.revisions[0].breakdown;
    const basic = structure.components.find((c) => c.code === 'BASIC').monthly;
    expect(line(entry, 'BASIC')).toBeCloseTo(Math.round(((basic * 100 * 29) / 31)) / 100, 2);
  });

  it('pays arrears for a back-dated revision once, in the next run (P12)', async () => {
    const emp = await employeeWithSalary('1200000');
    const aug = await runFor('2025-08');
    const augEntry = await entryOf(aug.id, emp);
    await finalize(aug.id);
    // Raise back-dated to 1 August, entered after August was paid.
    await payroll.post(`/api/v1/payroll/salaries/${emp._id}/revisions`).send({ effectiveFrom: '2025-08-01', annualCtc: '1500000', reason: 'Appraisal (back-dated)' });
    const sep = await runFor('2025-09');
    const sepEntry = await entryOf(sep.id, emp);
    const newBasic = (await payroll.get(`/api/v1/payroll/salaries/${emp._id}`)).body.data.revisions[0].breakdown.components.find((c) => c.code === 'BASIC').monthly;
    expect(line(sepEntry, 'ARR_BASIC')).toBeCloseTo(newBasic - line(augEntry, 'BASIC'), 2);
    expect(sepEntry.inputs.arrears.every((a) => a.month === '2025-08')).toBe(true);
    expect(sepEntry.warnings.join(' ')).toMatch(/arrears/i);
    await finalize(sep.id);
    const oct = await runFor('2025-10');
    expect(line(await entryOf(oct.id, emp), 'ARR_BASIC')).toBeUndefined();
  });

  it('skips employees without a salary and reports them', async () => {
    const emp = await createEmployeeRecord({ joiningDate: parseDateOnly('2024-01-15') });
    const run = await runFor('2025-11');
    expect(run.skipped.some((s) => s.employee === String(emp._id) && s.reason === 'No salary structure')).toBe(true);
  });
});

describe('corrections and exports', () => {
  it('handles post-finalization corrections through a supplementary run', async () => {
    const emp = await employeeWithSalary();
    expect((await payroll.post('/api/v1/payroll/runs').send({ month: '2025-12', type: 'supplementary', reason: 'Missed bonus' })).status).toBe(409);
    const dec = await runFor('2025-12');
    await finalize(dec.id);
    const supp = (await payroll.post('/api/v1/payroll/runs').send({ month: '2025-12', type: 'supplementary', reason: 'Missed festival bonus' })).body.data;
    await payroll.post(`/api/v1/payroll/runs/${supp.id}/adjustments`).send({ employeeId: String(emp._id), kind: 'earning', label: 'Festival bonus', amount: '10000', reason: 'Approved by HR' });
    await payroll.post(`/api/v1/payroll/runs/${supp.id}/calculate`);
    const entries = (await payroll.get(`/api/v1/payroll/runs/${supp.id}/entries`)).body.data;
    expect(entries).toHaveLength(1);
    expect(entries[0].lines.map((l) => l.code)).toEqual(['ADJ_E1']);
    await finalize(supp.id);
    const slips = await Payslip.find({ employee: emp._id, month: '2025-12' }).lean();
    expect(slips.map((s) => s.runType).sort()).toEqual(['regular', 'supplementary']);
  });

  it('exports a register, and bank advice only with sensitive access after finalization', async () => {
    const emp = await employeeWithSalary();
    await EmployeeSensitive.create({ employee: emp._id, bank: { accountHolderName: 'Test', bankName: 'HDFC', ifsc: 'HDFC0001234', accountNumberEnc: encryptField('50100012345678'), accountNumberLast4: '5678' } });
    const run = await runFor('2026-01');
    const register = await payroll.get(`/api/v1/payroll/runs/${run.id}/register.csv`);
    expect(register.status).toBe(200);
    expect(register.text).toMatch(/Employee code,Name/);
    expect((await payroll.get(`/api/v1/payroll/runs/${run.id}/bank-advice.csv`)).status).toBe(409);
    await finalize(run.id);
    const advice = await payroll.get(`/api/v1/payroll/runs/${run.id}/bank-advice.csv`);
    expect(advice.text).toContain('50100012345678');
    expect((await hr.get(`/api/v1/payroll/runs/${run.id}/bank-advice.csv`)).status).toBe(403);
    const summary = await hr.get('/api/v1/payroll/reports/summary?month=2026-01');
    expect(summary.body.data.totals.employees).toBeGreaterThan(0);
    expect(summary.body.data.components.find((c) => c.code === 'BASIC').amount).toBeGreaterThan(0);
  });

  it('keeps payroll away from managers and employees', async () => {
    const { client: mgr } = await signedInAs(['manager']);
    expect((await mgr.get('/api/v1/payroll/runs')).status).toBe(403);
    expect((await mgr.get('/api/v1/payroll/reports/summary?month=2026-01')).status).toBe(403);
    const { client: emp } = await signedInAs(['employee']);
    expect((await emp.get('/api/v1/payroll/payslips')).body.data).toEqual([]);
    expect(await PayrollRuleSet.countDocuments()).toBe(1);
  });
});
