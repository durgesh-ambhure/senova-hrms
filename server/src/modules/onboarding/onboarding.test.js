import { describe, expect, it } from 'vitest';
import { createEmployeeRecord, signedInAs, signedInAsEmployee } from '../../../test/helpers.js';
import { OnboardingTask } from './onboardingTask.model.js';

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0x20)]);

const checklist = {
  name: 'Engineering onboarding',
  kind: 'onboarding',
  tasks: [
    { title: 'Upload identity proof', assigneeType: 'employee', dueOffsetDays: -2, documentCategory: 'identity' },
    { title: 'Read the handbook', assigneeType: 'employee', dueOffsetDays: 5 },
    { title: 'Set up 1:1s', assigneeType: 'manager', dueOffsetDays: 3 },
    { title: 'Create email account', assigneeType: 'hr', dueOffsetDays: -1 },
  ],
};

async function setup() {
  const { client: hr } = await signedInAs(['hr_admin']);
  const template = (await hr.post('/api/v1/onboarding/templates').send({ ...checklist, name: `${checklist.name} ${Math.random()}` })).body.data;
  const { client: mgr, employee: manager } = await signedInAsEmployee(['manager']);
  const { client: joiner, employee } = await signedInAsEmployee(['employee'], {
    reportingManager: manager._id,
    joiningDate: new Date('2025-07-01T00:00:00Z'),
  });
  const started = await hr.post(`/api/v1/onboarding/employees/${employee._id}/start`).send({ templateId: template.id });
  return { hr, mgr, joiner, employee, template, started };
}

const taskBy = (tasks, title) => tasks.find((t) => t.title === title);

describe('onboarding checklists', () => {
  it('only HR manages templates; templates need at least one task', async () => {
    const { client: emp } = await signedInAs(['employee']);
    expect((await emp.get('/api/v1/onboarding/templates')).status).toBe(403);
    const { client: hr } = await signedInAs(['hr_admin']);
    expect((await hr.post('/api/v1/onboarding/templates').send({ name: 'Empty', kind: 'onboarding', tasks: [] })).status).toBe(422);
  });

  it('starts a checklist with due dates relative to the joining date, once', async () => {
    const { hr, employee, template, started } = await setup();
    expect(started.status).toBe(201);
    expect(started.body.data).toHaveLength(4);
    expect(taskBy(started.body.data, 'Upload identity proof').dueDate).toBe('2025-06-29');
    expect(taskBy(started.body.data, 'Read the handbook').dueDate).toBe('2025-07-06');
    const again = await hr.post(`/api/v1/onboarding/employees/${employee._id}/start`).send({ templateId: template.id });
    expect(again.status).toBe(409);
  });

  it('enforces who may complete each task', async () => {
    const { hr, mgr, joiner, started } = await setup();
    const tasks = started.body.data;
    const handbook = taskBy(tasks, 'Read the handbook');
    const oneOnOnes = taskBy(tasks, 'Set up 1:1s');
    const email = taskBy(tasks, 'Create email account');

    expect((await mgr.post(`/api/v1/onboarding/tasks/${handbook.id}/complete`).send({})).status).toBe(403);
    expect((await joiner.post(`/api/v1/onboarding/tasks/${oneOnOnes.id}/complete`).send({})).status).toBe(403);
    expect((await joiner.post(`/api/v1/onboarding/tasks/${email.id}/complete`).send({})).status).toBe(403);

    const done = await joiner.post(`/api/v1/onboarding/tasks/${handbook.id}/complete`).send({ note: 'Done' });
    expect(done.body.data).toMatchObject({ status: 'completed', note: 'Done' });
    expect((await mgr.post(`/api/v1/onboarding/tasks/${oneOnOnes.id}/complete`).send({})).status).toBe(200);
    expect((await hr.post(`/api/v1/onboarding/tasks/${email.id}/complete`).send({})).status).toBe(200);
    expect((await hr.post(`/api/v1/onboarding/tasks/${email.id}/complete`).send({})).status).toBe(409);
  });

  it('requires the document before completing a document task; rejection reopens the requirement', async () => {
    const { hr, joiner, employee, started } = await setup();
    const idTask = taskBy(started.body.data, 'Upload identity proof');
    expect((await joiner.post(`/api/v1/onboarding/tasks/${idTask.id}/complete`).send({})).status).toBe(409);

    const doc = await joiner
      .post('/api/v1/documents')
      .field('employeeId', String(employee._id))
      .field('category', 'identity')
      .field('onboardingTaskId', idTask.id)
      .attach('file', PDF, { filename: 'pan.pdf', contentType: 'application/pdf' });
    expect(doc.status).toBe(201);
    expect((await OnboardingTask.findById(idTask.id)).document).toBeTruthy();

    await hr.post(`/api/v1/documents/${doc.body.data.id}/review`).send({ decision: 'rejected', reason: 'Blurry scan' });
    expect((await OnboardingTask.findById(idTask.id)).document).toBeNull();
    expect((await joiner.post(`/api/v1/onboarding/tasks/${idTask.id}/complete`).send({})).status).toBe(409);
  });

  it('shows each person their own queue and hides other employees’ checklists', async () => {
    const { mgr, joiner, employee } = await setup();
    const mine = await joiner.get('/api/v1/onboarding/my-tasks');
    expect(mine.body.data.every((t) => t.assigneeType === 'employee')).toBe(true);
    expect(mine.body.data).toHaveLength(2);
    const mgrQueue = await mgr.get('/api/v1/onboarding/my-tasks');
    expect(mgrQueue.body.data.map((t) => t.title)).toEqual(['Set up 1:1s']);
    expect(mgrQueue.body.data[0].employee.fullName).toBe(employee.fullName);

    const { client: stranger } = await signedInAsEmployee(['employee']);
    expect((await stranger.get(`/api/v1/onboarding/employees/${employee._id}/tasks`)).status).toBe(404);
    expect((await mgr.get(`/api/v1/onboarding/employees/${employee._id}/tasks`)).status).toBe(200);
  });

  it('reports progress on the HR overview, with waivers counted', async () => {
    const { hr, employee, started } = await setup();
    await hr.post(`/api/v1/onboarding/tasks/${taskBy(started.body.data, 'Create email account').id}/waive`).send({ note: 'Has account' });
    const overview = await hr.get('/api/v1/onboarding/overview');
    const row = overview.body.data.find((r) => r.employee.id === String(employee._id));
    expect(row).toMatchObject({ total: 4, waived: 1, open: 3, progress: 25 });
    expect(row.overdue).toBeGreaterThan(0);
  });

  it('only starts offboarding for employees serving notice', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const t = (await hr.post('/api/v1/onboarding/templates').send({ name: 'Exit', kind: 'offboarding', tasks: [{ title: 'Return laptop', assigneeType: 'employee', dueOffsetDays: 0 }] })).body.data;
    const active = await createEmployeeRecord();
    expect((await hr.post(`/api/v1/onboarding/employees/${active._id}/start`).send({ templateId: t.id })).status).toBe(409);
    const leaving = await createEmployeeRecord({ lifecycleStatus: 'notice_period', exit: { lastWorkingDate: new Date('2025-09-30Z') } });
    const res = await hr.post(`/api/v1/onboarding/employees/${leaving._id}/start`).send({ templateId: t.id });
    expect(res.status).toBe(201);
    expect(res.body.data[0].dueDate).toBe('2025-09-30');
  });
});
