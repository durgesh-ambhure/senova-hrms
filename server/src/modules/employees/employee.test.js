import { describe, expect, it } from 'vitest';
import { createEmployeeRecord, getOrg, signedInAs, signedInAsEmployee } from '../../../test/helpers.js';
import { Employee } from './employee.model.js';
import { EmployeeSensitive } from './employeeSensitive.model.js';
import { EmploymentEvent } from './employmentEvent.model.js';
import { User } from '../users/user.model.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { LIFECYCLE_TRANSITIONS } from './employee.service.js';
import { addDays, todayIn } from '../../shared/dates.js';

const today = () => todayIn('Asia/Kolkata');

async function newEmployeeBody(overrides = {}) {
  const { department, designation } = await getOrg();
  return {
    firstName: 'Meera',
    lastName: 'Iyer',
    workEmail: `meera.${Date.now()}${Math.random().toString(36).slice(2, 6)}@senova.test`,
    departmentId: String(department._id),
    designationId: String(designation._id),
    employmentType: 'full_time',
    joiningDate: '2025-04-01',
    ...overrides,
  };
}

describe('employee creation', () => {
  it('creates an employee with a generated, sequential code and history', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const a = await hr.post('/api/v1/employees').send(await newEmployeeBody({ probationEndDate: '2025-10-01' }));
    const b = await hr.post('/api/v1/employees').send(await newEmployeeBody());
    expect(a.status).toBe(201);
    expect(a.body.data.employeeCode).toMatch(/^SEN-\d{4}$/);
    expect(Number(b.body.data.employeeCode.slice(4))).toBe(Number(a.body.data.employeeCode.slice(4)) + 1);
    expect(a.body.data).toMatchObject({ fullName: 'Meera Iyer', lifecycleStatus: 'active', joiningDate: '2025-04-01', probation: { status: 'on_probation', endDate: '2025-10-01' } });
    const events = await EmploymentEvent.find({ employee: a.body.data.id }).lean();
    expect(events.map((e) => e.type).sort()).toEqual(['created', 'joined']);
  });

  it('marks future joiners as pre-joining', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const res = await hr.post('/api/v1/employees').send(await newEmployeeBody({ joiningDate: addDays(today(), 10) }));
    expect(res.body.data.lifecycleStatus).toBe('pre_joining');
  });

  it('validates input and rejects duplicate work emails', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const bad = await hr.post('/api/v1/employees').send({ firstName: '', workEmail: 'nope', joiningDate: '2025-02-30' });
    expect(bad.status).toBe(422);
    const paths = bad.body.error.details.map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['firstName', 'lastName', 'workEmail', 'departmentId', 'joiningDate']));

    const body = await newEmployeeBody();
    expect((await hr.post('/api/v1/employees').send(body)).status).toBe(201);
    expect((await hr.post('/api/v1/employees').send({ ...body, workEmail: body.workEmail.toUpperCase() })).status).toBe(409);
  });

  it('rejects probation ending before joining and inactive departments', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    expect((await hr.post('/api/v1/employees').send(await newEmployeeBody({ probationEndDate: '2025-03-01' }))).status).toBe(422);
    const res = await hr.post('/api/v1/employees').send(await newEmployeeBody({ departmentId: '0123456789abcdef01234567' }));
    expect(res.status).toBe(422);
  });

  it('is forbidden without employees:manage', async () => {
    for (const role of ['manager', 'employee', 'payroll_admin', 'recruiter']) {
      const { client } = await signedInAs([role]);
      expect((await client.post('/api/v1/employees').send(await newEmployeeBody())).status).toBe(403);
    }
  });
});

