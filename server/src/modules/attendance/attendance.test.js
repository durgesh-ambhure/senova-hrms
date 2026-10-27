import { describe, expect, it } from 'vitest';
import { createEmployeeRecord, signedInAs, signedInAsEmployee } from '../../../test/helpers.js';
import { AttendanceRecord } from './attendanceRecord.model.js';
import { Shift } from './shift.model.js';
import { Holiday } from '../holidays/holiday.model.js';
import { LeaveRequest } from '../leave/leave.models.js';
import { Role } from '../roles/role.model.js';
import { ensureDefaultRoles } from '../roles/role.service.js';
import { addDays, parseDateOnly, todayIn, zonedToUtc } from '../../shared/dates.js';

const today = () => todayIn('Asia/Kolkata');
const snapshot = { name: 'Std', startTime: '09:30', endTime: '18:30', lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15, fullDayMinutes: 480, halfDayMinutes: 240, weeklyOffs: [0, 6] };

describe('check-in / check-out', () => {
  it('records a day with breaks and blocks duplicate punches', async () => {
    const { client: me } = await signedInAsEmployee(['employee']);
    expect((await me.post('/api/v1/attendance/check-out')).status).toBe(409);
    expect((await me.post('/api/v1/attendance/breaks/start')).status).toBe(409);

    const inRes = await me.post('/api/v1/attendance/check-in');
    expect(inRes.status).toBe(201);
    expect(inRes.body.data).toMatchObject({ date: today(), status: 'incomplete', source: 'web' });
    expect((await me.post('/api/v1/attendance/check-in')).status).toBe(409);

    expect((await me.post('/api/v1/attendance/breaks/start')).body.data.onBreak).toBe(true);
    expect((await me.post('/api/v1/attendance/breaks/start')).status).toBe(409);
    expect((await me.post('/api/v1/attendance/breaks/end')).body.data.onBreak).toBe(false);

    const out = await me.post('/api/v1/attendance/check-out');
    expect(out.status).toBe(200);
    expect(out.body.data.checkOut).toBeTruthy();
    expect(out.body.data.status).toBe('absent'); // a few seconds worked
    expect((await me.post('/api/v1/attendance/check-out')).status).toBe(409);

    const todayView = await me.get('/api/v1/attendance/me/today');
    expect(todayView.body.data.record.checkOut).toBeTruthy();
  });

  it('allows only one record per day even under concurrent check-ins', async () => {
    const { client: me, employee } = await signedInAsEmployee(['employee']);
    const results = await Promise.all([me.post('/api/v1/attendance/check-in'), me.post('/api/v1/attendance/check-in'), me.post('/api/v1/attendance/check-in')]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await AttendanceRecord.countDocuments({ employee: employee._id })).toBe(1);
  });

  it('rejects punches from logins without a current employee profile', async () => {
    const { client: noProfile } = await signedInAs(['employee']);
    expect((await noProfile.post('/api/v1/attendance/check-in')).status).toBe(404);
  });
});

describe('records and access', () => {
  it('lets managers see their team, but not other employees', async () => {
    const { client: mgr, employee: manager } = await signedInAsEmployee(['manager']);
    const report = await createEmployeeRecord({ reportingManager: manager._id });
    const stranger = await createEmployeeRecord();
    const range = `from=${addDays(today(), -7)}&to=${today()}`;
    expect((await mgr.get(`/api/v1/attendance/records?employee=${report._id}&${range}`)).status).toBe(200);
    expect((await mgr.get(`/api/v1/attendance/records?employee=${stranger._id}&${range}`)).status).toBe(404);
    const team = await mgr.get('/api/v1/attendance/team/today');
    expect(team.body.data.map((r) => r.employee.id)).toEqual([String(report._id)]);
  });

  it('employees can read only their own records', async () => {
    const { client: me } = await signedInAsEmployee(['employee']);
    const other = await createEmployeeRecord();
    const range = `from=${addDays(today(), -7)}&to=${today()}`;
    expect((await me.get(`/api/v1/attendance/records?${range}`)).status).toBe(200);
    expect((await me.get(`/api/v1/attendance/records?employee=${other._id}&${range}`)).status).toBe(404);
    expect((await me.get('/api/v1/attendance/team/today')).status).toBe(403);
    expect((await me.get(`/api/v1/attendance/records?from=2025-01-01&to=2025-06-01`)).status).toBe(422);
  });
});

