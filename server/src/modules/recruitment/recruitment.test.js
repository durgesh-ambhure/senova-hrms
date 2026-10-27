import { describe, expect, it } from 'vitest';
import { getOrg, signedInAs, signedInAsEmployee } from '../../../test/helpers.js';
import { canMove, manualTargets, summarizeFeedback } from './recruitment.rules.js';
import { Application, Candidate, Interview } from './recruitment.models.js';
import { Employee } from '../employees/employee.model.js';
import { rupeesToPaise } from '../../shared/money.js';
import { sniffMimeType } from '../../shared/middleware/upload.js';
import { addDays, todayIn } from '../../shared/dates.js';

const future = (days) => addDays(todayIn('Asia/Kolkata'), days);
const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
let seq = 0;
const uniq = () => `${Date.now()}${++seq}`;

describe('recruitment rules (unit)', () => {
  it('allows only defined pipeline moves, and reserves offer/hired for the offer workflow', () => {
    expect(canMove('applied', 'screening')).toBe(true);
    expect(canMove('applied', 'selected')).toBe(false);
    expect(canMove('selected', 'offer')).toBe(false);
    expect(canMove('selected', 'offer', { system: true })).toBe(true);
    expect(canMove('offer', 'hired', { system: true })).toBe(true);
    expect(canMove('hired', 'rejected', { system: true })).toBe(false);
    expect(canMove('rejected', 'screening')).toBe(true);
    expect(manualTargets('offer')).toEqual(['rejected', 'withdrawn']);
  });

  it('summarizes feedback', () => {
    expect(summarizeFeedback([{ rating: 4, recommendation: 'yes' }, { rating: 5, recommendation: 'strong_yes' }, { rating: 4, recommendation: 'yes' }])).toEqual({
      count: 3,
      averageRating: 4.3,
      recommendations: { yes: 2, strong_yes: 1 },
    });
  });

  it('converts rupees to paise exactly', () => {
    expect(rupeesToPaise('1250000')).toBe(125000000);
    expect(rupeesToPaise('0.1')).toBe(10);
    expect(rupeesToPaise(1234567.89)).toBe(123456789);
    expect(rupeesToPaise('12.345')).toBeNull();
    expect(rupeesToPaise('-5')).toBeNull();
  });

  it('recognizes real DOCX files only when allowed', () => {
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....[Content_Types].xml....word/document.xml....')]);
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('payload.exe')]);
    expect(sniffMimeType(docx, { allowDocx: true })).toMatch(/wordprocessingml/);
    expect(sniffMimeType(docx)).toBeNull();
    expect(sniffMimeType(zip, { allowDocx: true })).toBeNull();
  });
});

/** Recruiter, HR approver, a hiring manager with a job, and a candidate who applied. */
async function setup({ openings = 1 } = {}) {
  const { client: recruiter } = await signedInAs(['recruiter']);
  const { client: hr } = await signedInAs(['hr_admin']);
  const { client: mgr, user: mgrUser, employee: manager } = await signedInAsEmployee(['manager']);
  const { department, designation } = await getOrg();
  const job = (await recruiter.post('/api/v1/recruitment/jobs').send({ title: 'Backend Engineer', departmentId: String(department._id), designationId: String(designation._id), employmentType: 'full_time', openings, hiringManagerId: String(manager._id), status: 'open', requiredSkills: ['Node.js', 'node.js', 'MongoDB'] })).body.data;
  const n = uniq();
  const candidate = (await recruiter.post('/api/v1/recruitment/candidates').send({ firstName: 'Asha', lastName: `Verma${n}`, email: `asha.${n}@mail.test`, phone: `+91 98${String(n).slice(-8)}`, expectedCtc: '1800000', skills: ['Node.js'], jobId: job.id })).body.data;
  const application = (await recruiter.get(`/api/v1/recruitment/candidates/${candidate.id}/applications`)).body.data.items[0];
  return { recruiter, hr, mgr, mgrUser, manager, job, candidate, application, department, designation };
}

const move = (client, app, to, extra = {}) => client.post(`/api/v1/recruitment/applications/${app.id}/move`).send({ to, ...extra });

