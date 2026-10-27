import mongoose from 'mongoose';
import { ASSIGNEE_TYPES, CHECKLIST_KINDS } from './onboardingTemplate.model.js';
import { DOCUMENT_CATEGORIES } from '../documents/document.model.js';

export const TASK_STATUSES = ['pending', 'completed', 'waived'];

const { ObjectId } = mongoose.Schema.Types;

const onboardingTaskSchema = new mongoose.Schema(
  {
    employee: { type: ObjectId, ref: 'Employee', required: true },
    kind: { type: String, enum: CHECKLIST_KINDS, required: true },
    template: { type: ObjectId, ref: 'OnboardingTemplate', default: null },
    templateName: { type: String, default: null },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    assigneeType: { type: String, enum: ASSIGNEE_TYPES, required: true },
    dueDate: { type: Date, required: true },
    order: { type: Number, default: 0 },
    documentCategory: { type: String, enum: [...DOCUMENT_CATEGORIES, null], default: null },
    document: { type: ObjectId, ref: 'EmployeeDocument', default: null },
    status: { type: String, enum: TASK_STATUSES, default: 'pending' },
    completedAt: { type: Date, default: null },
    completedBy: { type: ObjectId, ref: 'User', default: null },
    completedByName: { type: String, default: null },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

onboardingTaskSchema.index({ employee: 1, kind: 1, order: 1 });
onboardingTaskSchema.index({ status: 1, assigneeType: 1, dueDate: 1 });
onboardingTaskSchema.index({ employee: 1, template: 1 });

export const OnboardingTask = mongoose.model('OnboardingTask', onboardingTaskSchema);
