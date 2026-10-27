import { Router } from 'express';
import { z } from 'zod';
import * as service from './timesheet.service.js';
import { MAX_ENTRIES, TIMESHEET_STATUSES } from './timesheet.models.js';
import { idParams, objectId } from '../users/user.validation.js';
import { authenticate, authorize, authorizeAny } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { dateOnly } from '../../shared/dates.js';
import { created, ok } from '../../shared/http.js';
import { updateSchemaFrom } from '../../shared/validation.js';

const projectBody = z.object({
  name: z.string().trim().min(2).max(100),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,12}$/, '2–12 letters, digits or hyphens'),
  description: z.string().trim().max(300).default(''),
});
const weekParams = z.object({ weekStart: dateOnly });
const entriesBody = z.object({
  entries: z
    .array(
      z.object({
        date: dateOnly,
        projectId: objectId,
        task: z.string().trim().max(120).default(''),
        minutes: z.coerce.number().int().min(1, 'Log at least 1 minute').max(1440),
        note: z.string().trim().max(300).default(''),
      }),
    )
    .max(MAX_ENTRIES),
});
const listQuery = z.strictObject({
  scope: z.enum(['mine', 'approvals', 'all']).default('mine'),
  status: z.enum(TIMESHEET_STATUSES).optional(),
  employee: objectId.optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const decisionBody = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approved'), comment: z.string().trim().max(500).default('') }),
  z.object({ decision: z.literal('rejected'), comment: z.string().trim().min(3, 'Tell the employee what to fix').max(500) }),
]);
const reportQuery = z
  .strictObject({ from: dateOnly, to: dateOnly, employee: objectId.optional(), project: objectId.optional(), status: z.enum(['submitted', 'approved']).optional() })
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'End date must be on or after the start date' });

export const timesheetRouter = Router();
timesheetRouter.use(authenticate);

timesheetRouter.get('/projects', validate({ query: z.strictObject({ includeArchived: z.enum(['true', 'false']).optional() }) }), async (req, res) => ok(res, await service.listProjects(req.validatedQuery)));
timesheetRouter.post('/projects', authorize('timesheets:manage'), validate({ body: projectBody }), async (req, res) => created(res, await service.createProject(req, req.body)));
timesheetRouter.patch(
  '/projects/:id',
  authorize('timesheets:manage'),
  validate({ params: idParams, body: updateSchemaFrom(projectBody, { extend: { status: z.enum(['active', 'archived']) } }) }),
  async (req, res) => ok(res, await service.updateProject(req, req.params.id, req.body)),
);

const self = authorize('self:timesheets');
timesheetRouter.get('/mine/:weekStart', self, validate({ params: weekParams }), async (req, res) => ok(res, await service.getMyWeek(req, req.params.weekStart)));
timesheetRouter.put('/mine/:weekStart', self, validate({ params: weekParams, body: entriesBody }), async (req, res) => ok(res, await service.saveMyWeek(req, req.params.weekStart, req.body)));
timesheetRouter.post('/mine/:weekStart/submit', self, validate({ params: weekParams }), async (req, res) => ok(res, await service.submitMyWeek(req, req.params.weekStart)));

timesheetRouter.get('/report', authorizeAny('timesheets:manage', 'timesheets:approve:team', 'self:timesheets'), validate({ query: reportQuery }), async (req, res) => ok(res, await service.report(req, req.validatedQuery)));
timesheetRouter.get('/', validate({ query: listQuery }), async (req, res) => {
  const { items, meta } = await service.listTimesheets(req, req.validatedQuery);
  return ok(res, items, meta);
});
timesheetRouter.get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await service.getTimesheet(req, req.params.id)));
timesheetRouter.post('/:id/decision', authorizeAny('timesheets:manage', 'timesheets:approve:team'), validate({ params: idParams, body: decisionBody }), async (req, res) =>
  ok(res, await service.decideTimesheet(req, req.params.id, req.body)),
);
