import mongoose from 'mongoose';
import { Application, Candidate, Interview, JobOpening } from './recruitment.models.js';
import { canMove, manualTargets, summarizeFeedback } from './recruitment.rules.js';
import { candidateAccess, isRecruiter, isRecruitmentStaff, jobAccess, myHiringJobIds } from './recruitment.policy.js';
import { assertJobOpen } from './jobs.service.js';
import { logActivity } from './candidates.service.js';
import { User } from '../users/user.model.js';
import { Role } from '../roles/role.model.js';
import { resolvePermissions } from '../roles/role.service.js';
import { hasPermission } from '../roles/permissions.js';
import { getSettings } from '../company/company.service.js';
import { recordAudit } from '../audit/audit.service.js';
import { withTransaction } from '../../db/transaction.js';
import { badRequest, conflict, forbidden, notFound, validationError } from '../../shared/errors.js';
import { escapeRegex } from '../../shared/pagination.js';

const label = (s) => s.replace('_', ' ');

// Applications

function toPublicApplication(a, { level = 'full', interviews } = {}) {
  return {
    id: String(a._id),
    candidate: a.candidate?._id
      ? { id: String(a.candidate._id), fullName: a.candidate.fullName, currentTitle: a.candidate.currentTitle, currentCompany: a.candidate.currentCompany, experienceYears: a.candidate.experienceYears }
      : { id: String(a.candidate) },
    job: a.job?._id ? { id: String(a.job._id), code: a.job.code, title: a.job.title } : { id: String(a.job) },
    stage: a.stage,
    stageChangedAt: a.stageChangedAt,
    allowedMoves: level === 'full' ? manualTargets(a.stage) : [],
    ...(level === 'full' ? { stageHistory: a.stageHistory, rejectionReason: a.rejectionReason } : {}),
    ...(interviews ? { interviews } : {}),
    employee: a.employee ? String(a.employee) : null,
    createdAt: a.createdAt,
  };
}

export async function createApplication(req, { candidateId, jobId, source }) {
  const candidate = await Candidate.findById(candidateId, { fullName: 1, source: 1, doNotContact: 1, employee: 1 }).lean();
  if (!candidate) throw validationError([{ path: 'candidateId', message: 'Candidate not found' }]);
  if (candidate.employee) throw conflict(`${candidate.fullName} has already been hired`);
  const app = await withTransaction(async (session) => {
    const job = await assertJobOpen(jobId, session);
    if (await Application.exists({ candidate: candidateId, job: jobId }).session(session)) throw conflict(`${candidate.fullName} has already applied to ${job.code}`);
    const [a] = await Application.create(
      [{ candidate: candidateId, job: jobId, source: source ?? candidate.source, createdBy: req.auth.user._id, stageHistory: [{ from: null, to: 'applied', at: new Date(), byName: req.auth.user.name }] }],
      { session },
    );
    await logActivity(req, { candidate: candidateId, application: a._id, type: 'stage', body: `Applied to ${job.code} ${job.title}` }, session);
    return a;
  });
  return getApplication(req, app._id);
}

