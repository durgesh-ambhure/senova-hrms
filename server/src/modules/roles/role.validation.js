import { z } from 'zod';

const permissions = z.array(z.string().trim().min(1).max(60)).max(100);

export const roleKeyParams = z.object({ key: z.string().trim().toLowerCase().max(40) });

export const createRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use lower_snake_case, 2–40 characters'),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).default(''),
  permissions: permissions.default([]),
});

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    description: z.string().trim().max(300).optional(),
    permissions: permissions.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
