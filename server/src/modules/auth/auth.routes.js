import { Router } from 'express';
import * as controller from './auth.controller.js';
import { changePasswordSchema, forgotPasswordSchema, loginSchema, resetPasswordSchema } from './auth.validation.js';
import { validate } from '../../shared/middleware/validate.js';
import { authenticate } from '../../shared/middleware/auth.js';
import { authLimiter } from '../../shared/middleware/rateLimiters.js';

export const authRouter = Router();

authRouter.get('/csrf', controller.csrf);
authRouter.post('/login', authLimiter, validate({ body: loginSchema }), controller.login);
authRouter.post('/logout', controller.logout);
authRouter.get('/me', authenticate, controller.me);
authRouter.post('/forgot-password', authLimiter, validate({ body: forgotPasswordSchema }), controller.forgotPassword);
authRouter.post('/reset-password', authLimiter, validate({ body: resetPasswordSchema }), controller.resetPassword);
authRouter.post('/change-password', authenticate, validate({ body: changePasswordSchema }), controller.changePassword);
