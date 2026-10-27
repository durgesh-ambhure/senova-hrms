import mongoose from 'mongoose';

/**
 * public / company holidays are non-working days. Optional (restricted) holidays are listed for
 * information but are working days unless the employee takes leave.
 */
export const HOLIDAY_TYPES = ['public', 'company', 'optional'];
export const NON_WORKING_HOLIDAY_TYPES = ['public', 'company'];

const holidaySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    year: { type: Number, required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    type: { type: String, enum: HOLIDAY_TYPES, default: 'public' },
    // Work locations the holiday applies to; empty = every location.
    locations: { type: [String], default: [], validate: [(v) => v.length <= 20, 'At most 20 locations'] },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

holidaySchema.pre('validate', function setYear() {
  if (this.date) this.year = this.date.getUTCFullYear();
});
holidaySchema.index({ date: 1, name: 1 }, { unique: true });
holidaySchema.index({ year: 1, date: 1 });

export const Holiday = mongoose.model('Holiday', holidaySchema);
