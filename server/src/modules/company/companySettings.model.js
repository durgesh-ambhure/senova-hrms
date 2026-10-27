import mongoose from 'mongoose';

export const SETTINGS_KEY = 'company';

/** Singleton configuration document for the one company this system serves. */
const companySettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: SETTINGS_KEY, unique: true, immutable: true },
    legalName: { type: String, trim: true, maxlength: 200, default: 'Senova' },
    displayName: { type: String, trim: true, maxlength: 80, default: 'Senova' },
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
    phone: { type: String, trim: true, maxlength: 30, default: '' },
    website: { type: String, trim: true, maxlength: 200, default: '' },
    address: {
      line1: { type: String, trim: true, maxlength: 200, default: '' },
      line2: { type: String, trim: true, maxlength: 200, default: '' },
      city: { type: String, trim: true, maxlength: 100, default: '' },
      state: { type: String, trim: true, maxlength: 100, default: '' },
      postalCode: { type: String, trim: true, maxlength: 20, default: '' },
      country: { type: String, trim: true, maxlength: 100, default: 'India' },
    },
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    dateFormat: { type: String, enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'], default: 'DD/MM/YYYY' },
    // 1 = January … 12 = December. Indian financial year starts in April.
    financialYearStartMonth: { type: Number, min: 1, max: 12, default: 4 },
    employeeCodePrefix: { type: String, trim: true, uppercase: true, maxlength: 10, default: 'SEN' },
    // Company-wide time & leave rules. Defaults are provisional (see docs/DECISIONS.md A1–A12).
    policies: {
      attendance: {
        // How many days back an employee may request a missing-punch correction (A6).
        correctionWindowDays: { type: Number, min: 1, max: 60, default: 7 },
        // Overtime is calculated only when enabled (A4).
        overtimeEnabled: { type: Boolean, default: false },
        // For overnight shifts, punches until this many hours after shift end belong to the previous day.
        overnightCutoffHours: { type: Number, min: 0, max: 8, default: 4 },
      },
      leave: {
        // Weekly offs and holidays inside a leave are not counted unless enabled ("sandwich rule", A9).
        countNonWorkingDays: { type: Boolean, default: false },
        backdatedDays: { type: Number, min: 0, max: 90, default: 30 },
        maxAdvanceDays: { type: Number, min: 1, max: 730, default: 365 },
      },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const CompanySettings = mongoose.model('CompanySettings', companySettingsSchema, 'companySettings');
