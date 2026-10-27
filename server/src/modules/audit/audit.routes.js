import { Router } from 'express';
import { z } from 'zod';
import { listAuditLogs } from './audit.service.js';
import { authenticate, authorize } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { listQuerySchema } from '../../shared/pagination.js';
import { ok } from '../../shared/http.js';

const listAuditQuery = listQuerySchema(
  ['createdAt'],
  {
    entityType: z.string().trim().max(60).optional(),
    action: z.string().trim().max(80).optional(),
    actor: z.string().regex(/^[a-f\d]{24}$/i).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  },
  '-createdAt',
);

export const auditRouter = Router();

auditRouter.get('/', authenticate, authorize('audit:read'), validate({ query: listAuditQuery }), async (req, res) => {
  const { items, meta } = await listAuditLogs(req.validatedQuery);
  return ok(res, items, meta);
});
