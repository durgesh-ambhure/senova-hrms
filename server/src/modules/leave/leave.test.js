import { describe, expect, it } from 'vitest';
import { createEmployeeRecord, signedInAs, signedInAsEmployee } from '../../../test/helpers.js';
import { LeaveBalance } from './leave.models.js';
import { Holiday } from '../holidays/holiday.model.js';
import { addDays, parseDateOnly, todayIn, weekStartOf } from '../../shared/dates.js';

// Dates are relative to "today" so the backdating/advance limits always hold.
// Assumes next week falls in the same calendar year as its Monday (true except at year end).
const today = () => todayIn('Asia/Kolkata');
const mon = () => addDays(weekStartOf(today()), 7);
const day = (n) => addDays(mon(), n); // 0 = Monday … 4 = Friday
const year = () => Number(mon().slice(0, 4));

let seq = 0;
async function createType(hr, overrides = {}) {
  seq += 1;
  const res = await hr.post('/api/v1/leave/types').send({ name: `Casual ${seq}`, code: `CL${seq}`, annualQuotaDays: 12, accrual: 'annual', ...overrides });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function setup(typeOverrides) {
  const { client: hr } = await signedInAs(['hr_admin']);
  const type = await createType(hr, typeOverrides);
  const { client: mgr, employee: manager } = await signedInAsEmployee(['manager']);
  const { client: me, employee } = await signedInAsEmployee(['employee'], { reportingManager: manager._id, joiningDate: parseDateOnly('2020-01-06') });
  return { hr, mgr, me, employee, type };
}

const apply = (client, type, body) => client.post('/api/v1/leave/requests').send({ leaveTypeId: type.id, startDate: day(0), endDate: day(0), ...body });
const balanceOf = async (client, type, query = '') => (await client.get(`/api/v1/leave/balances${query}`)).body.data.balances.find((b) => b.leaveType.id === type.id);

describe('leave types', () => {
  it('validates configuration and restricts management to leave:manage', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    expect((await hr.post('/api/v1/leave/types').send({ name: 'Bad', code: 'BAD', annualQuotaDays: 0 })).status).toBe(422);
    expect((await hr.post('/api/v1/leave/types').send({ name: 'Paid LOP', code: 'PL0', unlimited: true, paid: true })).status).toBe(422);
    expect((await hr.post('/api/v1/leave/types').send({ name: 'Odd', code: 'ODD', annualQuotaDays: 1.3 })).status).toBe(422);
    const { client: emp } = await signedInAs(['employee']);
    expect((await emp.post('/api/v1/leave/types').send({ name: 'Mine', code: 'MINE', annualQuotaDays: 99 })).status).toBe(403);
  });
});

describe('applying for leave', () => {
  it('charges working days only and holds them as pending', async () => {
    const { me, type } = await setup();
    await Holiday.create({ date: parseDateOnly(day(2)), name: `Midweek holiday ${type.code}`, type: 'company' });
    // Monday → next Monday spans a weekend and a holiday: 5 working days.
    const res = await apply(me, type, { endDate: day(7), reason: 'Family trip' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'pending', units: 10 });
    expect(res.body.data.days.map((d) => d.date)).toEqual([day(0), day(1), day(3), day(4), day(7)]);
    const b = await balanceOf(me, type);
    expect(b).toMatchObject({ accruedUnits: 24, pendingUnits: 10, usedUnits: 0, availableUnits: 14 });
  });

  it('supports half days and rejects overlapping requests', async () => {
    const { me, type } = await setup();
    expect((await apply(me, type, { endSession: 'first_half' })).body.data.units).toBe(1);
    expect((await apply(me, type, { startSession: 'second_half' })).status).toBe(201);
    expect((await apply(me, type, {})).status).toBe(409);
    expect((await apply(me, type, { startDate: day(1), endDate: day(1), startSession: 'second_half', endSession: 'first_half' })).status).toBe(422);
  });

  it('enforces balance, half-day, probation and date rules', async () => {
    const { me, type, employee } = await setup({ annualQuotaDays: 2, allowHalfDay: false, availableDuringProbation: false });
    expect((await apply(me, type, { endDate: day(4) })).status).toBe(409); // 5 days > 2 available
    expect((await apply(me, type, { endSession: 'first_half' })).status).toBe(422);
    expect((await apply(me, type, { startDate: addDays(today(), -60), endDate: addDays(today(), -60) })).status).toBe(422);
    expect((await apply(me, type, { startDate: day(4), endDate: day(0) })).status).toBe(422);
    expect((await apply(me, type, { startDate: day(5), endDate: day(6) })).status).toBe(422); // weekend only
    await employee.updateOne({ probation: { status: 'on_probation' } });
    const probation = await apply(me, type, {});
    expect(probation.status).toBe(422);
    expect(probation.body.error.details[0].message).toMatch(/probation/);
  });

  it('tracks unlimited unpaid leave without a balance', async () => {
    const { hr } = await setup();
    const lop = await createType(hr, { name: 'Loss of pay', code: `LOP${seq}`, paid: false, unlimited: true, annualQuotaDays: 0 });
    const { client: me } = await signedInAsEmployee(['employee'], { joiningDate: parseDateOnly('2020-01-06') });
    expect((await apply(me, lop, { endDate: day(4) })).status).toBe(201);
    expect((await balanceOf(me, lop)).availableUnits).toBeNull();
  });

  it('prevents applying for someone else unless HR', async () => {
    const { me, type } = await setup();
    const other = await createEmployeeRecord({ joiningDate: parseDateOnly('2020-01-06') });
    expect((await apply(me, type, { employeeId: String(other._id) })).status).toBe(403);
    const { client: hr } = await signedInAs(['hr_admin']);
    const onBehalf = await apply(hr, type, { employeeId: String(other._id) });
    expect(onBehalf.status).toBe(201);
    expect(onBehalf.body.data.employee.id).toBe(String(other._id));
  });
});