describe('jobs', () => {
  it('creates jobs with sequential codes and deduplicated skills, and enforces status changes', async () => {
    const { recruiter, job } = await setup();
    expect(job).toMatchObject({ status: 'open', requiredSkills: ['node.js', 'MongoDB'] });
    expect(job.code).toMatch(/^REQ-\d{4}$/);
    expect(job.openedOn).toBe(todayIn('Asia/Kolkata'));
    expect((await recruiter.patch(`/api/v1/recruitment/jobs/${job.id}`).send({ status: 'draft' })).status).toBe(409);
    const held = await recruiter.patch(`/api/v1/recruitment/jobs/${job.id}`).send({ status: 'on_hold' });
    expect(held.body.data).toMatchObject({ status: 'on_hold', openings: 1, requiredSkills: ['node.js', 'MongoDB'] });
  });

  it('shows hiring managers only their own jobs and blocks employees', async () => {
    const { mgr, job } = await setup();
    await setup(); // someone else's job
    const list = await mgr.get('/api/v1/recruitment/jobs');
    expect(list.body.data.map((j) => j.id)).toEqual([job.id]);
    const { client: emp } = await signedInAs(['employee']);
    expect((await emp.get('/api/v1/recruitment/jobs')).status).toBe(403);
    expect((await mgr.post('/api/v1/recruitment/jobs').send({ title: 'X' })).status).toBe(403);
  });
});

describe('candidates', () => {
  it('blocks duplicate emails and asks to confirm duplicate phones', async () => {
    const { recruiter, candidate } = await setup();
    const full = (await recruiter.get(`/api/v1/recruitment/candidates/${candidate.id}`)).body.data;
    const sameEmail = await recruiter.post('/api/v1/recruitment/candidates').send({ firstName: 'Other', lastName: 'Person', email: full.email.toUpperCase(), allowPhoneDuplicate: true });
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.error.code).toBe('DUPLICATE_CANDIDATE');
    expect(sameEmail.body.error.details[0]).toMatchObject({ id: candidate.id, matchedOn: ['email'] });

    const phone = `0${full.phone.replace(/\D/g, '').slice(-10)}`;
    const samePhone = { firstName: 'Twin', lastName: 'Phone', email: `twin.${uniq()}@mail.test`, phone };
    expect((await recruiter.post('/api/v1/recruitment/candidates').send(samePhone)).body.error.details[0].matchedOn).toEqual(['phone']);
    expect((await recruiter.post('/api/v1/recruitment/candidates').send({ ...samePhone, allowPhoneDuplicate: true })).status).toBe(201);

    const check = await recruiter.get(`/api/v1/recruitment/candidates/duplicates?email=${encodeURIComponent(full.email)}`);
    expect(check.body.data).toHaveLength(1);
  });

  it('gives hiring managers a limited view without contact details or compensation', async () => {
    const { mgr, recruiter, candidate } = await setup();
    const limited = (await mgr.get(`/api/v1/recruitment/candidates/${candidate.id}`)).body.data;
    expect(limited).toMatchObject({ accessLevel: 'limited', fullName: candidate.fullName });
    for (const field of ['email', 'phone', 'expectedCtc', 'currentCtc', 'source']) expect(limited).not.toHaveProperty(field);
    expect((await mgr.get(`/api/v1/recruitment/candidates/${candidate.id}/activity`)).status).toBe(403);
    expect((await recruiter.get(`/api/v1/recruitment/candidates/${candidate.id}`)).body.data.expectedCtc).toBe(1800000);

    const { client: otherMgr } = await signedInAsEmployee(['manager']);
    expect((await otherMgr.get(`/api/v1/recruitment/candidates/${candidate.id}`)).status).toBe(404);
  });

  it('keeps fields on partial updates', async () => {
    const { recruiter, candidate } = await setup();
    const res = await recruiter.patch(`/api/v1/recruitment/candidates/${candidate.id}`).send({ currentTitle: 'Senior Engineer' });
    expect(res.body.data).toMatchObject({ currentTitle: 'Senior Engineer', skills: ['Node.js'], source: 'other', expectedCtc: 1800000 });
  });

  it('accepts PDF/DOCX resumes and lets involved interviewers download them', async () => {
    const { recruiter, mgr, candidate } = await setup();
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml word/document.xml')]);
    const up = await recruiter.post(`/api/v1/recruitment/candidates/${candidate.id}/files`).field('kind', 'resume').attach('file', docx, { filename: 'cv.docx', contentType: 'application/octet-stream' });
    expect(up.status).toBe(201);
    const file = up.body.data.files[0];
    expect(file.mimeType).toMatch(/wordprocessingml/);
    expect((await recruiter.post(`/api/v1/recruitment/candidates/${candidate.id}/files`).attach('file', Buffer.from('MZ binary'), 'cv.pdf')).status).toBe(422);
    expect((await mgr.get(`/api/v1/recruitment/candidates/${candidate.id}/files/${file.id}`)).status).toBe(200);
  });
});

