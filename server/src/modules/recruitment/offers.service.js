import { Application, Candidate, JobOffer, JobOpening, OPEN_OFFER_STATUSES } from './recruitment.models.js';
import { moveStage } from './pipeline.service.js';
import { logActivity } from './candidates.service.js';
import { Department } from '../organization/department.model.js';
import { Designation } from '../organization/designation.model.js';
import { createEmployee } from '../employees/employee.service.js';
import { getSettings } from '../company/company.service.js';
import { recordAudit } from '../audit/audit.service.js';
import { withTransaction } from '../../db/transaction.js';
import { conflict, forbidden, notFound, validationError } from '../../shared/errors.js';
import { addMonths, parseDateOnly, toDateOnly, todayIn } from '../../shared/dates.js';
import { paiseToRupees } from '../../shared/money.js';

/**
 * Offer workflow:
 *   draft → pending_approval → approved → sent → accepted | declined
 *   pending_approval → rejected (by approver) → edited → pending_approval
 *   draft | pending_approval | approved | sent → withdrawn
 * The approver must hold recruitment:offers:approve and cannot be the person who prepared it.
 */
export const OFFER_TRANSITIONS = {
  submit: { from: ['draft', 'rejected'], to: 'pending_approval' },
  approve: { from: ['pending_approval'], to: 'approved' },
  reject: { from: ['pending_approval'], to: 'rejected' },
  send: { from: ['approved'], to: 'sent' },
  accept: { from: ['sent'], to: 'accepted' },
  decline: { from: ['sent'], to: 'declined' },
  withdraw: { from: ['draft', 'pending_approval', 'approved', 'sent'], to: 'withdrawn' },
};

const POPULATE = [
  { path: 'candidate', select: 'fullName email' },
  { path: 'job', select: 'code title' },
  { path: 'department', select: 'name' },
  { path: 'designation', select: 'title' },
];

export function toPublicOffer(o) {
  return {
    id: String(o._id),
    application: String(o.application),
    candidate: o.candidate?._id ? { id: String(o.candidate._id), fullName: o.candidate.fullName } : { id: String(o.candidate) },
    job: o.job?._id ? { id: String(o.job._id), code: o.job.code, title: o.job.title } : { id: String(o.job) },
    version: o.version,
    department: o.department?._id ? { id: String(o.department._id), name: o.department.name } : { id: String(o.department) },
    designation: o.designation?._id ? { id: String(o.designation._id), title: o.designation.title } : { id: String(o.designation) },
    employmentType: o.employmentType,
    workLocation: o.workLocation,
    proposedJoiningDate: toDateOnly(o.proposedJoiningDate),
    probationMonths: o.probationMonths,
    compensation: {
      annualCtc: paiseToRupees(o.compensation.annualCtcPaise),
      fixed: paiseToRupees(o.compensation.fixedPaise),
      variable: paiseToRupees(o.compensation.variablePaise),
      joiningBonus: paiseToRupees(o.compensation.joiningBonusPaise),
      notes: o.compensation.notes,
    },
    expiresOn: toDateOnly(o.expiresOn),
    status: o.status,
    preparedByName: o.preparedByName,
    approval: o.approval,
    sentAt: o.sentAt,
    respondedAt: o.respondedAt,
    responseNote: o.responseNote,
    createdAt: o.createdAt,
  };
}

function validateCompensation(c) {
  if (c.fixedPaise + c.variablePaise > c.annualCtcPaise) {
    throw validationError([{ path: 'compensation.fixed', message: 'Fixed + variable pay cannot exceed the annual CTC' }]);
  }
}

async function resolveOfferRefs({ departmentId, designationId }) {
  const out = {};
  if (departmentId !== undefined) {
    out.department = (await Department.findOne({ _id: departmentId, status: 'active' }, { _id: 1 }).lean())?._id;
    if (!out.department) throw validationError([{ path: 'departmentId', message: 'Choose an active department' }]);
  }
  if (designationId !== undefined) {
    out.designation = (await Designation.findOne({ _id: designationId, status: 'active' }, { _id: 1 }).lean())?._id;
    if (!out.designation) throw validationError([{ path: 'designationId', message: 'Choose an active designation' }]);
  }
  return out;
}

function assertDates({ proposedJoiningDate, expiresOn }, today) {
  if (proposedJoiningDate && proposedJoiningDate < today) throw validationError([{ path: 'proposedJoiningDate', message: 'Joining date cannot be in the past' }]);
  if (expiresOn && expiresOn < today) throw validationError([{ path: 'expiresOn', message: 'Expiry cannot be in the past' }]);
}

