import { Router } from 'express';
import * as controller from './user.controller.js';
import { createUserSchema, idParams, listUsersQuery, updateUserSchema } from './user.validation.js';
import { authenticate, authorize } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';

export const userRouter = Router();

userRouter.use(authenticate);
userRouter.get('/', authorize('users:read'), validate({ query: listUsersQuery }), controller.list);
userRouter.post('/', authorize('users:manage'), validate({ body: createUserSchema }), controller.create);
userRouter.get('/:id', authorize('users:read'), validate({ params: idParams }), controller.get);
userRouter.patch('/:id', authorize('users:manage'), validate({ params: idParams, body: updateUserSchema }), controller.update);
userRouter.post('/:id/resend-invite', authorize('users:manage'), validate({ params: idParams }), controller.resendInvite);
userRouter.post('/:id/send-reset-link', authorize('users:manage'), validate({ params: idParams }), controller.sendResetLink);
userRouter.post('/:id/revoke-sessions', authorize('users:manage'), validate({ params: idParams }), controller.revokeSessions);