describe('pipeline', () => {
  it('validates moves and requires a reason to reject', async () => {
    const { recruiter, mgr, application } = await setup();
    expect((await move(recruiter, application, 'selected')).status).toBe(409);
    expect((await move(recruiter, application, 'offer')).status).toBe(409);
    expect((await move(mgr, application, 'screening')).status).toBe(403);
    const screened = await move(recruiter, application, 'screening');
    expect(screened.body.data).toMatchObject({ stage: 'screening', allowedMoves: ['shortlisted', 'rejected', 'withdrawn'] });
    expect((await move(recruiter, application, 'rejected')).status).toBe(422);
    expect((await move(recruiter, application, 'rejected', { reason: 'Not enough backend depth' })).body.data.rejectionReason).toBe('Not enough backend depth');
    expect((await move(recruiter, application, 'screening', { note: 'Reconsidered' })).body.data.stage).toBe('screening');
  });

  it('does not let the same candidate apply twice to one job', async () => {
    const { recruiter, candidate, job } = await setup();
    expect((await recruiter.post('/api/v1/recruitment/applications').send({ candidateId: candidate.id, jobId: job.id })).status).toBe(409);
  });
});

async function toInterview(ctx) {
  await move(ctx.recruiter, ctx.application, 'screening');
  await move(ctx.recruiter, ctx.application, 'shortlisted');
}

describe('interviews', () => {
  it('schedules with permitted interviewers, auto-advances the stage, and blocks double booking', async () => {
    const ctx = await setup();
    const { user: employeeUser } = await signedInAs(['employee']);
    const body = { applicationId: ctx.application.id, title: 'Technical round', scheduledAt: inHours(48), durationMinutes: 60, interviewerIds: [String(ctx.mgrUser._id)] };
    expect((await ctx.recruiter.post('/api/v1/recruitment/interviews').send(body)).status).toBe(409); // not shortlisted yet
    await toInterview(ctx);
    expect((await ctx.recruiter.post('/api/v1/recruitment/interviews').send({ ...body, interviewerIds: [String(employeeUser._id)] })).status).toBe(422);
    const iv = await ctx.recruiter.post('/api/v1/recruitment/interviews').send(body);
    expect(iv.status).toBe(201);
    expect((await Application.findById(ctx.application.id)).stage).toBe('interview');

    const ctx2 = await setup();
    await toInterview(ctx2);
    const clash = await ctx2.recruiter.post('/api/v1/recruitment/interviews').send({ ...body, applicationId: ctx2.application.id, scheduledAt: new Date(new Date(body.scheduledAt).getTime() + 30 * 60_000).toISOString() });
    expect(clash.status).toBe(409);
    expect((await ctx.recruiter.post('/api/v1/recruitment/interviews').send({ ...body, scheduledAt: inHours(-1) })).status).toBe(422);
  });

  it('hides colleagues’ feedback until you submit yours, and only interviewers can submit', async () => {
    const ctx = await setup();
    await toInterview(ctx);
    const { client: peer, user: peerUser } = await signedInAsEmployee(['manager']);
    const iv = (await ctx.recruiter.post('/api/v1/recruitment/interviews').send({ applicationId: ctx.application.id, title: 'Panel', scheduledAt: inHours(24), interviewerIds: [String(ctx.mgrUser._id), String(peerUser._id)] })).body.data;
    const early = await ctx.mgr.post(`/api/v1/recruitment/interviews/${iv.id}/feedback`).send({ rating: 4, recommendation: 'yes' });
    expect(early.status).toBe(409);
    await Interview.updateOne({ _id: iv.id }, { scheduledAt: new Date(Date.now() - 3600_000) });

    expect((await ctx.mgr.post(`/api/v1/recruitment/interviews/${iv.id}/feedback`).send({ rating: 4, recommendation: 'yes', strengths: 'Clear thinking' })).status).toBe(200);
    const peerView = (await peer.get(`/api/v1/recruitment/interviews/${iv.id}`)).body.data;
    expect(peerView.feedback).toEqual([]);
    const afterOwn = (await peer.post(`/api/v1/recruitment/interviews/${iv.id}/feedback`).send({ rating: 2, recommendation: 'no', concerns: 'Weak on data modelling' })).body.data;
    expect(afterOwn.feedback).toHaveLength(2);
    expect(afterOwn).toMatchObject({ status: 'completed', feedbackSummary: { averageRating: 3, count: 2 } });

    const { client: outsider } = await signedInAs(['manager']);
    expect((await outsider.post(`/api/v1/recruitment/interviews/${iv.id}/feedback`).send({ rating: 5, recommendation: 'strong_yes' })).status).toBe(403);
    expect((await ctx.recruiter.get(`/api/v1/recruitment/interviews/${iv.id}`)).body.data.feedback).toHaveLength(2);
  });
});