describe('employee access control', () => {
  it('managers see only their direct and indirect reports, with limited fields', async () => {
    const { client: mgr, employee: manager } = await signedInAsEmployee(['manager']);
    const direct = await createEmployeeRecord({ reportingManager: manager._id, dateOfBirth: new Date('1995-01-01Z') });
    const indirect = await createEmployeeRecord({ reportingManager: direct._id });
    const stranger = await createEmployeeRecord();

    const list = await mgr.get('/api/v1/employees');
    expect(list.status).toBe(200);
    const ids = list.body.data.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([String(direct._id), String(indirect._id)]));
    expect(ids).not.toContain(String(stranger._id));

    const view = await mgr.get(`/api/v1/employees/${direct._id}`);
    expect(view.body.data.viewLevel).toBe('team');
    expect(view.body.data).not.toHaveProperty('dateOfBirth');
    expect(view.body.data).not.toHaveProperty('personalEmail');

    // Probing an employee outside the team looks exactly like a missing record.
    const probe = await mgr.get(`/api/v1/employees/${stranger._id}`);
    expect(probe.status).toBe(404);
    expect((await mgr.get(`/api/v1/employees/${direct._id}/history`)).status).toBe(403);
  });

  it('employees can read only their own profile and cannot use the directory', async () => {
    const { client: me, employee } = await signedInAsEmployee(['employee']);
    const other = await createEmployeeRecord();
    expect((await me.get('/api/v1/employees')).status).toBe(403);
    expect((await me.get(`/api/v1/employees/${other._id}`)).status).toBe(404);
    const own = await me.get('/api/v1/employees/me');
    expect(own.status).toBe(200);
    expect(own.body.data).toMatchObject({ id: String(employee._id), viewLevel: 'full' });
    expect(own.body.data).not.toHaveProperty('account');
  });

  it('self-service updates only allowlisted fields', async () => {
    const { client: me, employee } = await signedInAsEmployee(['employee']);
    const { department } = await getOrg();
    const res = await me.patch('/api/v1/employees/me').send({
      phone: '+91 98765 43210',
      emergencyContact: { name: 'Ravi Iyer', relationship: 'Spouse', phone: '+91 91234 56789' },
      // Ignored: not self-editable.
      lastName: 'Hacked',
      departmentId: String(department._id),
      lifecycleStatus: 'exited',
    });
    expect(res.status).toBe(200);
    const saved = await Employee.findById(employee._id).lean();
    expect(saved.phone).toBe('+91 98765 43210');
    expect(saved.emergencyContact.name).toBe('Ravi Iyer');
    expect(saved.lastName).toBe(employee.lastName);
    expect(saved.lifecycleStatus).toBe('active');
  });

  it('cannot PATCH another employee without employees:manage', async () => {
    const { client: me } = await signedInAsEmployee(['employee']);
    const other = await createEmployeeRecord();
    expect((await me.patch(`/api/v1/employees/${other._id}`).send({ firstName: 'X' })).status).toBe(403);
  });
});

describe('directory', () => {
  it('searches by name, code and email, filters, and hides archived records', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const target = await createEmployeeRecord({ firstName: 'Zubin', lastName: 'Mehta', employmentType: 'contract' });
    await createEmployeeRecord({ firstName: 'Zubin', lastName: 'Archived', archivedAt: new Date(), lifecycleStatus: 'exited' });

    const byName = await hr.get('/api/v1/employees?search=zubin');
    expect(byName.body.data.map((e) => e.id)).toEqual([String(target._id)]);
    const byCode = await hr.get(`/api/v1/employees?search=${target.employeeCode}`);
    expect(byCode.body.data).toHaveLength(1);
    const byType = await hr.get('/api/v1/employees?employmentType=contract&search=zubin');
    expect(byType.body.meta.total).toBe(1);
    const withArchived = await hr.get('/api/v1/employees?search=zubin&includeArchived=true');
    expect(withArchived.body.meta.total).toBe(2);
    expect((await hr.get('/api/v1/employees?sort=salary')).status).toBe(422);
  });
});

