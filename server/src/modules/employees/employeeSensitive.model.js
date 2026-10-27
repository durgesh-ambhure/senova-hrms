import mongoose from 'mongoose';

/**
 * Bank and statutory identifiers, kept apart from the profile so they can never leak through a
 * profile query, and authorized separately (employees:sensitive:read).
 * Account number and PAN are AES-256-GCM encrypted; only the last 4 digits are stored in clear.
 * Aadhaar: only the last 4 digits are kept — the full number is not stored by design.
 */
const employeeSensitiveSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, unique: true },
    bank: {
      accountHolderName: { type: String, trim: true, maxlength: 120, default: '' },
      bankName: { type: String, trim: true, maxlength: 120, default: '' },
      branch: { type: String, trim: true, maxlength: 120, default: '' },
      ifsc: { type: String, trim: true, uppercase: true, maxlength: 11, default: '' },
      accountNumberEnc: { type: String, default: null },
      accountNumberLast4: { type: String, default: null },
    },
    panEnc: { type: String, default: null },
    panLast4: { type: String, default: null },
    aadhaarLast4: { type: String, default: null },
    uan: { type: String, trim: true, maxlength: 12, default: '' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'employeeSensitive' },
);

export const EmployeeSensitive = mongoose.model('EmployeeSensitive', employeeSensitiveSchema);
