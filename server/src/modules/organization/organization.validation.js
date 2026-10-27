import { z } from 'zod';
import { objectId } from '../users/user.validation.js';
import { updateSchemaFrom } from '../../shared/validation.js';

export const orgListQuery = z.strictObject({
  includeArchived: z.enum(['true', 'false']).optional(),
});

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(100),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,12}$/, '2–12 letters, digits or hyphens'),
  description: z.string().trim().max(500).default(''),
  headId: objectId.nullable().optional(),
});

export const updateDepartmentSchema = updateSchemaFrom(createDepartmentSchema, { extend: { status: z.enum(['active', 'archived']) } });

export const createDesignationSchema = z.object({
  title: z.string().trim().min(2, 'Title is required').max(100),
  level: z.coerce.number().int().min(1).max(20).default(1),
  description: z.string().trim().max(500).default(''),
});

export const updateDesignationSchema = updateSchemaFrom(createDesignationSchema, { extend: { status: z.enum(['active', 'archived']) } });
