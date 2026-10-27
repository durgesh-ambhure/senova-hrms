import { z } from 'zod';
import { objectId } from '../users/user.validation.js';
import { dateOnly } from '../../shared/dates.js';
import { DOCUMENT_CATEGORIES } from '../documents/document.model.js';
import { ASSIGNEE_TYPES, CHECKLIST_KINDS, MAX_TEMPLATE_TASKS } from './onboardingTemplate.model.js';
import { updateSchemaFrom } from '../../shared/validation.js';

const taskFields = {
  title: z.string().trim().min(2, 'Task title is required').max(150),
  description: z.string().trim().max(1000).default(''),
  assigneeType: z.enum(ASSIGNEE_TYPES),
  documentCategory: z.enum(DOCUMENT_CATEGORIES).nullable().default(null),
};

export const templateSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(100),
  kind: z.enum(CHECKLIST_KINDS),
  description: z.string().trim().max(500).default(''),
  tasks: z
    .array(z.object({ ...taskFields, dueOffsetDays: z.coerce.number().int().min(-60).max(180).default(0) }))
    .min(1, 'Add at least one task')
    .max(MAX_TEMPLATE_TASKS),
  isActive: z.boolean().default(true),
});

export const updateTemplateSchema = updateSchemaFrom(templateSchema, { omit: ['kind'] });

export const startChecklistSchema = z.object({ templateId: objectId });

export const adHocTaskSchema = z.object({ ...taskFields, kind: z.enum(CHECKLIST_KINDS), dueDate: dateOnly });

export const taskActionSchema = z.object({ note: z.string().trim().max(500).default('') });

export const listTasksQuery = z.strictObject({ kind: z.enum(CHECKLIST_KINDS).optional() });

export const overviewQuery = z.strictObject({
  kind: z.enum(CHECKLIST_KINDS).default('onboarding'),
  state: z.enum(['open', 'completed', 'all']).default('open'),
});
