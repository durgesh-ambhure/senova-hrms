import { Router } from 'express';
import * as controller from './employee.controller.js';
import {
  createEmployeeSchema,
  lifecycleSchema,
  listEmployeesQuery,
  probationSchema,
  selfUpdateSchema,
  sensitiveQuery,
  sensitiveSchema,
  updateEmployeeSchema,
} from './employee.validation.js';
import { idParams } from '../users/user.validation.js';
import { authenticate, authorize, authorizeAny } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';

export const employeeRouter = Router();
const id = validate({ params: idParams });

employeeRouter.use(authenticate);

employeeRouter.get('/', authorizeAny('employees:read:all', 'employees:read:team'), validate({ query: listEmployeesQuery }), controller.list);
employeeRouter.post('/', authorize('employees:manage'), validate({ body: createEmployeeSchema }), controller.create);

// Self-service (must precede /:id).
employeeRouter.get('/me', authorize('self:profile'), controller.getOwn);
employeeRouter.patch('/me', authorize('self:profile'), validate({ body: selfUpdateSchema }), controller.updateOwn);

// Record-level access for reads is decided by employee.policy (all / team / self).
employeeRouter.get('/:id', id, controller.get);
employeeRouter.get('/:id/history', id, controller.history);
employeeRouter.patch('/:id', authorize('employees:manage'), validate({ params: idParams, body: updateEmployeeSchema }), controller.update);
employeeRouter.post('/:id/lifecycle', authorize('employees:manage'), validate({ params: idParams, body: lifecycleSchema }), controller.lifecycle);
employeeRouter.post('/:id/probation', authorize('employees:manage'), validate({ params: idParams, body: probationSchema }), controller.probation);
employeeRouter.post('/:id/archive', authorize('employees:manage'), id, controller.archive);
employeeRouter.post('/:id/restore', authorize('employees:manage'), id, controller.restore);
employeeRouter.post('/:id/account', authorize('employees:manage', 'users:manage'), id, controller.createAccount);

employeeRouter.get('/:id/sensitive', authorize('employees:sensitive:read'), validate({ params: idParams, query: sensitiveQuery }), controller.getSensitive);
employeeRouter.put(
  '/:id/sensitive',
  authorize('employees:manage', 'employees:sensitive:read'),
  validate({ params: idParams, body: sensitiveSchema }),
  controller.updateSensitive,
);