export async function listApplications(req, { job, stage, search, page, limit }) {
  const filter = {};
  let level = 'full';
  if (!isRecruiter(req)) {
    const mine = await myHiringJobIds(req);
    if (!mine.length) return { items: [], meta: { page, limit, total: 0, totalPages: 1 } };
    level = 'limited';
    filter.job = { $in: mine.map((id) => new mongoose.Types.ObjectId(id)) };
  }
  if (job) {
    if (filter.job && !filter.job.$in.some((id) => String(id) === job)) throw notFound('Job opening not found');
    filter.job = job;
  }
  if (stage) filter.stage = stage;
  if (search) filter.candidate = { $in: await Candidate.distinct('_id', { fullName: { $regex: escapeRegex(search), $options: 'i' } }) };
  const [items, total] = await Promise.all([
    Application.find(filter).sort({ stageChangedAt: -1 }).skip((page - 1) * limit).limit(limit).populate('candidate', 'fullName currentTitle currentCompany experienceYears').populate('job', 'code title').lean(),
    Application.countDocuments(filter),
  ]);
  const ivs = await Interview.aggregate([
    { $match: { application: { $in: items.map((a) => a._id) }, status: { $ne: 'cancelled' } } },
    { $group: { _id: '$application', count: { $sum: 1 }, next: { $min: { $cond: [{ $eq: ['$status', 'scheduled'] }, '$scheduledAt', null] } } } },
  ]);
  const ivBy = new Map(ivs.map((i) => [String(i._id), { count: i.count, next: i.next }]));
  return { items: items.map((a) => toPublicApplication(a, { level, interviews: ivBy.get(String(a._id)) ?? { count: 0, next: null } })), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function getApplication(req, id) {
  const a = await Application.findById(id).populate('candidate', 'fullName currentTitle currentCompany experienceYears').populate('job', 'code title hiringManager').lean();
  if (!a) throw notFound('Application not found');
  const level = await candidateAccess(req, a.candidate._id);
  if (!level) throw notFound('Application not found');
  return toPublicApplication(a, { level });
}

/**
 * Moves an application along the pipeline. `system` moves come from the offer workflow and may
 * reach "offer"/"hired"; manual moves are limited to TRANSITIONS minus those.
 */
export async function moveStage(req, id, { to, note = '', reason = '' }, { session, system = false } = {}) {
  const run = async (s) => {
    const a = await Application.findById(id).session(s);
    if (!a) throw notFound('Application not found');
    if (!canMove(a.stage, to, { system })) throw conflict(`Cannot move from ${label(a.stage)} to ${label(to)}`);
    if (to === 'rejected' && reason.trim().length < 3) throw validationError([{ path: 'reason', message: 'Give a reason for rejecting' }]);
    const from = a.stage;
    a.stage = to;
    a.stageChangedAt = new Date();
    a.rejectionReason = to === 'rejected' ? reason : from === 'rejected' ? '' : a.rejectionReason;
    a.stageHistory.push({ from, to, at: new Date(), byName: req.auth.user.name, note: note || reason });
    await a.save({ session: s });
    const job = await JobOpening.findById(a.job, { code: 1 }).session(s).lean();
    await logActivity(req, { candidate: a.candidate, application: a._id, type: 'stage', body: `${job.code}: ${label(from)} → ${label(to)}${reason ? ` (${reason})` : note ? ` — ${note}` : ''}` }, s);
    await recordAudit(req, { action: 'application.stage_changed', entityType: 'Candidate', entityId: a.candidate, summary: `${job.code}: ${from} → ${to}` }, s);
    return a;
  };
  const a = await withTransaction(run, { session });
  return session ? a : getApplication(req, a._id);
}

// Interviews

function toPublicInterview(i, req, { seeAllFeedback }) {
  const me = String(req.auth.user._id);
  const mine = i.feedback.find((f) => String(f.interviewer) === me) ?? null;
  // Interviewers see colleagues' feedback only after submitting their own, to avoid anchoring.
  const visible = seeAllFeedback || mine ? i.feedback : [];
  return {
    id: String(i._id),
    application: String(i.application),
    candidate: i.candidate?._id ? { id: String(i.candidate._id), fullName: i.candidate.fullName, currentTitle: i.candidate.currentTitle } : { id: String(i.candidate) },
    job: i.job?._id ? { id: String(i.job._id), code: i.job.code, title: i.job.title } : { id: String(i.job) },
    title: i.title,
    mode: i.mode,
    scheduledAt: i.scheduledAt,
    durationMinutes: i.durationMinutes,
    timezone: i.timezone,
    location: i.location,
    interviewers: i.interviewers.map((u) => (u?._id ? { id: String(u._id), name: u.name } : { id: String(u) })),
    status: i.status,
    cancelReason: i.cancelReason,
    isInterviewer: i.interviewers.some((u) => String(u._id ?? u) === me),
    myFeedback: mine,
    feedback: visible.map((f) => ({ interviewerName: f.interviewerName, rating: f.rating, recommendation: f.recommendation, strengths: f.strengths, concerns: f.concerns, notes: f.notes, submittedAt: f.submittedAt })),
    feedbackSummary: summarizeFeedback(visible),
    feedbackPending: i.interviewers.length - i.feedback.length,
  };
}

const IV_POPULATE = [
  { path: 'candidate', select: 'fullName currentTitle' },
  { path: 'job', select: 'code title hiringManager' },
  { path: 'interviewers', select: 'name' },
];

async function seesAllFeedback(req, interview) {
  if (isRecruiter(req) || hasPermission(req.auth.permissions, 'recruitment:interviews:manage')) return true;
  return (await myHiringJobIds(req)).includes(String(interview.job._id ?? interview.job));
}

async function assertInterviewers(ids) {
  const users = await User.find({ _id: { $in: ids }, status: 'active' }).lean();
  if (users.length !== new Set(ids).size) throw validationError([{ path: 'interviewerIds', message: 'Interviewers must be active users' }]);
  for (const u of users) {
    if (!hasPermission(await resolvePermissions(u.roles), 'recruitment:interviews:feedback')) {
      throw validationError([{ path: 'interviewerIds', message: `${u.name} cannot give interview feedback (role lacks permission)` }]);
    }
  }
  return users;
}

/** Rejects a slot that overlaps another scheduled interview of any of the interviewers. */
async function assertNoDoubleBooking(users, start, minutes, exceptId) {
  const end = new Date(start.getTime() + minutes * 60_000);
  const clashes = await Interview.find({
    _id: { $ne: exceptId },
    status: 'scheduled',
    interviewers: { $in: users.map((u) => u._id) },
    scheduledAt: { $lt: end, $gte: new Date(start.getTime() - 8 * 3600_000) },
  }).lean();
  for (const c of clashes) {
    const cEnd = new Date(c.scheduledAt.getTime() + c.durationMinutes * 60_000);
    if (cEnd > start) {
      const who = users.find((u) => c.interviewers.some((x) => String(x) === String(u._id)));
      throw conflict(`${who.name} already has an interview at that time`);
    }
  }
}

export async function scheduleInterview(req, { applicationId, interviewerIds, scheduledAt, timezone, ...input }) {
  const start = new Date(scheduledAt);
  if (start <= new Date()) throw validationError([{ path: 'scheduledAt', message: 'Choose a time in the future' }]);
  const users = await assertInterviewers(interviewerIds);
  await assertNoDoubleBooking(users, start, input.durationMinutes);
  const tz = timezone ?? (await getSettings()).timezone;
  const iv = await withTransaction(async (session) => {
    const app = await Application.findById(applicationId).session(session);
    if (!app) throw notFound('Application not found');
    if (!['shortlisted', 'interview'].includes(app.stage)) throw conflict(`Shortlist the candidate before scheduling interviews (currently ${label(app.stage)})`);
    if (app.stage === 'shortlisted') await moveStage(req, app._id, { to: 'interview', note: 'Interview scheduled' }, { session });
    const [i] = await Interview.create(
      [{ ...input, application: app._id, candidate: app.candidate, job: app.job, scheduledAt: start, timezone: tz, interviewers: users.map((u) => u._id), scheduledBy: req.auth.user._id }],
      { session },
    );
    await logActivity(req, { candidate: app.candidate, application: app._id, type: 'interview', body: `Scheduled "${i.title}" with ${users.map((u) => u.name).join(', ')} at ${start.toISOString()}` }, session);
    return i;
  });
  return getInterview(req, iv._id);
}

export async function updateInterview(req, id, { interviewerIds, scheduledAt, status, cancelReason, ...input }) {
  const i = await Interview.findById(id);
  if (!i) throw notFound('Interview not found');
  if (i.status !== 'scheduled') throw conflict(`This interview is ${label(i.status)}`);
  if (status === 'cancelled' && !cancelReason) throw validationError([{ path: 'cancelReason', message: 'Give a reason for cancelling' }]);
  const start = scheduledAt ? new Date(scheduledAt) : i.scheduledAt;
  if (scheduledAt && start <= new Date()) throw validationError([{ path: 'scheduledAt', message: 'Choose a time in the future' }]);
  if (interviewerIds || scheduledAt || input.durationMinutes) {
    const users = interviewerIds ? await assertInterviewers(interviewerIds) : await User.find({ _id: { $in: i.interviewers } }).lean();
    if (status !== 'cancelled') await assertNoDoubleBooking(users, start, input.durationMinutes ?? i.durationMinutes, i._id);
    if (interviewerIds) i.interviewers = users.map((u) => u._id);
  }
  Object.assign(i, input, { scheduledAt: start });
  if (status) {
    if (status === 'completed' && start > new Date()) throw badRequest('An interview cannot be completed before it starts');
    i.status = status;
    i.cancelReason = cancelReason ?? '';
  }
  await i.save();
  await logActivity(req, { candidate: i.candidate, application: i.application, type: 'interview', body: status ? `Interview "${i.title}" marked ${label(status)}${cancelReason ? `: ${cancelReason}` : ''}` : `Interview "${i.title}" updated` });
  return getInterview(req, i._id);
}

export async function getInterview(req, id) {
  const i = await Interview.findById(id).populate(IV_POPULATE).lean();
  if (!i) throw notFound('Interview not found');
  const isInterviewer = i.interviewers.some((u) => String(u._id) === String(req.auth.user._id));
  if (!isInterviewer && !isRecruitmentStaff(req) && !(await jobAccess(req, i.job))) throw notFound('Interview not found');
  return toPublicInterview(i, req, { seeAllFeedback: await seesAllFeedback(req, i) });
}

export async function listInterviews(req, { scope, application, candidate, from, to }) {
  const filter = {};
  if (scope === 'mine') filter.interviewers = req.auth.user._id;
  else if (!isRecruitmentStaff(req)) {
    const jobs = await myHiringJobIds(req);
    filter.$or = [{ interviewers: req.auth.user._id }, { job: { $in: jobs.map((j) => new mongoose.Types.ObjectId(j)) } }];
  }
  if (application) filter.application = application;
  if (candidate) filter.candidate = candidate;
  if (from || to) filter.scheduledAt = { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(to) } : {}) };
  const items = await Interview.find(filter).sort({ scheduledAt: scope === 'mine' ? 1 : -1 }).limit(200).populate(IV_POPULATE).lean();
  const out = [];
  for (const i of items) out.push(toPublicInterview(i, req, { seeAllFeedback: await seesAllFeedback(req, i) }));
  return out;
}

