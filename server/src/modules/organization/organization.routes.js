import { Router } from 'express';
import * as service from './organization.service.js';
import {
  createDepartmentSchema,
  createDesignationSchema,
  orgListQuery,
  updateDepartmentSchema,
  updateDesignationSchema,
} from './organization.validation.js';
import { idParams } from '../users/user.validation.js';
import { authenticate, authorize } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { created, ok } from '../../shared/http.js';

// Department and designation names are not sensitive: every signed-in user may read them
// (needed for filters and forms). Changes require organization:manage.
export const departmentRouter = Router();
departmentRouter.use(authenticate);
departmentRouter.get('/', validate({ query: orgListQuery }), async (req, res) => ok(res, await service.listDepartments(req.validatedQuery)));
departmentRouter.post('/', authorize('organization:manage'), validate({ body: createDepartmentSchema }), async (req, res) =>
  created(res, await service.createDepartment(req, req.body)),
);
departmentRouter.patch('/:id', authorize('organization:manage'), validate({ params: idParams, body: updateDepartmentSchema }), async (req, res) =>
  ok(res, await service.updateDepartment(req, req.params.id, req.body)),
);

export const designationRouter = Router();
designationRouter.use(authenticate);
designationRouter.get('/', validate({ query: orgListQuery }), async (req, res) => ok(res, await service.listDesignations(req.validatedQuery)));
designationRouter.post('/', authorize('organization:manage'), validate({ body: createDesignationSchema }), async (req, res) =>
  created(res, await service.createDesignation(req, req.body)),
);
designationRouter.patch('/:id', authorize('organization:manage'), validate({ params: idParams, body: updateDesignationSchema }), async (req, res) =>
  ok(res, await service.updateDesignation(req, req.params.id, req.body)),
);
