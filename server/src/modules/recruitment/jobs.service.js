import mongoose from 'mongoose';
import { Application, JobOpening } from './recruitment.models.js';
import { ACTIVE_STAGES, STAGES } from './recruitment.rules.js';
import { isRecruitmentStaff, jobAccess, myHiringJobIds } from './recruitment.policy.js';
import { Department } from '../organization/department.model.js';
import { Designation } from '../organization/designation.model.js';
import { Employee } from '../employees/employee.model.js';
import { getSettings } from '../company/company.service.js';
import { diffFields, recordAudit } from '../audit/audit.service.js';
import { nextSequence } from '../../db/counter.model.js';
import { conflict, notFound, validationError } from '../../shared/errors.js';
import { escapeRegex } from '../../shared/pagination.js';
import { parseDateOnly, toDateOnly, todayIn } from '../../shared/dates.js';

const POPULATE = [
  { path: 'department', select: 'name' },
  { path: 'designation', select: 'title' },
  { path: 'hiringManager', select: 'fullName employeeCode' },
];

/** Allowed job status changes. */
export const JOB_TRANSITIONS = {
  draft: ['open', 'closed'],
  open: ['on_hold', 'closed', 'filled'],
  on_hold: ['open', 'closed'],
  closed: ['open'],
  filled: ['open', 'closed'],
};

export function toPublicJob(j, pipeline) {
  return {
    id: String(j._id),
    code: j.code,
    title: j.title,
    department: j.department?._id ? { id: String(j.department._id), name: j.department.name } : null,
    designation: j.designation?._id ? { id: String(j.designation._id), title: j.designation.title } : null,
    description: j.description,
    requiredSkills: j.requiredSkills,
    employmentType: j.employmentType,
    workLocation: j.workLocation,
    openings: j.openings,
    hiringManager: j.hiringManager?._id ? { id: String(j.hiringManager._id), fullName: j.hiringManager.fullName } : null,
    status: j.status,
    openedOn: toDateOnly(j.openedOn),
    closesOn: toDateOnly(j.closesOn),
    ...(pipeline ? { pipeline } : {}),
    createdAt: j.createdAt,
  };
}

/** Counts of applications per stage for each job. */
async function pipelineCounts(jobIds) {
  const rows = await Application.aggregate([{ $match: { job: { $in: jobIds } } }, { $group: { _id: { job: '$job', stage: '$stage' }, count: { $sum: 1 } } }]);
  const out = new Map(jobIds.map((id) => [String(id), Object.fromEntries(STAGES.map((s) => [s, 0]))]));
  for (const r of rows) out.get(String(r._id.job))[r._id.stage] = r.count;
  for (const counts of out.values()) counts.active = ACTIVE_STAGES.reduce((s, st) => s + counts[st], 0);
  return out;
}

export async function listJobs(req, { status, department, search, page, limit }) {
  const filter = {};
  if (!isRecruitmentStaff(req)) {
    const ids = await myHiringJobIds(req);
    if (!ids.length) return { items: [], meta: { page, limit, total: 0, totalPages: 1 } };
    filter._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };
  }
  if (status) filter.status = status;
  if (department) filter.department = department;
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ title: rx }, { code: rx }, { requiredSkills: rx }];
  }
  const [items, total] = await Promise.all([
    JobOpening.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate(POPULATE).lean(),
    JobOpening.countDocuments(filter),
  ]);
  const counts = await pipelineCounts(items.map((j) => j._id));
  return { items: items.map((j) => toPublicJob(j, counts.get(String(j._id)))), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function getJob(req, id) {
  const job = await JobOpening.findById(id).populate(POPULATE).lean();
  if (!job || !(await jobAccess(req, job))) throw notFound('Job opening not found');
  const counts = await pipelineCounts([job._id]);
  return toPublicJob(job, counts.get(String(job._id)));
}

async function resolveRefs({ departmentId, designationId, hiringManagerId }) {
  const refs = {};
  if (departmentId !== undefined) {
    refs.department = (await Department.findOne({ _id: departmentId, status: 'active' }, { _id: 1 }).lean())?._id;
    if (!refs.department) throw validationError([{ path: 'departmentId', message: 'Choose an active department' }]);
  }
  if (designationId !== undefined) {
    refs.designation = null;
    if (designationId) {
      refs.designation = (await Designation.findOne({ _id: designationId, status: 'active' }, { _id: 1 }).lean())?._id;
      if (!refs.designation) throw validationError([{ path: 'designationId', message: 'Choose an active designation' }]);
    }
  }
  if (hiringManagerId !== undefined) {
    refs.hiringManager = null;
    if (hiringManagerId) {
      refs.hiringManager = (await Employee.findOne({ _id: hiringManagerId, archivedAt: null, lifecycleStatus: { $in: ['active', 'notice_period'] } }, { _id: 1 }).lean())?._id;
      if (!refs.hiringManager) throw validationError([{ path: 'hiringManagerId', message: 'Hiring manager must be a current employee' }]);
    }
  }
  return refs;
}

export async function createJob(req, { departmentId, designationId, hiringManagerId, closesOn, status, ...input }) {
  const refs = await resolveRefs({ departmentId, designationId: designationId ?? null, hiringManagerId: hiringManagerId ?? null });
  const today = todayIn((await getSettings()).timezone);
  const seq = await nextSequence('jobCode');
  const job = await JobOpening.create({
    ...input,
    ...refs,
    code: `REQ-${String(seq).padStart(4, '0')}`,
    status,
    openedOn: status === 'open' ? parseDateOnly(today) : null,
    closesOn: closesOn ? parseDateOnly(closesOn) : null,
    createdBy: req.auth.user._id,
    updatedBy: req.auth.user._id,
  });
  await recordAudit(req, { action: 'job.created', entityType: 'JobOpening', entityId: job._id, summary: `Created job ${job.code} ${job.title} (${status})` });
  return getJob(req, job._id);
}

const FIELDS = ['title', 'department', 'designation', 'description', 'requiredSkills', 'employmentType', 'workLocation', 'openings', 'hiringManager', 'status', 'closesOn'];

export async function updateJob(req, id, { departmentId, designationId, hiringManagerId, closesOn, status, ...input }) {
  const job = await JobOpening.findById(id);
  if (!job) throw notFound('Job opening not found');
  const before = job.toObject();
  Object.assign(job, input, await resolveRefs({ departmentId, designationId, hiringManagerId }), { updatedBy: req.auth.user._id });
  if (closesOn !== undefined) job.closesOn = closesOn ? parseDateOnly(closesOn) : null;
  if (status && status !== job.status) {
    if (!JOB_TRANSITIONS[job.status].includes(status)) throw conflict(`A ${job.status.replace('_', ' ')} job cannot be changed to ${status.replace('_', ' ')}`);
    job.status = status;
    if (status === 'open' && !job.openedOn) job.openedOn = parseDateOnly(todayIn((await getSettings()).timezone));
  }
  await job.save();
  await recordAudit(req, { action: 'job.updated', entityType: 'JobOpening', entityId: job._id, summary: `Updated job ${job.code}`, changes: diffFields(before, job.toObject(), FIELDS) });
  return getJob(req, job._id);
}

export async function assertJobOpen(jobId, session) {
  const job = await JobOpening.findById(jobId).session(session ?? null);
  if (!job) throw validationError([{ path: 'jobId', message: 'Job opening not found' }]);
  if (job.status !== 'open') throw conflict(`${job.code} is ${job.status.replace('_', ' ')}, not accepting applications`);
  return job;
}

