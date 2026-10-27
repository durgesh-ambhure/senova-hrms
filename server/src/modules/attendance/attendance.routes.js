import { Router } from 'express';
import { z } from 'zod';
import * as service from './attendance.service.js';
import * as shifts from './shift.service.js';
import { idParams, objectId } from '../users/user.validation.js';
import { authenticate, authorize, authorizeAny } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { dateOnly, monthString, timeOfDay } from '../../shared/dates.js';
import { created, ok } from '../../shared/http.js';
import { updateSchemaFrom } from '../../shared/validation.js';

const rangeQuery = z.strictObject({ employee: objectId.optional(), from: dateOnly, to: dateOnly });
const summaryQuery = z.strictObject({ employee: objectId.optional(), month: monthString });
const correctionBody = z.object({ date: dateOnly, checkIn: timeOfDay, checkOut: timeOfDay, reason: z.string().trim().min(5, 'Explain what happened').max(500) });
const correctionList = z.strictObject({ scope: z.enum(['mine', 'approvals']).default('mine'), status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional() });
const reviewBody = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approved'), note: z.string().trim().max(500).default('') }),
  z.object({ decision: z.literal('rejected'), note: z.string().trim().min(3, 'Give a reason').max(500) }),
]);

const shiftBody = z.object({
  name: z.string().trim().min(2).max(60),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,12}$/, '2–12 letters, digits or hyphens'),
  startTime: timeOfDay,
  endTime: timeOfDay,
  lateGraceMinutes: z.coerce.number().int().min(0).max(120).default(15),
  earlyLeaveGraceMinutes: z.coerce.number().int().min(0).max(120).default(15),
  fullDayMinutes: z.coerce.number().int().min(60).max(960).default(480),
  halfDayMinutes: z.coerce.number().int().min(30).max(720).default(240),
  weeklyOffs: z.array(z.number().int().min(0).max(6)).max(6).default([0, 6]),
  isDefault: z.boolean().default(false),
});
const shiftUpdate = updateSchemaFrom(shiftBody, { extend: { status: z.enum(['active', 'archived']) } });

export const attendanceRouter = Router();
attendanceRouter.use(authenticate);

// Self-service punches (record-level: always the actor's own employee profile).
const self = authorize('self:attendance');
attendanceRouter.get('/me/today', self, async (req, res) => ok(res, await service.getMyToday(req)));
attendanceRouter.post('/check-in', self, async (req, res) => created(res, await service.checkIn(req)));
attendanceRouter.post('/check-out', self, async (req, res) => ok(res, await service.checkOut(req)));
attendanceRouter.post('/breaks/start', self, async (req, res) => ok(res, await service.startBreak(req)));
attendanceRouter.post('/breaks/end', self, async (req, res) => ok(res, await service.endBreak(req)));

// Records and summaries: own, team or everyone depending on permissions (checked per employee).
attendanceRouter.get('/records', validate({ query: rangeQuery }), async (req, res) => ok(res, await service.listRecords(req, req.validatedQuery)));
attendanceRouter.get('/summary', validate({ query: summaryQuery }), async (req, res) => ok(res, await service.monthlySummary(req, req.validatedQuery)));
attendanceRouter.get('/team/today', authorizeAny('attendance:read:all', 'attendance:read:team'), async (req, res) => ok(res, await service.teamToday(req)));

// Corrections (regularization)
attendanceRouter.get('/corrections', validate({ query: correctionList }), async (req, res) => ok(res, await service.listCorrections(req, req.validatedQuery)));
attendanceRouter.post('/corrections', self, validate({ body: correctionBody }), async (req, res) => created(res, await service.requestCorrection(req, req.body)));
attendanceRouter.post(
  '/corrections/:id/review',
  authorizeAny('attendance:manage', 'attendance:approve:team'),
  validate({ params: idParams, body: reviewBody }),
  async (req, res) => ok(res, await service.reviewCorrection(req, req.params.id, req.body)),
);
attendanceRouter.post('/corrections/:id/cancel', self, validate({ params: idParams }), async (req, res) => ok(res, await service.cancelCorrection(req, req.params.id)));

// Shifts: readable by everyone signed in (employees see their schedule); managed by attendance admins.
export const shiftRouter = Router();
shiftRouter.use(authenticate);
shiftRouter.get('/', validate({ query: z.strictObject({ includeArchived: z.enum(['true', 'false']).optional() }) }), async (req, res) => ok(res, await shifts.listShifts(req.validatedQuery)));
shiftRouter.post('/', authorize('attendance:manage'), validate({ body: shiftBody }), async (req, res) => created(res, await shifts.createShift(req, req.body)));
shiftRouter.patch('/:id', authorize('attendance:manage'), validate({ params: idParams, body: shiftUpdate }), async (req, res) => ok(res, await shifts.updateShift(req, req.params.id, req.body)));
