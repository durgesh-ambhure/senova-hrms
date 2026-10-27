import { Router } from 'express';
import { z } from 'zod';
import * as service from './leave.service.js';
import { LEAVE_STATUSES } from './leave.models.js';
import { EMPLOYMENT_TYPES } from '../employees/employee.model.js';
import { idParams, objectId } from '../users/user.validation.js';
import { authenticate, authorize, authorizeAny } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { dateOnly } from '../../shared/dates.js';
import { created, ok } from '../../shared/http.js';
import { updateSchemaFrom } from '../../shared/validation.js';

const halfStep = (max) => z.coerce.number().min(0).max(max).refine((v) => Number.isInteger(v * 2), 'Use whole or half days');

const typeBody = z.object({
  name: z.string().trim().min(2).max(60),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,10}$/, '1–10 letters or digits'),
  description: z.string().trim().max(300).default(''),
  paid: z.boolean().default(true),
  unlimited: z.boolean().default(false),
  annualQuotaDays: halfStep(365).default(0),
  accrual: z.enum(['annual', 'monthly']).default('monthly'),
  carryForwardMaxDays: halfStep(365).default(0),
  allowHalfDay: z.boolean().default(true),
  allowNegativeBalance: z.boolean().default(false),
  availableDuringProbation: z.boolean().default(true),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).default([]),
  maxConsecutiveDays: z.coerce.number().int().min(1).max(365).nullable().default(null),
  minNoticeDays: z.coerce.number().int().min(0).max(90).default(0),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#3459ad'),
});
const typeUpdate = updateSchemaFrom(typeBody, { extend: { status: z.enum(['active', 'archived']) } });

const applyBody = z.object({
  employeeId: objectId.optional(),
  leaveTypeId: objectId,
  startDate: dateOnly,
  endDate: dateOnly,
  startSession: z.enum(['full', 'second_half']).default('full'),
  endSession: z.enum(['full', 'first_half']).default('full'),
  reason: z.string().trim().max(500).default(''),
});
const decisionBody = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approved'), note: z.string().trim().max(500).default('') }),
  z.object({ decision: z.literal('rejected'), note: z.string().trim().min(3, 'Give a reason').max(500) }),
]);
const listQuery = z.strictObject({
  scope: z.enum(['mine', 'approvals', 'all']).default('mine'),
  status: z.enum(LEAVE_STATUSES).optional(),
  employee: objectId.optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const balanceQuery = z.strictObject({ employee: objectId.optional(), year: z.coerce.number().int().min(2000).max(2100).optional() });
const adjustBody = z.object({
  employeeId: objectId,
  leaveTypeId: objectId,
  year: z.coerce.number().int().min(2000).max(2100),
  days: z.coerce
    .number()
    .refine((v) => v !== 0 && Number.isInteger(v * 2), 'Use a non-zero number of whole or half days')
    .refine((v) => Math.abs(v) <= 365, 'Too large'),
  reason: z.string().trim().min(3, 'Give a reason').max(300),
});

export const leaveRouter = Router();
leaveRouter.use(authenticate);

leaveRouter.get('/types', validate({ query: z.strictObject({ includeArchived: z.enum(['true', 'false']).optional() }) }), async (req, res) => ok(res, await service.listLeaveTypes(req.validatedQuery)));
leaveRouter.post('/types', authorize('leave:manage'), validate({ body: typeBody }), async (req, res) => created(res, await service.createLeaveType(req, req.body)));
leaveRouter.patch('/types/:id', authorize('leave:manage'), validate({ params: idParams, body: typeUpdate }), async (req, res) => ok(res, await service.updateLeaveType(req, req.params.id, req.body)));

// Balance and request visibility (own / team / all) is checked per employee in the service.
leaveRouter.get('/balances', validate({ query: balanceQuery }), async (req, res) => ok(res, await service.getBalances(req, req.validatedQuery)));
leaveRouter.post('/balances/adjust', authorize('leave:manage'), validate({ body: adjustBody }), async (req, res) =>
  ok(res, await service.adjustBalance(req, { ...req.body, units: req.body.days * 2 })),
);

leaveRouter.get('/requests', validate({ query: listQuery }), async (req, res) => {
  const { items, meta } = await service.listRequests(req, req.validatedQuery);
  return ok(res, items, meta);
});
leaveRouter.post('/requests/preview', authorizeAny('self:leave', 'leave:manage'), validate({ body: applyBody }), async (req, res) => ok(res, await service.previewLeave(req, req.body)));
leaveRouter.post('/requests', authorizeAny('self:leave', 'leave:manage'), validate({ body: applyBody }), async (req, res) => created(res, await service.applyLeave(req, req.body)));
leaveRouter.get('/requests/:id', validate({ params: idParams }), async (req, res) => ok(res, await service.getRequest(req, req.params.id)));
leaveRouter.post('/requests/:id/decision', authorizeAny('leave:manage', 'leave:approve:team'), validate({ params: idParams, body: decisionBody }), async (req, res) =>
  ok(res, await service.decideLeave(req, req.params.id, req.body)),
);
leaveRouter.post('/requests/:id/cancel', validate({ params: idParams, body: z.object({ reason: z.string().trim().max(500).default('') }) }), async (req, res) =>
  ok(res, await service.cancelLeave(req, req.params.id, req.body)),
);
leaveRouter.post('/requests/:id/cancellation-decision', authorizeAny('leave:manage', 'leave:approve:team'), validate({ params: idParams, body: decisionBody }), async (req, res) =>
  ok(res, await service.decideCancellation(req, req.params.id, req.body)),
);