describe('monthly summary', () => {
  it('combines punches, approved leave, holidays and weekly offs in half-day units', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const emp = await createEmployeeRecord({ workLocation: 'Pune' });
    await Holiday.create({ date: parseDateOnly('2025-03-05'), name: `Holi ${emp._id}`, type: 'public' });
    await Holiday.create({ date: parseDateOnly('2025-03-07'), name: `Mumbai only ${emp._id}`, type: 'public', locations: ['Mumbai'] });
    await AttendanceRecord.create([
      { employee: emp._id, date: parseDateOnly('2025-03-03'), shift: snapshot, status: 'present', checkIn: zonedToUtc('2025-03-03', '09:30', 'Asia/Kolkata'), checkOut: zonedToUtc('2025-03-03', '18:30', 'Asia/Kolkata'), workedMinutes: 540, lateByMinutes: 0 },
      { employee: emp._id, date: parseDateOnly('2025-03-04'), shift: snapshot, status: 'half_day', checkIn: zonedToUtc('2025-03-04', '10:00', 'Asia/Kolkata'), checkOut: zonedToUtc('2025-03-04', '15:00', 'Asia/Kolkata'), workedMinutes: 300, lateByMinutes: 30 },
    ]);
    await LeaveRequest.create({
      employee: emp._id,
      leaveType: emp._id,
      leaveTypeSnapshot: { name: 'Casual', code: 'CL', paid: true, unlimited: false },
      year: 2025,
      startDate: parseDateOnly('2025-03-06'),
      endDate: parseDateOnly('2025-03-06'),
      units: 2,
      slots: [{ date: parseDateOnly('2025-03-06'), half: 'full', units: 2 }],
      status: 'approved',
      appliedBy: emp._id,
    });

    const res = await hr.get(`/api/v1/attendance/summary?employee=${emp._id}&month=2025-03`);
    expect(res.status).toBe(200);
    const { totals, days } = res.body.data;
    // March 2025: 21 weekdays − 1 holiday (the Mumbai-only one doesn't apply in Pune) = 20 working days.
    expect(totals).toMatchObject({ workingDays: 20, presentUnits: 3, paidLeaveUnits: 2, unpaidLeaveUnits: 0, holidays: 1, weeklyOffs: 10, lateDays: 1, workedMinutes: 840 });
    expect(totals.absentUnits).toBe(1 + 17 * 2);
    expect(days.find((d) => d.date === '2025-03-05').kind).toBe('holiday');
    expect(days.find((d) => d.date === '2025-03-06').kind).toBe('leave');
    expect(days.find((d) => d.date === '2025-03-07').kind).toBe('absent');
  });

  it('excludes days before joining', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const emp = await createEmployeeRecord({ joiningDate: parseDateOnly('2025-03-17') });
    const res = await hr.get(`/api/v1/attendance/summary?employee=${emp._id}&month=2025-03`);
    expect(res.body.data.days.find((d) => d.date === '2025-03-10').kind).toBe('not_employed');
    expect(res.body.data.totals.workingDays).toBe(11);
  });
});

describe('attendance corrections', () => {
  async function setup() {
    const { client: mgr, employee: manager } = await signedInAsEmployee(['manager']);
    const { client: me, employee } = await signedInAsEmployee(['employee'], { reportingManager: manager._id });
    return { mgr, me, employee };
  }
  const yesterday = () => addDays(today(), -1);

  it('lets the reporting manager approve a missing punch, which rewrites the day', async () => {
    const { mgr, me, employee } = await setup();
    const req = await me.post('/api/v1/attendance/corrections').send({ date: yesterday(), checkIn: '09:30', checkOut: '18:30', reason: 'Forgot to punch in' });
    expect(req.status).toBe(201);
    expect((await me.post('/api/v1/attendance/corrections').send({ date: yesterday(), checkIn: '09:30', checkOut: '18:00', reason: 'Again please' })).status).toBe(409);

    const queue = await mgr.get('/api/v1/attendance/corrections?scope=approvals&status=pending');
    expect(queue.body.data.map((c) => c.id)).toContain(req.body.data.id);

    const approved = await mgr.post(`/api/v1/attendance/corrections/${req.body.data.id}/review`).send({ decision: 'approved' });
    expect(approved.body.data.status).toBe('approved');
    const record = await AttendanceRecord.findOne({ employee: employee._id, date: parseDateOnly(yesterday()) }).lean();
    expect(record).toMatchObject({ source: 'regularized', status: 'present', workedMinutes: 540 });
    expect((await mgr.post(`/api/v1/attendance/corrections/${req.body.data.id}/review`).send({ decision: 'approved' })).status).toBe(409);
  });

  it('blocks reviews by unrelated managers and self-approval, and enforces the window', async () => {
    const { me } = await setup();
    const { client: otherMgr } = await signedInAsEmployee(['manager']);
    const req = await me.post('/api/v1/attendance/corrections').send({ date: yesterday(), checkIn: '09:30', checkOut: '18:30', reason: 'Forgot to punch in' });
    expect((await otherMgr.post(`/api/v1/attendance/corrections/${req.body.data.id}/review`).send({ decision: 'approved' })).status).toBe(404);

    const { client: hrSelf } = await signedInAsEmployee(['hr_admin']);
    const own = await hrSelf.post('/api/v1/attendance/corrections').send({ date: yesterday(), checkIn: '09:30', checkOut: '18:30', reason: 'My own punch' });
    expect((await hrSelf.post(`/api/v1/attendance/corrections/${own.body.data.id}/review`).send({ decision: 'approved' })).status).toBe(404);

    expect((await me.post('/api/v1/attendance/corrections').send({ date: addDays(today(), -30), checkIn: '09:30', checkOut: '18:30', reason: 'Way too late' })).status).toBe(422);
    expect((await me.post('/api/v1/attendance/corrections').send({ date: addDays(today(), 1), checkIn: '09:30', checkOut: '18:30', reason: 'Future day' })).status).toBe(422);
    expect((await me.post(`/api/v1/attendance/corrections/${req.body.data.id}/cancel`)).body.data.status).toBe('cancelled');
  });

  it('requires a reason to reject', async () => {
    const { mgr, me } = await setup();
    const req = await me.post('/api/v1/attendance/corrections').send({ date: yesterday(), checkIn: '09:30', checkOut: '18:30', reason: 'Forgot to punch in' });
    expect((await mgr.post(`/api/v1/attendance/corrections/${req.body.data.id}/review`).send({ decision: 'rejected' })).status).toBe(422);
    expect((await mgr.post(`/api/v1/attendance/corrections/${req.body.data.id}/review`).send({ decision: 'rejected', note: 'Badge logs show you were out' })).body.data.status).toBe('rejected');
  });
});