describe('editing and reporting lines', () => {
  it('records history for department, designation and manager changes', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const manager = await createEmployeeRecord();
    const emp = await createEmployeeRecord();
    const res = await hr.patch(`/api/v1/employees/${emp._id}`).send({ reportingManagerId: String(manager._id), effectiveDate: '2025-06-01' });
    expect(res.status).toBe(200);
    expect(res.body.data.reportingManager.id).toBe(String(manager._id));
    const history = await hr.get(`/api/v1/employees/${emp._id}/history`);
    expect(history.body.data[0]).toMatchObject({ type: 'manager_changed', effectiveDate: '2025-06-01', to: manager.fullName });
  });

  it('prevents reporting loops and self-reporting', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const top = await createEmployeeRecord();
    const mid = await createEmployeeRecord({ reportingManager: top._id });
    const low = await createEmployeeRecord({ reportingManager: mid._id });
    expect((await hr.patch(`/api/v1/employees/${top._id}`).send({ reportingManagerId: String(low._id) })).status).toBe(422);
    expect((await hr.patch(`/api/v1/employees/${top._id}`).send({ reportingManagerId: String(top._id) })).status).toBe(422);
  });

  it('only allows the joining date to change before joining', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const emp = await createEmployeeRecord();
    expect((await hr.patch(`/api/v1/employees/${emp._id}`).send({ joiningDate: '2024-02-01' })).status).toBe(409);
  });
});

describe('lifecycle', () => {
  it('defines only the allowed transitions', () => {
    expect(LIFECYCLE_TRANSITIONS.start_notice.from).toEqual(['active']);
    expect(LIFECYCLE_TRANSITIONS.activate.from).toEqual(['pre_joining']);
    expect(LIFECYCLE_TRANSITIONS.exit.from).not.toContain('exited');
  });

  it('runs notice → exit, disables the login and records history', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const { user, employee, client: leaver } = await signedInAsEmployee(['employee']);

    const notice = await hr.post(`/api/v1/employees/${employee._id}/lifecycle`).send({ action: 'start_notice', effectiveDate: '2025-05-01', lastWorkingDate: '2025-05-31', reason: 'Relocating' });
    expect(notice.status).toBe(200);
    expect(notice.body.data.lifecycleStatus).toBe('notice_period');

    expect((await hr.post(`/api/v1/employees/${employee._id}/lifecycle`).send({ action: 'activate', effectiveDate: '2025-05-02' })).status).toBe(409);

    const exit = await hr.post(`/api/v1/employees/${employee._id}/lifecycle`).send({ action: 'exit', effectiveDate: '2025-05-31', reason: 'Resigned' });
    expect(exit.status).toBe(200);
    expect(exit.body.data.exit).toMatchObject({ lastWorkingDate: '2025-05-31', exitDate: '2025-05-31' });
    expect((await User.findById(user._id)).status).toBe('disabled');
    expect((await leaver.get('/api/v1/auth/me')).status).toBe(401);

    const types = (await EmploymentEvent.find({ employee: employee._id }).lean()).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['notice_started', 'exited']));
  });

  it('rejects a last working day before the resignation date', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const emp = await createEmployeeRecord();
    const res = await hr.post(`/api/v1/employees/${emp._id}/lifecycle`).send({ action: 'start_notice', effectiveDate: '2025-05-10', lastWorkingDate: '2025-05-01' });
    expect(res.status).toBe(422);
  });

  it('confirms or extends probation', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const emp = await createEmployeeRecord({ probation: { status: 'on_probation', endDate: new Date('2024-07-15Z') } });
    const extend = await hr.post(`/api/v1/employees/${emp._id}/probation`).send({ action: 'extend', newEndDate: '2024-06-01', note: 'More time' });
    expect(extend.status).toBe(422);
    const ok = await hr.post(`/api/v1/employees/${emp._id}/probation`).send({ action: 'extend', newEndDate: '2024-09-15', note: 'More time' });
    expect(ok.body.data.probation).toMatchObject({ status: 'extended', endDate: '2024-09-15' });
    const confirm = await hr.post(`/api/v1/employees/${emp._id}/probation`).send({ action: 'confirm', effectiveDate: '2024-09-15' });
    expect(confirm.body.data.probation).toMatchObject({ status: 'confirmed', confirmedOn: '2024-09-15' });
    expect((await hr.post(`/api/v1/employees/${emp._id}/probation`).send({ action: 'confirm', effectiveDate: '2024-09-16' })).status).toBe(409);
  });

  it('archives only exited or pre-joining employees, and can restore them', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const active = await createEmployeeRecord();
    expect((await hr.post(`/api/v1/employees/${active._id}/archive`)).status).toBe(409);
    const gone = await createEmployeeRecord({ lifecycleStatus: 'exited' });
    expect((await hr.post(`/api/v1/employees/${gone._id}/archive`)).body.data.archived).toBe(true);
    expect((await hr.patch(`/api/v1/employees/${gone._id}`).send({ firstName: 'X' })).status).toBe(409);
    expect((await hr.post(`/api/v1/employees/${gone._id}/restore`)).body.data.archived).toBe(false);
  });
});

