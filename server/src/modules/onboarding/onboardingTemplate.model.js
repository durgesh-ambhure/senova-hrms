import mongoose from 'mongoose';
import { DOCUMENT_CATEGORIES } from '../documents/document.model.js';

export const CHECKLIST_KINDS = ['onboarding', 'offboarding'];
export const ASSIGNEE_TYPES = ['employee', 'manager', 'hr'];
export const MAX_TEMPLATE_TASKS = 50;

const templateTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    assigneeType: { type: String, enum: ASSIGNEE_TYPES, required: true },
    // Days relative to the joining date (onboarding) or last working day (offboarding).
    dueOffsetDays: { type: Number, min: -60, max: 180, default: 0 },
    documentCategory: { type: String, enum: [...DOCUMENT_CATEGORIES, null], default: null },
  },
  { _id: true },
);

/** A configurable checklist. Starting it for an employee copies its tasks (later edits don't rewrite history). */
const onboardingTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    kind: { type: String, enum: CHECKLIST_KINDS, required: true },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    tasks: {
      type: [templateTaskSchema],
      validate: [(v) => v.length >= 1 && v.length <= MAX_TEMPLATE_TASKS, `A checklist needs 1–${MAX_TEMPLATE_TASKS} tasks`],
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const OnboardingTemplate = mongoose.model('OnboardingTemplate', onboardingTemplateSchema);