export async function createOffer(req, applicationId, { departmentId, designationId, compensation, proposedJoiningDate, expiresOn, ...input }) {
  const today = todayIn((await getSettings()).timezone);
  assertDates({ proposedJoiningDate, expiresOn }, today);
  validateCompensation(compensation);
  const refs = await resolveOfferRefs({ departmentId, designationId });
  const offer = await withTransaction(async (session) => {
    const app = await Application.findById(applicationId).session(session);
    if (!app) throw notFound('Application not found');
    if (!['selected', 'offer'].includes(app.stage)) throw conflict('Only selected candidates can receive an offer');
    if (await JobOffer.exists({ application: app._id, status: { $in: OPEN_OFFER_STATUSES } }).session(session)) {
      throw conflict('This application already has an open offer — withdraw it before preparing a new one');
    }
    const version = (await JobOffer.countDocuments({ application: app._id }).session(session)) + 1;
    const [o] = await JobOffer.create(
      [
        {
          ...input,
          ...refs,
          compensation,
          application: app._id,
          candidate: app.candidate,
          job: app.job,
          version,
          proposedJoiningDate: parseDateOnly(proposedJoiningDate),
          expiresOn: expiresOn ? parseDateOnly(expiresOn) : null,
          preparedBy: req.auth.user._id,
          preparedByName: req.auth.user.name,
        },
      ],
      { session },
    );
    if (app.stage === 'selected') await moveStage(req, app._id, { to: 'offer', note: `Offer v${version} prepared` }, { session, system: true });
    await logActivity(req, { candidate: app.candidate, application: app._id, type: 'offer', body: `Prepared offer v${version}` }, session);
    await recordAudit(req, { action: 'offer.created', entityType: 'Candidate', entityId: app.candidate, summary: `Prepared offer v${version}` }, session);
    return o;
  });
  return getOffer(req, offer._id);
}

export async function updateOffer(req, id, { departmentId, designationId, compensation, proposedJoiningDate, expiresOn, ...input }) {
  const o = await JobOffer.findById(id);
  if (!o) throw notFound('Offer not found');
  if (!['draft', 'rejected'].includes(o.status)) throw conflict(`An offer that is ${o.status.replace('_', ' ')} cannot be edited`);
  const today = todayIn((await getSettings()).timezone);
  assertDates({ proposedJoiningDate, expiresOn }, today);
  Object.assign(o, input, await resolveOfferRefs({ departmentId, designationId }));
  if (compensation) {
    o.compensation = { ...o.compensation.toObject(), ...compensation };
    validateCompensation(o.compensation);
  }
  if (proposedJoiningDate) o.proposedJoiningDate = parseDateOnly(proposedJoiningDate);
  if (expiresOn !== undefined) o.expiresOn = expiresOn ? parseDateOnly(expiresOn) : null;
  o.status = 'draft';
  await o.save();
  await recordAudit(req, { action: 'offer.updated', entityType: 'Candidate', entityId: o.candidate, summary: `Edited offer v${o.version}` });
  return getOffer(req, o._id);
}

/** Moves an offer through its workflow; side effects on the application happen in the same transaction. */
export async function transitionOffer(req, id, action, { note = '', joiningDate } = {}) {
  const rule = OFFER_TRANSITIONS[action];
  const today = todayIn((await getSettings()).timezone);
  const offer = await withTransaction(async (session) => {
    const o = await JobOffer.findById(id).session(session);
    if (!o) throw notFound('Offer not found');
    if (!rule.from.includes(o.status)) throw conflict(`Cannot ${action} an offer that is ${o.status.replace('_', ' ')}`);
    if (['approve', 'reject'].includes(action)) {
      // Separation of duties: the preparer never approves their own offer.
      if (String(o.preparedBy) === String(req.auth.user._id)) throw forbidden('You cannot approve an offer you prepared');
      if (action === 'reject' && note.trim().length < 3) throw validationError([{ path: 'note', message: 'Give a reason' }]);
      o.approval = { decidedBy: req.auth.user._id, decidedByName: req.auth.user.name, decidedAt: new Date(), note };
    }
    if (action === 'send') {
      if (o.expiresOn && toDateOnly(o.expiresOn) < today) throw conflict('This offer has expired; edit and re-approve it');
      o.sentAt = new Date();
    }
    if (['accept', 'decline'].includes(action)) {
      o.respondedAt = new Date();
      o.responseNote = note;
      if (action === 'accept' && joiningDate) {
        if (joiningDate < today) throw validationError([{ path: 'joiningDate', message: 'Joining date cannot be in the past' }]);
        o.proposedJoiningDate = parseDateOnly(joiningDate);
      }
    }
    o.status = rule.to;
    await o.save({ session });

    if (action === 'accept') await moveStage(req, o.application, { to: 'hired', note: `Offer v${o.version} accepted` }, { session, system: true });
    if (['withdraw', 'decline'].includes(action)) {
      const app = await Application.findById(o.application).session(session);
      // Back to "selected" so a revised offer can be made; recruiters may then reject instead.
      if (app.stage === 'offer') await moveStage(req, app._id, { to: 'selected', note: `Offer v${o.version} ${o.status}` }, { session, system: true });
    }
    await logActivity(req, { candidate: o.candidate, application: o.application, type: 'offer', body: `Offer v${o.version} ${o.status.replace('_', ' ')}${note ? `: ${note}` : ''}` }, session);
    await recordAudit(req, { action: `offer.${o.status}`, entityType: 'Candidate', entityId: o.candidate, summary: `Offer v${o.version} ${o.status}` }, session);
    return o;
  });
  return getOffer(req, offer._id);
}

