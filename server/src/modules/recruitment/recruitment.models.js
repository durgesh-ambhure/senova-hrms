import mongoose from 'mongoose';
import { EMPLOYMENT_TYPES } from '../employees/employee.model.js';
import { STAGES } from './recruitment.rules.js';

const { ObjectId } = mongoose.Schema.Types;
const bounded = (max, label) => [(v) => v.length <= max, `At most ${max} ${label}`];

// Job openings

export const JOB_STATUSES = ['draft', 'open', 'on_hold', 'closed', 'filled'];

const jobOpeningSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, immutable: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    department: { type: ObjectId, ref: 'Department', required: true },
    designation: { type: ObjectId, ref: 'Designation', default: null },
    description: { type: String, trim: true, maxlength: 10_000, default: '' },
    requiredSkills: { type: [String], default: [], validate: bounded(30, 'skills') },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, required: true },
    workLocation: { type: String, trim: true, maxlength: 120, default: '' },
    openings: { type: Number, min: 1, max: 500, default: 1 },
    hiringManager: { type: ObjectId, ref: 'Employee', default: null },
    status: { type: String, enum: JOB_STATUSES, default: 'draft' },
    openedOn: { type: Date, default: null },
    closesOn: { type: Date, default: null },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
jobOpeningSchema.index({ status: 1, createdAt: -1 });
jobOpeningSchema.index({ hiringManager: 1 });
export const JobOpening = mongoose.model('JobOpening', jobOpeningSchema);

// Candidates — kept separate from employees until hiring is confirmed.

export const CANDIDATE_SOURCES = ['careers_site', 'referral', 'linkedin', 'job_board', 'agency', 'campus', 'walk_in', 'other'];

const candidateSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, required: true, trim: true, maxlength: 60 },
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    // Last 10 digits, for duplicate detection regardless of formatting / country code.
    phoneKey: { type: String, default: null },
    location: { type: String, trim: true, maxlength: 120, default: '' },
    currentCompany: { type: String, trim: true, maxlength: 120, default: '' },
    currentTitle: { type: String, trim: true, maxlength: 120, default: '' },
    experienceYears: { type: Number, min: 0, max: 60, default: 0 },
    skills: { type: [String], default: [], validate: bounded(50, 'skills') },
    source: { type: String, enum: CANDIDATE_SOURCES, default: 'other' },
    referredBy: { type: ObjectId, ref: 'Employee', default: null },
    noticePeriodDays: { type: Number, min: 0, max: 365, default: null },
    // Confidential: only users who can see offer compensation.
    currentCtcPaise: { type: Number, min: 0, default: null },
    expectedCtcPaise: { type: Number, min: 0, default: null },
    linkedInUrl: { type: String, trim: true, maxlength: 300, default: '' },
    doNotContact: { type: Boolean, default: false },
    employee: { type: ObjectId, ref: 'Employee', default: null },
    archivedAt: { type: Date, default: null },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
candidateSchema.pre('validate', function derive() {
  this.fullName = [this.firstName, this.lastName].filter(Boolean).join(' ');
  const digits = (this.phone ?? '').replace(/\D/g, '');
  this.phoneKey = digits.length >= 7 ? digits.slice(-10) : null;
});
candidateSchema.index({ phoneKey: 1 });
candidateSchema.index({ fullName: 1 });
candidateSchema.index({ skills: 1 });
export const Candidate = mongoose.model('Candidate', candidateSchema);

