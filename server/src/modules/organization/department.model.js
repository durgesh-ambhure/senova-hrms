import mongoose from 'mongoose';

export const ORG_STATUSES = ['active', 'archived'];

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // Lower-cased name for case-insensitive uniqueness ("Finance" vs "finance").
    nameKey: { type: String, required: true, unique: true },
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 12 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    head: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    status: { type: String, enum: ORG_STATUSES, default: 'active', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

departmentSchema.pre('validate', function setNameKey() {
  if (this.name) this.nameKey = this.name.trim().toLowerCase();
});

export const Department = mongoose.model('Department', departmentSchema);
