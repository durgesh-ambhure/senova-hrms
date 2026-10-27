import mongoose from 'mongoose';
import { ORG_STATUSES } from './department.model.js';

const designationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    titleKey: { type: String, required: true, unique: true },
    // Seniority band, 1 = most junior. Used for sorting and, later, approval rules.
    level: { type: Number, min: 1, max: 20, default: 1 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: ORG_STATUSES, default: 'active', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

designationSchema.pre('validate', function setTitleKey() {
  if (this.title) this.titleKey = this.title.trim().toLowerCase();
});

export const Designation = mongoose.model('Designation', designationSchema);
