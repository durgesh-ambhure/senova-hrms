import { Router } from 'express';
import * as service from './onboarding.service.js';
import {
  adHocTaskSchema,
  listTasksQuery,
  overviewQuery,
  startChecklistSchema,
  taskActionSchema,
  templateSchema,
  updateTemplateSchema,
} from './onboarding.validation.js';
import { idParams } from '../users/user.validation.js';
import { authenticate, authorize } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { created, ok } from '../../shared/http.js';

export const onboardingRouter = Router();
const hr = authorize('onboarding:manage');
const id = validate({ params: idParams });

onboardingRouter.use(authenticate);

onboardingRouter.get('/templates', hr, async (_req, res) => ok(res, await service.listTemplates()));
onboardingRouter.post('/templates', hr, validate({ body: templateSchema }), async (req, res) => created(res, await service.createTemplate(req, req.body)));
onboardingRouter.patch('/templates/:id', hr, validate({ params: idParams, body: updateTemplateSchema }), async (req, res) =>
  ok(res, await service.updateTemplate(req, req.params.id, req.body)),
);

onboardingRouter.get('/overview', hr, validate({ query: overviewQuery }), async (req, res) => ok(res, await service.getOverview(req.validatedQuery)));
onboardingRouter.get('/my-tasks', async (req, res) => ok(res, await service.listMyTasks(req)));

// Visibility of an employee's checklist (HR / the employee / their manager) is checked in the service.
onboardingRouter.get('/employees/:id/tasks', validate({ params: idParams, query: listTasksQuery }), async (req, res) =>
  ok(res, await service.listEmployeeTasks(req, req.params.id, req.validatedQuery)),
);
onboardingRouter.post('/employees/:id/start', hr, validate({ params: idParams, body: startChecklistSchema }), async (req, res) =>
  created(res, await service.startChecklist(req, req.params.id, req.body)),
);
onboardingRouter.post('/employees/:id/tasks', hr, validate({ params: idParams, body: adHocTaskSchema }), async (req, res) =>
  created(res, await service.addTask(req, req.params.id, req.body)),
);

onboardingRouter.post('/tasks/:id/complete', id, validate({ body: taskActionSchema }), async (req, res) => ok(res, await service.completeTask(req, req.params.id, req.body)));
onboardingRouter.post('/tasks/:id/waive', hr, id, validate({ body: taskActionSchema }), async (req, res) => ok(res, await service.waiveTask(req, req.params.id, req.body)));
onboardingRouter.post('/tasks/:id/reopen', hr, id, validate({ body: taskActionSchema }), async (req, res) => ok(res, await service.reopenTask(req, req.params.id, req.body)));