export async function getOffer(_req, id) {
  const o = await JobOffer.findById(id).populate(POPULATE).lean();
  if (!o) throw notFound('Offer not found');
  return toPublicOffer(o);
}

export async function listOffers(req, { status, application, candidate }) {
  const filter = {};
  if (status) filter.status = status;
  if (application) filter.application = application;
  if (candidate) filter.candidate = candidate;
  const items = await JobOffer.find(filter).sort({ updatedAt: -1 }).limit(200).populate(POPULATE).lean();
  return items.map(toPublicOffer);
}

// Candidate → employee conversion

/**
 * Converts a hired candidate into an employee record in one transaction. The candidate and the
 * application are kept (and linked to the employee) for history. A unique index on
 * employees.sourceApplication guarantees a candidate is converted at most once, even under races.
 */
export async function hireCandidate(req, applicationId, input) {
  const result = await withTransaction(async (session) => {
    const app = await Application.findById(applicationId).session(session);
    if (!app) throw notFound('Application not found');
    if (app.stage !== 'hired') throw conflict('Only candidates who accepted an offer can be converted');
    if (app.employee) throw conflict('This candidate has already been converted to an employee');
    const [candidate, offer, job] = await Promise.all([
      Candidate.findById(app.candidate).session(session),
      JobOffer.findOne({ application: app._id, status: 'accepted' }).sort({ version: -1 }).session(session),
      JobOpening.findById(app.job).session(session),
    ]);
    if (!offer) throw conflict('No accepted offer found for this application');
    if (candidate.employee) throw conflict(`${candidate.fullName} is already an employee`);

    const joiningDate = input.joiningDate ?? toDateOnly(offer.proposedJoiningDate);
    const employee = await createEmployee(
      req,
      {
        firstName: candidate.firstName,
        middleName: '',
        lastName: candidate.lastName,
        workEmail: input.workEmail,
        personalEmail: candidate.email,
        phone: candidate.phone,
        departmentId: input.departmentId ?? String(offer.department),
        designationId: input.designationId ?? String(offer.designation),
        reportingManagerId: input.reportingManagerId !== undefined ? input.reportingManagerId : job.hiringManager ? String(job.hiringManager) : null,
        shiftId: input.shiftId ?? null,
        employmentType: input.employmentType ?? offer.employmentType,
        workLocation: input.workLocation ?? offer.workLocation,
        joiningDate,
        probationEndDate: offer.probationMonths ? addMonths(joiningDate, offer.probationMonths) : null,
      },
      { session, sourceApplication: app._id },
    );
    app.employee = employee._id;
    candidate.employee = employee._id;
    await Promise.all([app.save({ session }), candidate.save({ session })]);

    // Fill the job once enough candidates have been hired.
    const hired = await Application.countDocuments({ job: job._id, stage: 'hired' }).session(session);
    if (job.status === 'open' && hired >= job.openings) {
      job.status = 'filled';
      await job.save({ session });
    }
    await logActivity(req, { candidate: candidate._id, application: app._id, type: 'hire', body: `Converted to employee ${employee.employeeCode}, joining ${joiningDate}` }, session);
    await recordAudit(req, { action: 'recruitment.hired', entityType: 'Employee', entityId: employee._id, summary: `Hired ${candidate.fullName} from ${job.code} as ${employee.employeeCode}` }, session);
    return { employeeId: String(employee._id), employeeCode: employee.employeeCode, jobFilled: job.status === 'filled' };
  });
  return result;
}

