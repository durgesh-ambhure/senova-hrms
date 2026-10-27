import { Router } from 'express';
import * as jobs from './jobs.service.js';
import * as candidates from './candidates.service.js';
import * as pipeline from './pipeline.service.js';
import * as offers from './offers.service.js';
import * as v from './recruitment.validation.js';
import { idParams, objectId } from '../users/user.validation.js';
import { authenticate, authorize, authorizeAny } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { documentUpload } from '../../shared/middleware/upload.js';
import { created, noContent, ok } from '../../shared/http.js';
import { z } from 'zod';

const page = (res, { items, meta }) => ok(res, items, meta);
const id = validate({ params: idParams });

/** Anyone involved in hiring: recruitment staff, interviewers and hiring managers (scoped in services). */
const involved = authorizeAny(
  'recruitment:jobs:manage',
  'recruitment:candidates:manage',
  'recruitment:interviews:manage',
  'recruitment:interviews:feedback',
  'recruitment:offers:manage',
  'recruitment:offers:approve',
  'recruitment:hire',
);
const recruiter = authorize('recruitment:candidates:manage');
const offerViewers = authorizeAny('recruitment:offers:manage', 'recruitment:offers:approve', 'recruitment:hire');

export const recruitmentRouter = Router();
recruitmentRouter.use(authenticate);

// Jobs
recruitmentRouter.get('/jobs', involved, validate({ query: v.jobListQuery }), async (req, res) => page(res, await jobs.listJobs(req, req.validatedQuery)));
recruitmentRouter.post('/jobs', authorize('recruitment:jobs:manage'), validate({ body: v.jobBody }), async (req, res) => created(res, await jobs.createJob(req, req.body)));
recruitmentRouter.get('/jobs/:id', involved, id, async (req, res) => ok(res, await jobs.getJob(req, req.params.id)));
recruitmentRouter.patch('/jobs/:id', authorize('recruitment:jobs:manage'), validate({ params: idParams, body: v.jobUpdate }), async (req, res) => ok(res, await jobs.updateJob(req, req.params.id, req.body)));

// Candidates
recruitmentRouter.get('/candidates', recruiter, validate({ query: v.candidateListQuery }), async (req, res) => page(res, await candidates.listCandidates(req, req.validatedQuery)));
recruitmentRouter.get('/candidates/duplicates', recruiter, validate({ query: v.duplicateQuery }), async (req, res) => ok(res, await candidates.findDuplicates(req.validatedQuery)));
recruitmentRouter.post('/candidates', recruiter, validate({ body: v.candidateBody }), async (req, res) => created(res, await candidates.createCandidate(req, req.body)));
recruitmentRouter.get('/candidates/:id', involved, id, async (req, res) => ok(res, await candidates.getCandidate(req, req.params.id)));
recruitmentRouter.patch('/candidates/:id', recruiter, validate({ params: idParams, body: v.candidateUpdate }), async (req, res) => ok(res, await candidates.updateCandidate(req, req.params.id, req.body)));
recruitmentRouter.get('/candidates/:id/applications', involved, id, async (req, res) => ok(res, await candidates.candidateApplications(req, req.params.id)));
recruitmentRouter.get('/candidates/:id/activity', recruiter, id, async (req, res) => ok(res, await candidates.listActivity(req, req.params.id)));
recruitmentRouter.post('/candidates/:id/notes', recruiter, validate({ params: idParams, body: v.noteBody }), async (req, res) => created(res, await candidates.addNote(req, req.params.id, req.body)));
recruitmentRouter.post('/candidates/:id/files', recruiter, documentUpload({ allowDocx: true }), validate({ params: idParams, body: v.fileBody }), async (req, res) =>
  created(res, await candidates.uploadFile(req, req.params.id, req.body)),
);
const fileParams = validate({ params: z.object({ id: objectId, fileId: objectId }) });
recruitmentRouter.get('/candidates/:id/files/:fileId', involved, fileParams, async (req, res) => {
  const { file, stream } = await candidates.openFile(req, req.params.id, req.params.fileId);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', file.size);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  stream.on('error', () => (res.headersSent ? res.destroy() : res.status(500).end()));
  stream.pipe(res);
});
recruitmentRouter.delete('/candidates/:id/files/:fileId', recruiter, fileParams, async (req, res) => {
  await candidates.deleteFile(req, req.params.id, req.params.fileId);
  return noContent(res);
});

