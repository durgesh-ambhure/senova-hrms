import { z } from 'zod';
import { listQuerySchema } from '../../shared/pagination.js';
import { USER_STATUSES } from './user.model.js';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const idParams = z.object({ id: objectId });

const roleKeys = z.array(z.string().trim().min(1).max(40)).min(1, 'Assign at least one role').max(10);

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  roles: roleKeys,
});

// Only these fields are updatable through the API; everything else is stripped by zod.
export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    roles: roleKeys.optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const listUsersQuery = listQuerySchema(['name', 'email', 'createdAt', 'lastLoginAt'], {
  status: z.enum(USER_STATUSES).optional(),
  role: z.string().trim().max(40).optional(),
});
