import crypto from 'node:crypto';
import { Application, Candidate, CandidateActivity, CandidateFile, Interview, JobOffer } from './recruitment.models.js';
import { candidateAccess, canSeeCompensation } from './recruitment.policy.js';
import { assertJobOpen } from './jobs.service.js';
import { Employee } from '../employees/employee.model.js';
import { recordAudit } from '../audit/audit.service.js';
import { withTransaction } from '../../db/transaction.js';
import { AppError, notFound, validationError } from '../../shared/errors.js';
import { escapeRegex } from '../../shared/pagination.js';
import { storage } from '../../shared/storage.js';
import { paiseToRupees } from '../../shared/money.js';

export async function logActivity(req, { candidate, application = null, type, body }, session) {
  await CandidateActivity.create([{ candidate, application, type, body, actor: req.auth.user._id, actorName: req.auth.user.name }], { session });
}

/**
 * Shapes a candidate for the API. Limited viewers (interviewers, hiring managers) never receive
 * contact details, referral info or compensation; compensation also needs an offer permission.
 */
export function toPublicCandidate(c, { level, compensation }) {
  const base = {
    id: String(c._id),
    firstName: c.firstName,
    lastName: c.lastName,
    fullName: c.fullName,
    location: c.location,
    currentCompany: c.currentCompany,
    currentTitle: c.currentTitle,
    experienceYears: c.experienceYears,
    skills: c.skills,
    noticePeriodDays: c.noticePeriodDays,
    employee: c.employee ? String(c.employee) : null,
    accessLevel: level,
  };
  if (level !== 'full') return base;
  return {
    ...base,
    email: c.email,
    phone: c.phone,
    linkedInUrl: c.linkedInUrl,
    source: c.source,
    referredBy: c.referredBy?._id ? { id: String(c.referredBy._id), fullName: c.referredBy.fullName } : null,
    doNotContact: c.doNotContact,
    ...(compensation ? { currentCtc: paiseToRupees(c.currentCtcPaise), expectedCtc: paiseToRupees(c.expectedCtcPaise) } : {}),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

const phoneKeyOf = (phone) => {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : null;
};

/** Possible duplicates by exact email or by the last 10 phone digits. */
export async function findDuplicates({ email, phone, excludeId }) {
  const or = [];
  if (email) or.push({ email: email.trim().toLowerCase() });
  const key = phoneKeyOf(phone);
  if (key) or.push({ phoneKey: key });
  if (!or.length) return [];
  const matches = await Candidate.find({ $or: or, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }, { fullName: 1, email: 1, phone: 1, phoneKey: 1 }).limit(10).lean();
  return matches.map((m) => ({
    id: String(m._id),
    fullName: m.fullName,
    email: m.email,
    phone: m.phone,
    matchedOn: [email && m.email === email.trim().toLowerCase() && 'email', key && m.phoneKey === key && 'phone'].filter(Boolean),
  }));
}

function duplicateError(matches) {
  return new AppError(409, 'DUPLICATE_CANDIDATE', 'A candidate with the same email or phone already exists', matches);
}

const fromInput = ({ currentCtc, expectedCtc, referredById, ...rest }) => ({
  ...rest,
  ...(currentCtc !== undefined ? { currentCtcPaise: currentCtc } : {}),
  ...(expectedCtc !== undefined ? { expectedCtcPaise: expectedCtc } : {}),
  ...(referredById !== undefined ? { referredBy: referredById } : {}),
});

async function assertReferrer(referredById) {
  if (referredById && !(await Employee.exists({ _id: referredById, archivedAt: null }))) {
    throw validationError([{ path: 'referredById', message: 'Referrer must be an employee' }]);
  }
}

export async function createCandidate(req, { jobId, allowPhoneDuplicate, ...input }) {
  const matches = await findDuplicates(input);
  // Email duplicates are always blocked; a shared phone (e.g. agency switchboard) can be confirmed.
  if (matches.some((m) => m.matchedOn.includes('email')) || (matches.length && !allowPhoneDuplicate)) throw duplicateError(matches);
  await assertReferrer(input.referredById);
  const candidate = await withTransaction(async (session) => {
    const [c] = await Candidate.create([{ ...fromInput(input), createdBy: req.auth.user._id, updatedBy: req.auth.user._id }], { session });
    await logActivity(req, { candidate: c._id, type: 'system', body: `Candidate added (source: ${c.source.replace('_', ' ')})` }, session);
    if (jobId) {
      const job = await assertJobOpen(jobId, session);
      const [a] = await Application.create([{ candidate: c._id, job: job._id, source: c.source, createdBy: req.auth.user._id, stageHistory: [{ from: null, to: 'applied', at: new Date(), byName: req.auth.user.name }] }], { session });
      await logActivity(req, { candidate: c._id, application: a._id, type: 'stage', body: `Applied to ${job.code} ${job.title}` }, session);
    }
    await recordAudit(req, { action: 'candidate.created', entityType: 'Candidate', entityId: c._id, summary: `Added candidate ${c.fullName}` }, session);
    return c;
  });
  return getCandidate(req, candidate._id);
}

export async function updateCandidate(req, id, { allowPhoneDuplicate, ...input }) {
  const c = await Candidate.findById(id);
  if (!c) throw notFound('Candidate not found');
  if (input.email || input.phone) {
    const matches = await findDuplicates({ email: input.email, phone: input.phone, excludeId: c._id });
    if (matches.some((m) => m.matchedOn.includes('email')) || (matches.length && !allowPhoneDuplicate)) throw duplicateError(matches);
  }
  await assertReferrer(input.referredById);
  Object.assign(c, fromInput(input), { updatedBy: req.auth.user._id });
  const changed = c.modifiedPaths().filter((p) => !['updatedBy', 'fullName', 'phoneKey'].includes(p));
  await c.save();
  await recordAudit(req, { action: 'candidate.updated', entityType: 'Candidate', entityId: c._id, summary: `Updated candidate ${c.fullName}`, changes: { fields: changed } });
  return getCandidate(req, c._id);
}

export async function listCandidates(req, { search, skill, source, job, stage, page, limit }) {
  const filter = { archivedAt: null };
  if (source) filter.source = source;
  if (skill) filter.skills = { $regex: `^${escapeRegex(skill)}$`, $options: 'i' };
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ fullName: rx }, { email: rx }, { phone: rx }, { currentCompany: rx }, { skills: rx }];
  }
  if (job || stage) {
    const appFilter = {};
    if (job) appFilter.job = job;
    if (stage) appFilter.stage = stage;
    filter._id = { $in: await Application.distinct('candidate', appFilter) };
  }
  const [items, total] = await Promise.all([
    Candidate.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Candidate.countDocuments(filter),
  ]);
  const apps = await Application.find({ candidate: { $in: items.map((c) => c._id) } }, { candidate: 1, stage: 1, job: 1 }).populate('job', 'code title').lean();
  const compensation = canSeeCompensation(req);
  return {
    items: items.map((c) => ({
      ...toPublicCandidate(c, { level: 'full', compensation }),
      applications: apps.filter((a) => String(a.candidate) === String(c._id)).map((a) => ({ id: String(a._id), stage: a.stage, job: { id: String(a.job._id), code: a.job.code, title: a.job.title } })),
    })),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getCandidate(req, id) {
  const level = await candidateAccess(req, id);
  const c = level && (await Candidate.findById(id).populate('referredBy', 'fullName').lean());
  if (!c) throw notFound('Candidate not found');
  const files = await CandidateFile.find({ candidate: c._id, deletedAt: null }).sort({ createdAt: -1 }).lean();
  return {
    ...toPublicCandidate(c, { level, compensation: canSeeCompensation(req) }),
    files: files.map((f) => ({ id: String(f._id), kind: f.kind, fileName: f.fileName, mimeType: f.mimeType, size: f.size, uploadedByName: f.uploadedByName, createdAt: f.createdAt })),
  };
}

export async function listActivity(req, id) {
  if ((await candidateAccess(req, id)) !== 'full') throw notFound('Candidate not found');
  const items = await CandidateActivity.find({ candidate: id }).sort({ createdAt: -1 }).limit(200).lean();
  return items.map((a) => ({ id: String(a._id), type: a.type, body: a.body, actorName: a.actorName, application: a.application ? String(a.application) : null, createdAt: a.createdAt }));
}

export async function addNote(req, id, { body }) {
  if (!(await Candidate.exists({ _id: id }))) throw notFound('Candidate not found');
  await logActivity(req, { candidate: id, type: 'note', body });
  return listActivity(req, id);
}

// Files (resumes etc.)

export async function uploadFile(req, id, { kind }) {
  const c = await Candidate.findById(id, { fullName: 1 }).lean();
  if (!c) throw notFound('Candidate not found');
  const { buffer, detectedMimeType, safeName } = req.file;
  const storageKey = await storage.put(buffer, { prefix: `candidates/${id}` });
  try {
    await CandidateFile.create({
      candidate: id,
      kind,
      fileName: safeName,
      mimeType: detectedMimeType,
      size: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      storageKey,
      uploadedBy: req.auth.user._id,
      uploadedByName: req.auth.user.name,
    });
  } catch (err) {
    await storage.remove(storageKey);
    throw err;
  }
  await logActivity(req, { candidate: id, type: 'system', body: `Uploaded ${kind.replace('_', ' ')} ${safeName}` });
  return getCandidate(req, id);
}

export async function openFile(req, id, fileId) {
  if (!(await candidateAccess(req, id))) throw notFound('File not found');
  const f = await CandidateFile.findOne({ _id: fileId, candidate: id, deletedAt: null }).select('+storageKey').lean();
  if (!f) throw notFound('File not found');
  await recordAudit(req, { action: 'candidate.file_downloaded', entityType: 'Candidate', entityId: id, summary: `Downloaded ${f.fileName}` });
  return { file: f, stream: storage.createReadStream(f.storageKey) };
}

export async function deleteFile(req, id, fileId) {
  const f = await CandidateFile.findOneAndUpdate({ _id: fileId, candidate: id, deletedAt: null }, { deletedAt: new Date() });
  if (!f) throw notFound('File not found');
  await logActivity(req, { candidate: id, type: 'system', body: `Removed ${f.fileName}` });
}

/** Everything about a candidate's applications that the actor may see. */
export async function candidateApplications(req, id) {
  const level = await candidateAccess(req, id);
  if (!level) throw notFound('Candidate not found');
  const apps = await Application.find({ candidate: id }).sort({ createdAt: -1 }).populate('job', 'code title hiringManager status').lean();
  const [interviews, offers] = await Promise.all([
    Interview.countDocuments({ candidate: id }),
    canSeeCompensation(req) ? JobOffer.countDocuments({ candidate: id }) : 0,
  ]);
  return {
    items: apps.map((a) => ({
      id: String(a._id),
      job: { id: String(a.job._id), code: a.job.code, title: a.job.title, status: a.job.status },
      stage: a.stage,
      stageChangedAt: a.stageChangedAt,
      stageHistory: level === 'full' ? a.stageHistory : undefined,
      rejectionReason: level === 'full' ? a.rejectionReason : undefined,
      employee: a.employee ? String(a.employee) : null,
      createdAt: a.createdAt,
    })),
    counts: { interviews, offers },
  };
}