async function toSelected(ctx) {
  await toInterview(ctx);
  await Application.updateOne({ _id: ctx.application.id }, { stage: 'interview' });
  await move(ctx.recruiter, ctx.application, 'selected');
}

const offerBody = (ctx, extra = {}) => ({
  departmentId: String(ctx.department._id),
  designationId: String(ctx.designation._id),
  employmentType: 'full_time',
  workLocation: 'Pune',
  proposedJoiningDate: future(30),
  probationMonths: 6,
  compensation: { annualCtc: '1800000', fixed: '1500000', variable: '300000' },
  ...extra,
});

async function acceptedOffer(ctx) {
  await toSelected(ctx);
  const offer = (await ctx.recruiter.post(`/api/v1/recruitment/applications/${ctx.application.id}/offers`).send(offerBody(ctx))).body.data;
  await ctx.recruiter.post(`/api/v1/recruitment/offers/${offer.id}/submit`).send({});
  await ctx.hr.post(`/api/v1/recruitment/offers/${offer.id}/approve`).send({});
  await ctx.recruiter.post(`/api/v1/recruitment/offers/${offer.id}/send`).send({});
  await ctx.recruiter.post(`/api/v1/recruitment/offers/${offer.id}/accept`).send({ note: 'Accepted by email' });
  return offer;
}