describe('shifts, holidays and policies', () => {
  it('keeps exactly one default shift and protects it from archiving', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const a = (await hr.post('/api/v1/shifts').send({ name: 'General', code: `G${Date.now() % 10000}`, startTime: '09:30', endTime: '18:30', isDefault: true })).body.data;
    const b = (await hr.post('/api/v1/shifts').send({ name: 'Night', code: `N${Date.now() % 10000}`, startTime: '22:00', endTime: '06:00', isDefault: true })).body.data;
    expect(b.overnight).toBe(true);
    expect(await Shift.countDocuments({ isDefault: true })).toBe(1);
    expect((await hr.patch(`/api/v1/shifts/${b.id}`).send({ status: 'archived' })).status).toBe(409);
    expect((await hr.patch(`/api/v1/shifts/${a.id}`).send({ halfDayMinutes: 600 })).status).toBe(422);
    const { client: emp } = await signedInAs(['employee']);
    expect((await emp.post('/api/v1/shifts').send({ name: 'X', code: 'XX', startTime: '09:00', endTime: '17:00' })).status).toBe(403);
  });

  it('manages holidays and locks past ones', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const future = addDays(today(), 20);
    const h = await hr.post('/api/v1/holidays').send({ date: future, name: 'Founders Day', locations: ['Pune', ' pune '] });
    expect(h.status).toBe(201);
    expect(h.body.data.locations).toEqual(['Pune', 'pune']);
    const list = await hr.get(`/api/v1/holidays?year=${future.slice(0, 4)}&location=PUNE`);
    expect(list.body.data.some((x) => x.id === h.body.data.id)).toBe(true);
    const past = await Holiday.create({ date: parseDateOnly('2024-01-26'), name: `Republic Day ${Date.now()}` });
    expect((await hr.delete(`/api/v1/holidays/${past._id}`)).status).toBe(409);
    expect((await hr.delete(`/api/v1/holidays/${h.body.data.id}`)).status).toBe(204);
    const { client: emp } = await signedInAs(['employee']);
    expect((await emp.post('/api/v1/holidays').send({ date: future, name: 'Mine' })).status).toBe(403);
    expect((await emp.get('/api/v1/holidays')).status).toBe(200);
  });

  it('lets module admins change their policies, and no one else', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const res = await hr.patch('/api/v1/company/policies').send({ leave: { backdatedDays: 15 }, attendance: { correctionWindowDays: 10 } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ leave: { backdatedDays: 15, countNonWorkingDays: false }, attendance: { correctionWindowDays: 10, overtimeEnabled: false } });
    await hr.patch('/api/v1/company/policies').send({ leave: { backdatedDays: 30 }, attendance: { correctionWindowDays: 7 } });
    const { client: payroll } = await signedInAs(['payroll_admin']);
    expect((await payroll.patch('/api/v1/company/policies').send({ leave: { backdatedDays: 90 } })).status).toBe(403);
  });
});

describe('role defaults sync', () => {
  it('adds newly introduced default permissions once, without re-adding removed ones', async () => {
    await ensureDefaultRoles();
    const role = await Role.findOne({ key: 'manager' });
    expect(role.permissions).toContain('attendance:approve:team');
    role.permissions = role.permissions.filter((p) => p !== 'attendance:approve:team');
    await role.save();
    await ensureDefaultRoles();
    expect((await Role.findOne({ key: 'manager' })).permissions).not.toContain('attendance:approve:team');
    // Restore for other tests in this file.
    await Role.updateOne({ key: 'manager' }, { $addToSet: { permissions: 'attendance:approve:team' } });
  });
});