describe('approvals', () => {
  it('moves days from pending to used on approval, and releases them on rejection', async () => {
    const { me, mgr, type } = await setup();
    const a = (await apply(me, type, { endDate: day(1) })).body.data;
    const b = (await apply(me, type, { startDate: day(3), endDate: day(3) })).body.data;

    const queue = await mgr.get('/api/v1/leave/requests?scope=approvals');
    expect(queue.body.data.map((r) => r.id)).toEqual(expect.arrayContaining([a.id, b.id]));

    expect((await mgr.post(`/api/v1/leave/requests/${a.id}/decision`).send({ decision: 'approved' })).body.data.status).toBe('approved');
    expect((await mgr.post(`/api/v1/leave/requests/${b.id}/decision`).send({ decision: 'rejected' })).status).toBe(422);
    expect((await mgr.post(`/api/v1/leave/requests/${b.id}/decision`).send({ decision: 'rejected', note: 'Release week' })).body.data.status).toBe('rejected');
    expect((await mgr.post(`/api/v1/leave/requests/${a.id}/decision`).send({ decision: 'rejected', note: 'Changed my mind' })).status).toBe(409);

    expect(await balanceOf(me, type)).toMatchObject({ usedUnits: 4, pendingUnits: 0, availableUnits: 20 });
  });

  it('blocks self-approval and approvals by unrelated managers', async () => {
    const { me, type } = await setup();
    const r = (await apply(me, type, {})).body.data;
    const { client: otherMgr } = await signedInAsEmployee(['manager']);
    expect((await otherMgr.post(`/api/v1/leave/requests/${r.id}/decision`).send({ decision: 'approved' })).status).toBe(404);
    expect((await otherMgr.get(`/api/v1/leave/requests/${r.id}`)).status).toBe(404);
    expect((await me.post(`/api/v1/leave/requests/${r.id}/decision`).send({ decision: 'approved' })).status).toBe(403);

    const { client: hr, employee: hrEmp } = await signedInAsEmployee(['hr_admin'], { joiningDate: parseDateOnly('2020-01-06') });
    const own = (await apply(hr, type, {})).body.data;
    expect((await hr.post(`/api/v1/leave/requests/${own.id}/decision`).send({ decision: 'approved' })).status).toBe(403);
    expect(own.employee.id).toBe(String(hrEmp._id));
  });
});

describe('cancellation', () => {
  it('withdraws pending leave immediately and routes approved leave through the approver', async () => {
    const { me, mgr, type } = await setup();
    const pending = (await apply(me, type, {})).body.data;
    expect((await me.post(`/api/v1/leave/requests/${pending.id}/cancel`).send({})).body.data.status).toBe('cancelled');

    const approved = (await apply(me, type, { startDate: day(1), endDate: day(2) })).body.data;
    await mgr.post(`/api/v1/leave/requests/${approved.id}/decision`).send({ decision: 'approved' });
    const requested = await me.post(`/api/v1/leave/requests/${approved.id}/cancel`).send({ reason: 'Trip postponed' });
    expect(requested.body.data.status).toBe('cancellation_requested');
    // Still holds the days while the cancellation is reviewed.
    expect((await apply(me, type, { startDate: day(1), endDate: day(1) })).status).toBe(409);

    const done = await mgr.post(`/api/v1/leave/requests/${approved.id}/cancellation-decision`).send({ decision: 'approved' });
    expect(done.body.data.status).toBe('cancelled');
    expect(await balanceOf(me, type)).toMatchObject({ usedUnits: 0, pendingUnits: 0, availableUnits: 24 });
  });
});

describe('balances', () => {
  it('lets HR adjust balances with a reason, never their own, and audits it', async () => {
    const { hr, me, employee, type } = await setup();
    const res = await hr.post('/api/v1/leave/balances/adjust').send({ employeeId: String(employee._id), leaveTypeId: type.id, year: year(), days: 1.5, reason: 'Comp-off for launch weekend' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ adjustedUnits: 3, availableUnits: 27 });
    expect((await hr.post('/api/v1/leave/balances/adjust').send({ employeeId: String(employee._id), leaveTypeId: type.id, year: year(), days: -40, reason: 'Oops' })).status).toBe(409);
    expect((await balanceOf(me, type)).adjustments[0]).toMatchObject({ units: 3, reason: 'Comp-off for launch weekend' });

    const { client: hrSelf, employee: hrEmp } = await signedInAsEmployee(['hr_admin']);
    expect((await hrSelf.post('/api/v1/leave/balances/adjust').send({ employeeId: String(hrEmp._id), leaveTypeId: type.id, year: year(), days: 5, reason: 'Bonus' })).status).toBe(403);
  });

  it('carries forward unused leave up to the cap', async () => {
    const { hr, employee } = await setup();
    const type = await createType(hr, { carryForwardMaxDays: 5 });
    const prevYear = year() - 1;
    // Previous year: 24 accrued, 4 used → 20 left; the cap allows 10 units.
    await LeaveBalance.create({ employee: employee._id, leaveType: type.id, year: prevYear, accruedUnits: 24, usedUnits: 4 });
    const res = await hr.get(`/api/v1/leave/balances?employee=${employee._id}&year=${year()}`);
    expect(res.body.data.balances.find((b) => b.leaveType.id === type.id)).toMatchObject({ openingUnits: 10, accruedUnits: 24, availableUnits: 34 });
  });

  it('hides other employees’ balances', async () => {
    const { me } = await setup();
    const other = await createEmployeeRecord();
    expect((await me.get(`/api/v1/leave/balances?employee=${other._id}`)).status).toBe(404);
  });
});