// Applications & pipeline
recruitmentRouter.get('/applications', involved, validate({ query: v.applicationListQuery }), async (req, res) => page(res, await pipeline.listApplications(req, req.validatedQuery)));
recruitmentRouter.post('/applications', recruiter, validate({ body: v.applicationBody }), async (req, res) => created(res, await pipeline.createApplication(req, req.body)));
recruitmentRouter.get('/applications/:id', involved, id, async (req, res) => ok(res, await pipeline.getApplication(req, req.params.id)));
recruitmentRouter.post('/applications/:id/move', recruiter, validate({ params: idParams, body: v.moveBody }), async (req, res) => ok(res, await pipeline.moveStage(req, req.params.id, req.body)));
recruitmentRouter.post('/applications/:id/offers', authorize('recruitment:offers:manage'), validate({ params: idParams, body: v.offerBody }), async (req, res) =>
  created(res, await offers.createOffer(req, req.params.id, req.body)),
);
recruitmentRouter.post('/applications/:id/hire', authorize('recruitment:hire', 'employees:manage'), validate({ params: idParams, body: v.hireBody }), async (req, res) =>
  created(res, await offers.hireCandidate(req, req.params.id, req.body)),
);

// Interviews
recruitmentRouter.get('/interviewers', authorize('recruitment:interviews:manage'), validate({ query: z.strictObject({ search: z.string().trim().max(100).optional() }) }), async (req, res) =>
  ok(res, await pipeline.listEligibleInterviewers(req.validatedQuery)),
);
recruitmentRouter.get('/interviews', involved, validate({ query: v.interviewListQuery }), async (req, res) => ok(res, await pipeline.listInterviews(req, req.validatedQuery)));
recruitmentRouter.post('/interviews', authorize('recruitment:interviews:manage'), validate({ body: v.interviewBody }), async (req, res) => created(res, await pipeline.scheduleInterview(req, req.body)));
recruitmentRouter.get('/interviews/:id', involved, id, async (req, res) => ok(res, await pipeline.getInterview(req, req.params.id)));
recruitmentRouter.patch('/interviews/:id', authorize('recruitment:interviews:manage'), validate({ params: idParams, body: v.interviewUpdate }), async (req, res) =>
  ok(res, await pipeline.updateInterview(req, req.params.id, req.body)),
);
recruitmentRouter.post('/interviews/:id/feedback', authorize('recruitment:interviews:feedback'), validate({ params: idParams, body: v.feedbackBody }), async (req, res) =>
  ok(res, await pipeline.submitFeedback(req, req.params.id, req.body)),
);

// Offers (compensation: only offer managers, approvers and hiring admins)
recruitmentRouter.get('/offers', offerViewers, validate({ query: v.offerListQuery }), async (req, res) => ok(res, await offers.listOffers(req, req.validatedQuery)));
recruitmentRouter.get('/offers/:id', offerViewers, id, async (req, res) => ok(res, await offers.getOffer(req, req.params.id)));
recruitmentRouter.patch('/offers/:id', authorize('recruitment:offers:manage'), validate({ params: idParams, body: v.offerUpdate }), async (req, res) => ok(res, await offers.updateOffer(req, req.params.id, req.body)));
for (const action of ['submit', 'send', 'accept', 'decline', 'withdraw']) {
  recruitmentRouter.post(`/offers/:id/${action}`, authorize('recruitment:offers:manage'), validate({ params: idParams, body: v.offerActionBody }), async (req, res) =>
    ok(res, await offers.transitionOffer(req, req.params.id, action, req.body)),
  );
}
for (const action of ['approve', 'reject']) {
  recruitmentRouter.post(`/offers/:id/${action}`, authorize('recruitment:offers:approve'), validate({ params: idParams, body: v.offerActionBody }), async (req, res) =>
    ok(res, await offers.transitionOffer(req, req.params.id, action, req.body)),
  );
}
