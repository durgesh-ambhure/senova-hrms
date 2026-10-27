import { z } from 'zod';
import { objectId } from '../users/user.validation.js';
import { EMPLOYMENT_TYPES } from '../employees/employee.model.js';
import { CANDIDATE_SOURCES, INTERVIEW_MODES, JOB_STATUSES, RECOMMENDATIONS } from './recruitment.models.js';
import { STAGES } from './recruitment.rules.js';
import { dateOnly } from '../../shared/dates.js';
import { rupees } from '../../shared/money.js';
import { updateSchemaFrom } from '../../shared/validation.js';

const skills = (max) =>
  z
    .array(z.string().trim().min(1).max(60))
    .max(max)
    .transform((list) => [...new Map(list.map((s) => [s.toLowerCase(), s])).values()]);
const page = { page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) };
const phone = z.union([z.literal(''), z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number')]);

// Jobs
export const jobBody = z.object({
  title: z.string().trim().min(2, 'Title is required').max(120),
  departmentId: objectId,
  designationId: objectId.nullable().optional(),
  description: z.string().trim().max(10_000).default(''),
  requiredSkills: skills(30).default([]),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  workLocation: z.string().trim().max(120).default(''),
  openings: z.coerce.number().int().min(1).max(500).default(1),
  hiringManagerId: objectId.nullable().optional(),
  status: z.enum(['draft', 'open']).default('draft'),
  closesOn: dateOnly.nullable().optional(),
});
export const jobUpdate = updateSchemaFrom(jobBody, { omit: ['status'], extend: { status: z.enum(JOB_STATUSES) } });
export const jobListQuery = z.strictObject({ status: z.enum(JOB_STATUSES).optional(), department: objectId.optional(), search: z.string().trim().max(100).optional(), ...page });

// Candidates
// Field rules without defaults (used as-is for updates, so a partial update never resets anything).
const candidateRules = {
  firstName: z.string().trim().min(1, 'First name is required').max(60),
  lastName: z.string().trim().min(1, 'Last name is required').max(60),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  phone,
  location: z.string().trim().max(120),
  currentCompany: z.string().trim().max(120),
  currentTitle: z.string().trim().max(120),
  experienceYears: z.coerce.number().min(0).max(60),
  skills: skills(50),
  source: z.enum(CANDIDATE_SOURCES),
  referredById: objectId.nullable(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).nullable(),
  currentCtc: rupees.nullable(),
  expectedCtc: rupees.nullable(),
  linkedInUrl: z.union([z.literal(''), z.url()]),
  doNotContact: z.boolean(),
};
const createDefaults = { phone: '', location: '', currentCompany: '', currentTitle: '', experienceYears: 0, skills: [], source: 'other', linkedInUrl: '', doNotContact: false };
export const candidateBody = z.object({
  ...Object.fromEntries(Object.entries(candidateRules).map(([k, v]) => [k, k in createDefaults ? v.default(createDefaults[k]) : ['firstName', 'lastName', 'email'].includes(k) ? v : v.optional()])),
  jobId: objectId.optional(),
  allowPhoneDuplicate: z.boolean().default(false),
});
export const candidateUpdate = z
  .object({ ...candidateRules, allowPhoneDuplicate: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).some((k) => k !== 'allowPhoneDuplicate'), 'Provide at least one field');
export const candidateListQuery = z.strictObject({
  search: z.string().trim().max(100).optional(),
  skill: z.string().trim().max(60).optional(),
  source: z.enum(CANDIDATE_SOURCES).optional(),
  job: objectId.optional(),
  stage: z.enum(STAGES).optional(),
  ...page,
});
export const duplicateQuery = z.strictObject({ email: z.string().trim().max(254).optional(), phone: z.string().trim().max(20).optional(), excludeId: objectId.optional() });
export const fileBody = z.object({ kind: z.enum(['resume', 'cover_letter', 'portfolio', 'other']).default('resume') });
export const noteBody = z.object({ body: z.string().trim().min(1, 'Write a note').max(2000) });

// Applications
export const applicationBody = z.object({ candidateId: objectId, jobId: objectId, source: z.enum(CANDIDATE_SOURCES).optional() });
export const applicationListQuery = z.strictObject({ job: objectId.optional(), stage: z.enum(STAGES).optional(), search: z.string().trim().max(100).optional(), ...page });
export const moveBody = z.object({ to: z.enum(STAGES), note: z.string().trim().max(500).default(''), reason: z.string().trim().max(500).default('') });

// Interviews
const interviewFields = {
  title: z.string().trim().min(2, 'Give the round a name').max(120),
  mode: z.enum(INTERVIEW_MODES).default('video'),
  scheduledAt: z.iso.datetime({ offset: true, message: 'Use an ISO date-time' }),
  durationMinutes: z.coerce.number().int().min(15).max(480).default(60),
  timezone: z
    .string()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown time zone')
    .optional(),
  location: z.string().trim().max(300).default(''),
  interviewerIds: z.array(objectId).min(1, 'Add at least one interviewer').max(10),
};
export const interviewBody = z.object({ applicationId: objectId, ...interviewFields });
export const interviewUpdate = z
  .object({
    title: interviewFields.title,
    mode: z.enum(INTERVIEW_MODES),
    scheduledAt: interviewFields.scheduledAt,
    durationMinutes: z.coerce.number().int().min(15).max(480),
    location: z.string().trim().max(300),
    interviewerIds: interviewFields.interviewerIds,
    status: z.enum(['completed', 'cancelled', 'no_show']),
    cancelReason: z.string().trim().max(500),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const interviewListQuery = z.strictObject({
  scope: z.enum(['mine', 'all']).default('mine'),
  application: objectId.optional(),
  candidate: objectId.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export const feedbackBody = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  recommendation: z.enum(RECOMMENDATIONS),
  strengths: z.string().trim().max(2000).default(''),
  concerns: z.string().trim().max(2000).default(''),
  notes: z.string().trim().max(4000).default(''),
});

// Offers
const compensation = z.object({
  annualCtc: rupees.refine((v) => v > 0, 'Enter the annual CTC'),
  fixed: rupees.default(0),
  variable: rupees.default(0),
  joiningBonus: rupees.default(0),
  notes: z.string().trim().max(1000).default(''),
});
const toPaiseShape = (c) =>
  c && {
    ...(c.annualCtc !== undefined ? { annualCtcPaise: c.annualCtc } : {}),
    ...(c.fixed !== undefined ? { fixedPaise: c.fixed } : {}),
    ...(c.variable !== undefined ? { variablePaise: c.variable } : {}),
    ...(c.joiningBonus !== undefined ? { joiningBonusPaise: c.joiningBonus } : {}),
    ...(c.notes !== undefined ? { notes: c.notes } : {}),
  };
const offerFields = {
  departmentId: objectId,
  designationId: objectId,
  employmentType: z.enum(EMPLOYMENT_TYPES),
  workLocation: z.string().trim().max(120).default(''),
  proposedJoiningDate: dateOnly,
  probationMonths: z.coerce.number().int().min(0).max(24).default(6),
  expiresOn: dateOnly.nullable().optional(),
};
export const offerBody = z.object({ ...offerFields, compensation }).transform((v) => ({ ...v, compensation: toPaiseShape(v.compensation) }));
export const offerUpdate = z
  .object({
    departmentId: objectId,
    designationId: objectId,
    employmentType: z.enum(EMPLOYMENT_TYPES),
    workLocation: z.string().trim().max(120),
    proposedJoiningDate: dateOnly,
    probationMonths: z.coerce.number().int().min(0).max(24),
    expiresOn: dateOnly.nullable(),
    compensation: z.object({ annualCtc: rupees, fixed: rupees, variable: rupees, joiningBonus: rupees, notes: z.string().trim().max(1000) }).partial(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field')
  .transform((v) => (v.compensation ? { ...v, compensation: toPaiseShape(v.compensation) } : v));
export const offerActionBody = z.object({ note: z.string().trim().max(500).default(''), joiningDate: dateOnly.optional() });
export const offerListQuery = z.strictObject({ status: z.string().max(30).optional(), application: objectId.optional(), candidate: objectId.optional() });

// Hiring
export const hireBody = z.object({
  workEmail: z.string().trim().toLowerCase().pipe(z.email('Enter the new work email address')),
  departmentId: objectId.optional(),
  designationId: objectId.optional(),
  reportingManagerId: objectId.nullable().optional(),
  shiftId: objectId.nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  workLocation: z.string().trim().max(120).optional(),
  joiningDate: dateOnly.optional(),
});
