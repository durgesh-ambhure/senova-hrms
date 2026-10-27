import { Application, Interview, JobOpening } from './recruitment.models.js';
import { hasPermission } from '../roles/permissions.js';
import { ownEmployeeId } from '../employees/team.js';

const can = (req, p) => hasPermission(req.auth.permissions, p);

/** Recruitment staff: full access to candidates and the pipeline. */
export const isRecruiter = (req) => can(req, 'recruitment:candidates:manage');

/** Any recruitment back-office permission (job list, pipeline overview). */
export const isRecruitmentStaff = (req) =>
  ['recruitment:jobs:manage', 'recruitment:candidates:manage', 'recruitment:interviews:manage', 'recruitment:offers:manage', 'recruitment:offers:approve', 'recruitment:hire'].some((p) => can(req, p));

/** Salary history, expectations and offer amounts are confidential. */
export const canSeeCompensation = (req) => ['recruitment:offers:manage', 'recruitment:offers:approve', 'recruitment:hire'].some((p) => can(req, p));

/** Jobs where the actor is the hiring manager (cached per request). */
export async function myHiringJobIds(req) {
  if (!req.hiringJobIds) {
    const me = ownEmployeeId(req);
    req.hiringJobIds = me ? (await JobOpening.find({ hiringManager: me }, { _id: 1 }).lean()).map((j) => String(j._id)) : [];
  }
  return req.hiringJobIds;
}

/**
 * How much of a candidate the actor may see:
 *  'full'    — recruiters (contact details, activity, files, all applications)
 *  'limited' — an assigned interviewer, or the hiring manager of a job they applied to
 *              (profile, skills, experience, resume — no contact details or compensation)
 *  null      — nothing (callers respond 404)
 */
export async function candidateAccess(req, candidateId) {
  if (isRecruiter(req)) return 'full';
  if (!can(req, 'recruitment:interviews:feedback')) return null;
  if (await Interview.exists({ candidate: candidateId, interviewers: req.auth.user._id, status: { $ne: 'cancelled' } })) return 'limited';
  const jobs = await myHiringJobIds(req);
  if (jobs.length && (await Application.exists({ candidate: candidateId, job: { $in: jobs } }))) return 'limited';
  return null;
}

/** 'full' for recruitment staff, 'hiring_manager' for the job's hiring manager, else null. */
export async function jobAccess(req, job) {
  if (isRecruitmentStaff(req)) return 'full';
  if ((await myHiringJobIds(req)).includes(String(job._id))) return 'hiring_manager';
  return null;
}