describe('offers', () => {
  it('runs prepare → approve (by someone else) → send → accept, moving the application to hired', async () => {
    const ctx = await setup();
    expect((await ctx.recruiter.post(`/api/v1/recruitment/applications/${ctx.application.id}/offers`).send(offerBody(ctx))).status).toBe(409); // not selected
    await toSelected(ctx);
    expect((await ctx.recruiter.post(`/api/v1/recruitment/applications/${ctx.application.id}/offers`).send(offerBody(ctx, { compensation: { annualCtc: '1000000', fixed: '900000', variable: '200000' } }))).status).toBe(422);

    const offer = (await ctx.recruiter.post(`/api/v1/recruitment/applications/${ctx.application.id}/offers`).send(offerBody(ctx))).body.data;
    expect(offer).toMatchObject({ status: 'draft', version: 1, compensation: { annualCtc: 1800000, fixed: 1500000, variable: 300000 } });
    expect((await Application.findById(ctx.application.id)).stage).toBe('offer');
    expect((await ctx.recruiter.post(`/api/v1/recruitment/applications/${ctx.application.id}/offers`).send(offerBody(ctx))).status).toBe(409);

    expect((await ctx.recruiter.post(`/api/v1/recruitment/offers/${offer.id}/send`).send({})).status).toBe(409);
    await ctx.recruiter.post(`/api/v1/recruitment/offers/${offer.id}/submit`).send({});
    expect((await ctx.recruiter.post(`/api/v1/recruitment/offers/${offer.id}/approve`).send({})).status).toBe(403);
    expect((await ctx.hr.post(`/api/v1/recruitment/offers/${offer.id}/reject`).send({})).status).toBe(422);
    expect((await ctx.hr.post(`/api/v1/recruitment/offers/${offer.id}/approve`).send({ note: 'Within band' })).body.data.approval.decidedByName).toBeTruthy();
    await ctx.recruiter.post(`/api/v1/recruitment/offers/${offer.id}/send`).send({});
    const accepted = await ctx.recruiter.post(`/api/v1/recruitment/offers/${offer.id}/accept`).send({ joiningDate: future(45) });
    expect(accepted.body.data).toMatchObject({ status: 'accepted', proposedJoiningDate: future(45) });
    expect((await Application.findById(ctx.application.id)).stage).toBe('hired');
  });

  it('a preparer who can also approve still cannot approve their own offer', async () => {
    const ctx = await setup();
    await toSelected(ctx);
    const offer = (await ctx.hr.post(`/api/v1/recruitment/applications/${ctx.application.id}/offers`).send(offerBody(ctx))).body.data;
    await ctx.hr.post(`/api/v1/recruitment/offers/${offer.id}/submit`).send({});
    expect((await ctx.hr.post(`/api/v1/recruitment/offers/${offer.id}/approve`).send({})).status).toBe(403);
  });

  it('returns a declined offer’s application to "selected" for a revised offer', async () => {
    const ctx = await setup();
    await toSelected(ctx);
    const v1 = (await ctx.recruiter.post(`/api/v1/recruitment/applications/${ctx.application.id}/offers`).send(offerBody(ctx))).body.data;
    await ctx.recruiter.post(`/api/v1/recruitment/offers/${v1.id}/submit`).send({});
    await ctx.hr.post(`/api/v1/recruitment/offers/${v1.id}/approve`).send({});
    await ctx.recruiter.post(`/api/v1/recruitment/offers/${v1.id}/send`).send({});
    await ctx.recruiter.post(`/api/v1/recruitment/offers/${v1.id}/decline`).send({ note: 'Counter-offer from employer' });
    expect((await Application.findById(ctx.application.id)).stage).toBe('selected');
    const v2 = await ctx.recruiter.post(`/api/v1/recruitment/applications/${ctx.application.id}/offers`).send(offerBody(ctx, { compensation: { annualCtc: '2000000' } }));
    expect(v2.body.data.version).toBe(2);
  });

  it('keeps offers away from interviewers and hiring managers', async () => {
    const ctx = await setup();
    expect((await ctx.mgr.get('/api/v1/recruitment/offers')).status).toBe(403);
  });
});

describe('candidate → employee conversion', () => {
  it('creates the employee from the accepted offer exactly once, keeping the candidate history', async () => {
    const ctx = await setup();
    await acceptedOffer(ctx);
    const { client: admin } = await signedInAs(['super_admin']);
    expect((await ctx.recruiter.post(`/api/v1/recruitment/applications/${ctx.application.id}/hire`).send({ workEmail: `new.${uniq()}@senova.test` })).status).toBe(403);

    const workEmail = `asha.${uniq()}@senova.test`;
    const hires = await Promise.all([1, 2, 3].map(() => admin.post(`/api/v1/recruitment/applications/${ctx.application.id}/hire`).send({ workEmail })));
    expect(hires.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const ok = hires.find((r) => r.status === 201).body.data;
    expect(ok).toMatchObject({ employeeCode: expect.stringMatching(/^SEN-\d{4}$/), jobFilled: true });

    const emp = await Employee.findById(ok.employeeId).lean();
    expect(emp).toMatchObject({ workEmail, firstName: 'Asha', lifecycleStatus: 'pre_joining', employmentType: 'full_time', workLocation: 'Pune' });
    expect(String(emp.reportingManager)).toBe(String(ctx.manager._id));
    expect(String(emp.sourceApplication)).toBe(ctx.application.id);
    expect(emp.probation.status).toBe('on_probation');
    expect(await Employee.countDocuments({ sourceApplication: ctx.application.id })).toBe(1);

    const cand = await Candidate.findById(ctx.candidate.id).lean();
    expect(String(cand.employee)).toBe(ok.employeeId);
    expect((await admin.get(`/api/v1/recruitment/jobs/${ctx.job.id}`)).body.data.status).toBe('filled');
    const activity = (await admin.get(`/api/v1/recruitment/candidates/${ctx.candidate.id}/activity`)).body.data;
    expect(activity[0].type).toBe('hire');
  });

  it('refuses conversion without an accepted offer', async () => {
    const ctx = await setup();
    const { client: admin } = await signedInAs(['super_admin']);
    expect((await admin.post(`/api/v1/recruitment/applications/${ctx.application.id}/hire`).send({ workEmail: `x.${uniq()}@senova.test` })).status).toBe(409);
  });
});
