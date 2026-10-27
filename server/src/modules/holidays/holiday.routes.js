import { Router } from 'express';
import { z } from 'zod';
import * as service from './holiday.service.js';
import { HOLIDAY_TYPES } from './holiday.model.js';
import { idParams } from '../users/user.validation.js';
import { authenticate, authorize } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { dateOnly } from '../../shared/dates.js';
import { created, noContent, ok } from '../../shared/http.js';
import { updateSchemaFrom } from '../../shared/validation.js';

const holidayBody = z.object({
  date: dateOnly,
  name: z.string().trim().min(2, 'Name is required').max(100),
  type: z.enum(HOLIDAY_TYPES).default('public'),
  locations: z.array(z.string().trim().max(120)).max(20).default([]),
  description: z.string().trim().max(300).default(''),
});
const listQuery = z.strictObject({
  year: z.coerce.number().int().min(2000).max(2100).default(() => new Date().getUTCFullYear()),
  location: z.string().trim().max(120).optional(),
});

export const holidayRouter = Router();
holidayRouter.use(authenticate);

// The holiday calendar is visible to everyone signed in; changes need organization:manage.
holidayRouter.get('/', validate({ query: listQuery }), async (req, res) => ok(res, await service.listHolidays(req.validatedQuery)));
holidayRouter.post('/', authorize('organization:manage'), validate({ body: holidayBody }), async (req, res) => created(res, await service.createHoliday(req, req.body)));
holidayRouter.patch(
  '/:id',
  authorize('organization:manage'),
  validate({ params: idParams, body: updateSchemaFrom(holidayBody) }),
  async (req, res) => ok(res, await service.updateHoliday(req, req.params.id, req.body)),
);
holidayRouter.delete('/:id', authorize('organization:manage'), validate({ params: idParams }), async (req, res) => {
  await service.deleteHoliday(req, req.params.id);
  return noContent(res);
});
