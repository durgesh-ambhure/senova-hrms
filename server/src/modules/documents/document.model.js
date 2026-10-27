import mongoose from 'mongoose';

export const DOCUMENT_CATEGORIES = [
  'identity',
  'address_proof',
  'education',
  'experience',
  'offer_letter',
  'appointment_letter',
  'relieving_letter',
  'bank_proof',
  'photo',
  'other',
];
export const DOCUMENT_STATUSES = ['pending', 'verified', 'rejected'];

/** Metadata only. File bytes live in private storage under `storageKey`. */
const documentSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    category: { type: String, enum: DOCUMENT_CATEGORIES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    fileName: { type: String, required: true, maxlength: 200 },
    mimeType: { type: String, required: true, enum: ['application/pdf', 'image/jpeg', 'image/png'] },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
    storageKey: { type: String, required: true, select: false },
    status: { type: String, enum: DOCUMENT_STATUSES, default: 'pending' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedByName: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, maxlength: 500, default: '' },
    onboardingTask: { type: mongoose.Schema.Types.ObjectId, ref: 'OnboardingTask', default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedByName: { type: String, default: null },
    // Soft delete: metadata (and file) are kept until the retention policy purges them (DECISIONS E5).
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

documentSchema.index({ employee: 1, deletedAt: 1, createdAt: -1 });
documentSchema.index({ status: 1, deletedAt: 1 });

export const EmployeeDocument = mongoose.model('EmployeeDocument', documentSchema, 'documents');
