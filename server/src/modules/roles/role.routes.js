import { Router } from 'express';
import * as controller from './role.controller.js';
import { createRoleSchema, roleKeyParams, updateRoleSchema } from './role.validation.js';
import { authenticate, authorize } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';

export const roleRouter = Router();

roleRouter.use(authenticate);
roleRouter.get('/', authorize('roles:read'), controller.list);
roleRouter.get('/permissions', authorize('roles:read'), controller.permissions);
roleRouter.post('/', authorize('roles:manage'), validate({ body: createRoleSchema }), controller.create);
roleRouter.patch('/:key', authorize('roles:manage'), validate({ params: roleKeyParams, body: updateRoleSchema }), controller.update);
roleRouter.delete('/:key', authorize('roles:manage'), validate({ params: roleKeyParams }), controller.remove);
