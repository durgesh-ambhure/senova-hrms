import { describe, expect, it } from 'vitest';
import { signedInAs, signedInAsEmployee } from '../../../test/helpers.js';
import { addDays, parseDateOnly, todayIn, weekStartOf } from '../../shared/dates.js';

const thisWeek = () => weekStartOf(todayIn('Asia/Kolkata'));
const lastWeek = () => addDays(thisWeek(), -7);

let seq = 0;
async function setup() {
  const { client: hr } = await signedInAs(['hr_admin']);
  seq += 1;
  const project = (await hr.post('/api/v1/timesheets/projects').send({ name: `Apollo ${seq}`, code: `AP-${seq}${Date.now() % 1000}` })).body.data;
  const { client: mgr, employee: manager } = await signedInAsEmployee(['manager']);
  const { client: me, employee } = await signedInAsEmployee(['employee'], { reportingManager: manager._id, joiningDate: parseDateOnly('2020-01-06') });
  return { hr, mgr, me, employee, project };
}
const entry = (project, dayOffset, minutes, week = lastWeek()) => ({ date: addDays(week, dayOffset), projectId: project.id, task: 'Build', minutes });

describe('timesheets', () => {
  it('saves a draft, validates entries, submits, and locks', async () => {
    const { me, project } = await setup();
    const empty = await me.get(`/api/v1/timesheets/mine/${lastWeek()}`);
    expect(empty.body.data).toMatchObject({ id: null, status: 'draft', entries: [] });

    expect((await me.put(`/api/v1/timesheets/mine/${lastWeek()}`).send({ entries: [entry(project, 9, 60)] })).status).toBe(422);
    expect((await me.put(`/api/v1/timesheets/mine/${lastWeek()}`).send({ entries: [entry(project, 0, 900), entry(project, 0, 600)] })).status).toBe(422);
    expect((await me.put(`/api/v1/timesheets/mine/${addDays(lastWeek(), 1)}`).send({ entries: [] })).status).toBe(422);
    expect((await me.put(`/api/v1/timesheets/mine/${addDays(thisWeek(), 7)}`).send({ entries: [] })).status).toBe(422);

    const saved = await me.put(`/api/v1/timesheets/mine/${lastWeek()}`).send({ entries: [entry(project, 0, 480), entry(project, 1, 420)] });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ totalMinutes: 900, status: 'draft' });

    const submitted = await me.post(`/api/v1/timesheets/mine/${lastWeek()}/submit`);
    expect(submitted.body.data.status).toBe('submitted');
    expect((await me.put(`/api/v1/timesheets/mine/${lastWeek()}`).send({ entries: [] })).status).toBe(409);
    expect((await me.post(`/api/v1/timesheets/mine/${thisWeek()}/submit`)).status).toBe(409);
  });

  it('runs reject → edit → resubmit → approve, with comments and history', async () => {
    const { me, mgr, project } = await setup();
    await me.put(`/api/v1/timesheets/mine/${lastWeek()}`).send({ entries: [entry(project, 0, 480)] });
    const id = (await me.post(`/api/v1/timesheets/mine/${lastWeek()}/submit`)).body.data.id;

    expect((await mgr.post(`/api/v1/timesheets/${id}/decision`).send({ decision: 'rejected' })).status).toBe(422);
    const rejected = await mgr.post(`/api/v1/timesheets/${id}/decision`).send({ decision: 'rejected', comment: 'Split by task please' });
    expect(rejected.body.data).toMatchObject({ status: 'rejected', comment: 'Split by task please' });

    await me.put(`/api/v1/timesheets/mine/${lastWeek()}`).send({ entries: [entry(project, 0, 240), { ...entry(project, 0, 240), task: 'Review' }] });
    await me.post(`/api/v1/timesheets/mine/${lastWeek()}/submit`);
    const approved = await mgr.post(`/api/v1/timesheets/${id}/decision`).send({ decision: 'approved' });
    expect(approved.body.data.status).toBe('approved');
    expect(approved.body.data.history.map((h) => h.status)).toEqual(['submitted', 'rejected', 'submitted', 'approved']);
    expect((await me.put(`/api/v1/timesheets/mine/${lastWeek()}`).send({ entries: [] })).status).toBe(409);
  });

  it('keeps approvals within the team and never self-approves', async () => {
    const { me, project } = await setup();
    await me.put(`/api/v1/timesheets/mine/${lastWeek()}`).send({ entries: [entry(project, 0, 60)] });
    const id = (await me.post(`/api/v1/timesheets/mine/${lastWeek()}/submit`)).body.data.id;
    const { client: otherMgr } = await signedInAsEmployee(['manager']);
    expect((await otherMgr.post(`/api/v1/timesheets/${id}/decision`).send({ decision: 'approved' })).status).toBe(404);
    expect((await otherMgr.get(`/api/v1/timesheets/${id}`)).status).toBe(404);
    expect((await me.post(`/api/v1/timesheets/${id}/decision`).send({ decision: 'approved' })).status).toBe(403);
  });

  it('reports approved hours by employee and project within scope', async () => {
    const { me, mgr, employee, project } = await setup();
    await me.put(`/api/v1/timesheets/mine/${lastWeek()}`).send({ entries: [entry(project, 0, 300), entry(project, 2, 180)] });
    const id = (await me.post(`/api/v1/timesheets/mine/${lastWeek()}/submit`)).body.data.id;
    const range = `from=${lastWeek()}&to=${addDays(lastWeek(), 6)}`;
    expect((await mgr.get(`/api/v1/timesheets/report?${range}`)).body.data).toEqual([]);
    await mgr.post(`/api/v1/timesheets/${id}/decision`).send({ decision: 'approved' });
    const report = await mgr.get(`/api/v1/timesheets/report?${range}`);
    expect(report.body.data).toEqual([{ employee: expect.objectContaining({ id: String(employee._id) }), project: expect.objectContaining({ id: project.id }), minutes: 480 }]);
    const own = await me.get(`/api/v1/timesheets/report?${range}`);
    expect(own.body.data).toHaveLength(1);
  });

  it('only timesheet admins manage projects; archived projects cannot be logged', async () => {
    const { hr, me, project } = await setup();
    const { client: emp } = await signedInAs(['employee']);
    expect((await emp.post('/api/v1/timesheets/projects').send({ name: 'Side', code: 'SIDE' })).status).toBe(403);
    await hr.patch(`/api/v1/timesheets/projects/${project.id}`).send({ status: 'archived' });
    expect((await me.put(`/api/v1/timesheets/mine/${lastWeek()}`).send({ entries: [entry(project, 0, 60)] })).status).toBe(422);
  });
});