describe('login accounts', () => {
  it('invites a linked login account once, requiring users:manage too', async () => {
    const emp = await createEmployeeRecord();
    const { client: hr } = await signedInAs(['hr_admin']);
    expect((await hr.post(`/api/v1/employees/${emp._id}/account`)).status).toBe(403);

    const { client: admin } = await signedInAs(['super_admin']);
    const res = await admin.post(`/api/v1/employees/${emp._id}/account`);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email: emp.workEmail, roles: ['employee'], status: 'invited', employee: String(emp._id) });
    expect((await admin.post(`/api/v1/employees/${emp._id}/account`)).status).toBe(409);
    const profile = await admin.get(`/api/v1/employees/${emp._id}`);
    expect(profile.body.data.account).toMatchObject({ status: 'invited' });
  });
});

describe('sensitive data', () => {
  const body = { bank: { accountHolderName: 'Meera Iyer', bankName: 'HDFC Bank', ifsc: 'hdfc0001234', accountNumber: '50100012345678' }, pan: 'abcde1234f', aadhaarLast4: '4321', uan: '100200300400' };

  it('encrypts at rest, masks by default, and audits reveals', async () => {
    const emp = await createEmployeeRecord();
    const { client: hr } = await signedInAs(['hr_admin']);
    const saved = await hr.put(`/api/v1/employees/${emp._id}/sensitive`).send(body);
    expect(saved.status).toBe(200);
    expect(saved.body.data.bank.accountNumber).toBe('XXXX5678');
    expect(saved.body.data.pan).toBe('XXXX234F');

    const raw = await EmployeeSensitive.findOne({ employee: emp._id }).lean();
    expect(JSON.stringify(raw)).not.toContain('50100012345678');
    expect(JSON.stringify(raw)).not.toContain('ABCDE1234F');

    const revealed = await hr.get(`/api/v1/employees/${emp._id}/sensitive?reveal=true`);
    expect(revealed.body.data.bank).toMatchObject({ accountNumber: '50100012345678', ifsc: 'HDFC0001234' });
    expect(revealed.body.data.pan).toBe('ABCDE1234F');
    expect(await AuditLog.exists({ action: 'employee.sensitive_viewed', entityId: String(emp._id) })).toBeTruthy();
    const updateLog = await AuditLog.findOne({ action: 'employee.sensitive_updated' }).lean();
    expect(JSON.stringify(updateLog)).not.toContain('50100012345678');
  });

  it('is unavailable to managers, employees (even their own) and recruiters', async () => {
    const { client: me, employee } = await signedInAsEmployee(['employee']);
    expect((await me.get(`/api/v1/employees/${employee._id}/sensitive`)).status).toBe(403);
    for (const role of ['manager', 'recruiter']) {
      const { client } = await signedInAs([role]);
      expect((await client.get(`/api/v1/employees/${employee._id}/sensitive`)).status).toBe(403);
    }
    // Payroll Admin can read but not change bank details.
    const { client: payroll } = await signedInAs(['payroll_admin']);
    expect((await payroll.get(`/api/v1/employees/${employee._id}/sensitive`)).status).toBe(200);
    expect((await payroll.put(`/api/v1/employees/${employee._id}/sensitive`).send(body)).status).toBe(403);
  });

  it('validates formats and never stores a full Aadhaar number', async () => {
    const emp = await createEmployeeRecord();
    const { client: hr } = await signedInAs(['hr_admin']);
    const res = await hr.put(`/api/v1/employees/${emp._id}/sensitive`).send({ pan: '1234', bank: { ifsc: 'BAD' }, aadhaarLast4: '123412341234' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d) => d.path)).toEqual(expect.arrayContaining(['pan', 'bank.ifsc', 'aadhaarLast4']));
  });
});
