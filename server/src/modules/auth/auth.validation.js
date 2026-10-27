import { z } from 'zod';
import { passwordSchema } from '../../shared/security/password.js';

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')).pipe(z.string().max(254));

export const loginSchema = z.object({
  email,
  // Not the strength policy: existing passwords are only checked, never re-validated.
  password: z.string().min(1, 'Password is required').max(128),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(128),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current password',
  });
