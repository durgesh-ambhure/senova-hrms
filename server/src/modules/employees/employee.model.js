import mongoose from 'mongoose';

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern', 'consultant'];
export const LIFECYCLE_STATUSES = ['pre_joining', 'active', 'notice_period', 'exited'];
export const PROBATION_STATUSES = ['not_applicable', 'on_probation', 'extended', 'confirmed'];
export const GENDERS = ['female', 'male', 'non_binary', 'prefer_not_to_say'];

const { ObjectId } = mongoose.Schema.Types;

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true, maxlength: 200, default: '' },
    line2: { type: String, trim: true, maxlength: 200, default: '' },
    city: { type: String, trim: true, maxlength: 100, default: '' },
    state: { type: String, trim: true, maxlength: 100, default: '' },
    postalCode: { type: String, trim: true, maxlength: 20, default: '' },
    country: { type: String, trim: true, maxlength: 100, default: '' },
  },
  { _id: false },
);

/**
 * Employee profile. Separate from the login account (users): an employee may have no login.
 * Bank and identity numbers live in employeeSensitive (encrypted, separately authorized);
 * documents and employment history live in their own collections, so this document stays small.
 */
const employeeSchema = new mongoose.Schema(
  {
    employeeCode: { type: String, required: true, unique: true, immutable: true },
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    middleName: { type: String, trim: true, maxlength: 60, default: '' },
    lastName: { type: String, required: true, trim: true, maxlength: 60 },
    fullName: { type: String, required: true },

    workEmail: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
    personalEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    dateOfBirth: { type: Date, default: null },
    gender: { type: String, enum: [...GENDERS, null], default: null },
    currentAddress: { type: addressSchema, default: () => ({}) },
    permanentAddress: { type: addressSchema, default: () => ({}) },
    emergencyContact: {
      name: { type: String, trim: true, maxlength: 120, default: '' },
      relationship: { type: String, trim: true, maxlength: 60, default: '' },
      phone: { type: String, trim: true, maxlength: 20, default: '' },
    },

    department: { type: ObjectId, ref: 'Department', required: true },
    designation: { type: ObjectId, ref: 'Designation', required: true },
    reportingManager: { type: ObjectId, ref: 'Employee', default: null },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, required: true },
    workLocation: { type: String, trim: true, maxlength: 120, default: '' },
    // Work schedule; null = company default shift.
    shift: { type: ObjectId, ref: 'Shift', default: null },

    joiningDate: { type: Date, required: true },
    lifecycleStatus: { type: String, enum: LIFECYCLE_STATUSES, required: true },
    probation: {
      status: { type: String, enum: PROBATION_STATUSES, default: 'not_applicable' },
      endDate: { type: Date, default: null },
      confirmedOn: { type: Date, default: null },
    },
    exit: {
      resignationDate: { type: Date, default: null },
      lastWorkingDate: { type: Date, default: null },
      exitDate: { type: Date, default: null },
      reason: { type: String, trim: true, maxlength: 500, default: '' },
    },

    // Authorized archival hides the record from the directory; nothing is hard-deleted.
    archivedAt: { type: Date, default: null },
    sourceApplication: { type: ObjectId, ref: 'Application', default: null },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

employeeSchema.pre('validate', function setFullName() {
  this.fullName = [this.firstName, this.middleName, this.lastName].filter(Boolean).join(' ');
});

employeeSchema.index({ department: 1, lifecycleStatus: 1 });
employeeSchema.index({ designation: 1 });
employeeSchema.index({ reportingManager: 1 });
employeeSchema.index({ lifecycleStatus: 1, archivedAt: 1 });
employeeSchema.index({ employmentType: 1 });
employeeSchema.index({ joiningDate: -1 });
employeeSchema.index({ fullName: 1 });
employeeSchema.index({ sourceApplication: 1 }, { unique: true, partialFilterExpression: { sourceApplication: { $type: 'objectId' } } });

export const Employee = mongoose.model('Employee', employeeSchema);