export async function submitFeedback(req, id, input) {
  const i = await Interview.findById(id);
  if (!i) throw notFound('Interview not found');
  if (!i.interviewers.some((u) => String(u) === String(req.auth.user._id))) throw forbidden('Only assigned interviewers can give feedback');
  if (['cancelled', 'no_show'].includes(i.status)) throw conflict(`This interview was ${label(i.status)}`);
  if (i.scheduledAt > new Date()) throw conflict('Feedback opens once the interview has started');
  const entry = { ...input, interviewer: req.auth.user._id, interviewerName: req.auth.user.name, submittedAt: new Date() };
  const existing = i.feedback.findIndex((f) => String(f.interviewer) === String(req.auth.user._id));
  if (existing >= 0) i.feedback[existing] = entry;
  else i.feedback.push(entry);
  if (i.feedback.length === i.interviewers.length) i.status = 'completed';
  await i.save();
  await logActivity(req, { candidate: i.candidate, application: i.application, type: 'feedback', body: `${req.auth.user.name} rated "${i.title}" ${input.rating}/5 (${label(input.recommendation)})` });
  return getInterview(req, i._id);
}

/** Active users who may give interview feedback — the only valid interviewers. */
export async function listEligibleInterviewers({ search }) {
  const roles = await Role.find({ permissions: { $in: ['*', 'recruitment:interviews:feedback'] } }, { key: 1 }).lean();
  const filter = { status: 'active', roles: { $in: roles.map((r) => r.key) } };
  if (search) filter.$or = [{ name: { $regex: escapeRegex(search), $options: 'i' } }, { email: { $regex: escapeRegex(search), $options: 'i' } }];
  const users = await User.find(filter, { name: 1, email: 1 }).sort({ name: 1 }).limit(50).lean();
  return users.map((u) => ({ id: String(u._id), name: u.name, email: u.email }));
}