const candidateFileSchema = new mongoose.Schema(
  {
    candidate: { type: ObjectId, ref: 'Candidate', required: true, index: true },
    kind: { type: String, enum: ['resume', 'cover_letter', 'portfolio', 'other'], default: 'resume' },
    fileName: { type: String, required: true, maxlength: 200 },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
    storageKey: { type: String, required: true, select: false },
    uploadedBy: { type: ObjectId, ref: 'User', required: true },
    uploadedByName: String,
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
export const CandidateFile = mongoose.model('CandidateFile', candidateFileSchema);

/** Append-only activity feed for a candidate (notes, stage moves, interviews, offers). */
const candidateActivitySchema = new mongoose.Schema(
  {
    candidate: { type: ObjectId, ref: 'Candidate', required: true },
    application: { type: ObjectId, ref: 'Application', default: null },
    type: { type: String, enum: ['note', 'stage', 'interview', 'feedback', 'offer', 'hire', 'system'], required: true },
    body: { type: String, trim: true, maxlength: 2000, required: true },
    actor: { type: ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
candidateActivitySchema.index({ candidate: 1, createdAt: -1 });
export const CandidateActivity = mongoose.model('CandidateActivity', candidateActivitySchema);

// Applications (candidate × job) and the pipeline

const applicationSchema = new mongoose.Schema(
  {
    candidate: { type: ObjectId, ref: 'Candidate', required: true },
    job: { type: ObjectId, ref: 'JobOpening', required: true },
    stage: { type: String, enum: STAGES, default: 'applied' },
    stageChangedAt: { type: Date, default: Date.now },
    stageHistory: {
      type: [{ from: String, to: String, at: Date, byName: String, note: String, _id: false }],
      default: [],
      validate: bounded(60, 'stage changes'),
    },
    rejectionReason: { type: String, trim: true, maxlength: 500, default: '' },
    source: { type: String, default: null },
    employee: { type: ObjectId, ref: 'Employee', default: null },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
applicationSchema.index({ candidate: 1, job: 1 }, { unique: true });
applicationSchema.index({ job: 1, stage: 1 });
applicationSchema.index({ stage: 1, stageChangedAt: -1 });
export const Application = mongoose.model('Application', applicationSchema);

// Interviews

export const INTERVIEW_MODES = ['in_person', 'video', 'phone'];
export const RECOMMENDATIONS = ['strong_yes', 'yes', 'no', 'strong_no'];

const interviewSchema = new mongoose.Schema(
  {
    application: { type: ObjectId, ref: 'Application', required: true },
    candidate: { type: ObjectId, ref: 'Candidate', required: true },
    job: { type: ObjectId, ref: 'JobOpening', required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    mode: { type: String, enum: INTERVIEW_MODES, default: 'video' },
    scheduledAt: { type: Date, required: true },
    durationMinutes: { type: Number, min: 15, max: 480, default: 60 },
    timezone: { type: String, required: true },
    location: { type: String, trim: true, maxlength: 300, default: '' },
    interviewers: { type: [{ type: ObjectId, ref: 'User' }], validate: [(v) => v.length >= 1 && v.length <= 10, '1–10 interviewers'] },
    status: { type: String, enum: ['scheduled', 'completed', 'cancelled', 'no_show'], default: 'scheduled' },
    feedback: {
      type: [
        {
          interviewer: { type: ObjectId, ref: 'User', required: true },
          interviewerName: String,
          rating: { type: Number, min: 1, max: 5, required: true },
          recommendation: { type: String, enum: RECOMMENDATIONS, required: true },
          strengths: { type: String, maxlength: 2000, default: '' },
          concerns: { type: String, maxlength: 2000, default: '' },
          notes: { type: String, maxlength: 4000, default: '' },
          submittedAt: Date,
          _id: false,
        },
      ],
      default: [],
    },
    scheduledBy: { type: ObjectId, ref: 'User' },
    cancelReason: { type: String, maxlength: 500, default: '' },
  },
  { timestamps: true },
);
interviewSchema.index({ interviewers: 1, scheduledAt: 1 });
interviewSchema.index({ application: 1, scheduledAt: 1 });
export const Interview = mongoose.model('Interview', interviewSchema);

// Offers

export const OFFER_STATUSES = ['draft', 'pending_approval', 'approved', 'rejected', 'sent', 'accepted', 'declined', 'withdrawn'];
// Offers that still block creating another one for the same application.
export const OPEN_OFFER_STATUSES = ['draft', 'pending_approval', 'approved', 'sent'];

const jobOfferSchema = new mongoose.Schema(
  {
    application: { type: ObjectId, ref: 'Application', required: true },
    candidate: { type: ObjectId, ref: 'Candidate', required: true },
    job: { type: ObjectId, ref: 'JobOpening', required: true },
    version: { type: Number, default: 1 },
    department: { type: ObjectId, ref: 'Department', required: true },
    designation: { type: ObjectId, ref: 'Designation', required: true },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, required: true },
    workLocation: { type: String, trim: true, maxlength: 120, default: '' },
    proposedJoiningDate: { type: Date, required: true },
    probationMonths: { type: Number, min: 0, max: 24, default: 6 },
    // Integer paise. Detailed salary structure is defined in payroll (Phase 5).
    compensation: {
      annualCtcPaise: { type: Number, min: 0, required: true },
      fixedPaise: { type: Number, min: 0, default: 0 },
      variablePaise: { type: Number, min: 0, default: 0 },
      joiningBonusPaise: { type: Number, min: 0, default: 0 },
      notes: { type: String, maxlength: 1000, default: '' },
    },
    expiresOn: { type: Date, default: null },
    status: { type: String, enum: OFFER_STATUSES, default: 'draft' },
    preparedBy: { type: ObjectId, ref: 'User', required: true },
    preparedByName: String,
    approval: {
      decidedBy: { type: ObjectId, ref: 'User', default: null },
      decidedByName: { type: String, default: null },
      decidedAt: { type: Date, default: null },
      note: { type: String, maxlength: 500, default: '' },
    },
    sentAt: { type: Date, default: null },
    respondedAt: { type: Date, default: null },
    responseNote: { type: String, maxlength: 500, default: '' },
  },
  { timestamps: true },
);
jobOfferSchema.index({ application: 1, version: -1 });
jobOfferSchema.index({ status: 1, updatedAt: -1 });
export const JobOffer = mongoose.model('JobOffer', jobOfferSchema);
