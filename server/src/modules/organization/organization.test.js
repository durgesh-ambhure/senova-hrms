import { describe, expect, it } from 'vitest';
import { createEmployeeRecord, signedInAs } from '../../../test/helpers.js';
import { Department } from './department.model.js';

describe('departments', () => {
  it('lets any signed-in user list, but only organization:manage create', async () => {
    const { client: employee } = await signedInAs(['employee']);
    expect((await employee.get('/api/v1/departments')).status).toBe(200);
    expect((await employee.post('/api/v1/departments').send({ name: 'Legal', code: 'LEG' })).status).toBe(403);

    const { client: hr } = await signedInAs(['hr_admin']);
    const res = await hr.post('/api/v1/departments').send({ name: 'Legal', code: 'leg', description: 'Contracts' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Legal', code: 'LEG', status: 'active' });
  });

  it('rejects duplicate names case-insensitively and duplicate codes', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    await hr.post('/api/v1/departments').send({ name: 'Marketing', code: 'MKT' });
    expect((await hr.post('/api/v1/departments').send({ name: 'marketing', code: 'MK2' })).status).toBe(409);
    expect((await hr.post('/api/v1/departments').send({ name: 'Brand', code: 'MKT' })).status).toBe(409);
  });

  it('refuses to archive a department that still has current employees', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const dept = (await hr.post('/api/v1/departments').send({ name: 'Support', code: 'SUP' })).body.data;
    const emp = await createEmployeeRecord({ department: dept.id });
    expect((await hr.patch(`/api/v1/departments/${dept.id}`).send({ status: 'archived' })).status).toBe(409);

    await emp.updateOne({ lifecycleStatus: 'exited' });
    const archived = await hr.patch(`/api/v1/departments/${dept.id}`).send({ status: 'archived' });
    expect(archived.status).toBe(200);
    const list = await hr.get('/api/v1/departments');
    expect(list.body.data.some((d) => d.id === dept.id)).toBe(false);
    const all = await hr.get('/api/v1/departments?includeArchived=true');
    expect(all.body.data.some((d) => d.id === dept.id)).toBe(true);
  });

  it('only accepts a current employee as department head', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const exited = await createEmployeeRecord({ lifecycleStatus: 'exited' });
    const res = await hr.post('/api/v1/departments').send({ name: 'Audit', code: 'AUD', headId: String(exited._id) });
    expect(res.status).toBe(422);
    expect(await Department.exists({ code: 'AUD' })).toBeNull();
  });
});

describe('designations', () => {
  it('creates and lists designations ordered by level', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    await hr.post('/api/v1/designations').send({ title: 'Principal Engineer', level: 7 });
    await hr.post('/api/v1/designations').send({ title: 'Trainee', level: 1 });
    const res = await hr.get('/api/v1/designations');
    const levels = res.body.data.map((d) => d.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect((await hr.post('/api/v1/designations').send({ title: 'trainee' })).status).toBe(409);
  });
});
