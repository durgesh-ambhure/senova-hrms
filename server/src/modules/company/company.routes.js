import { Router } from 'express';
import * as companyService from './company.service.js';
import { policiesSchema, updateCompanySchema } from './company.validation.js';
import { authenticate, authorize, authorizeAny } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { hasPermission } from '../roles/permissions.js';
import { forbidden } from '../../shared/errors.js';
import { ok } from '../../shared/http.js';

export const companyRouter = Router();

// Each policy group may be changed by its module administrator (or a company administrator).
const POLICY_PERMISSIONS = { attendance: 'attendance:manage', leave: 'leave:manage' };

companyRouter.use(authenticate);
companyRouter.get('/', authorize('company:read'), async (_req, res) => ok(res, await companyService.getSettings()));
companyRouter.patch('/', authorize('company:manage'), validate({ body: updateCompanySchema }), async (req, res) =>
  ok(res, await companyService.updateSettings(req, req.body)),
);
companyRouter.patch('/policies', authorizeAny('company:manage', ...Object.values(POLICY_PERMISSIONS)), validate({ body: policiesSchema }), async (req, res) => {
  for (const group of Object.keys(req.body)) {
    if (!hasPermission(req.auth.permissions, 'company:manage') && !hasPermission(req.auth.permissions, POLICY_PERMISSIONS[group])) {
      throw forbidden(`You cannot change ${group} policies`);
    }
  }
  return ok(res, (await companyService.updateSettings(req, { policies: req.body })).policies);
});
