import { z } from 'zod';
import { objectId } from '../users/user.validation.js';
import { dateOnly } from '../../shared/dates.js';
import { listQuerySchema } from '../../shared/pagination.js';
import { EMPLOYMENT_TYPES, GENDERS, LIFECYCLE_STATUSES } from './employee.model.js';

const name = (label, required = true) =>
  required ? z.string().trim().min(1, `${label} is required`).max(60) : z.string().trim().max(60);
const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));
const optionalEmail = z.union([z.literal(''), email]);
const phone = z.union([z.literal(''), z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number')]);

const address = z
  .object({
    line1: z.string().trim().max(200),
    line2: z.string().trim().max(200),
    city: z.string().trim().max(100),
    state: z.string().trim().max(100),
    postalCode: z.string().trim().max(20),
    country: z.string().trim().max(100),
  })
  .partial();

const emergencyContact = z
  .object({ name: z.string().trim().max(120), relationship: z.string().trim().max(60), phone })
  .partial();

const personalFields = {
  personalEmail: optionalEmail,
  phone,
  dateOfBirth: dateOnly.nullable(),
  gender: z.enum(GENDERS).nullable(),
  currentAddress: address,
  permanentAddress: address,
  emergencyContact,
};

const employmentFields = {
  departmentId: objectId,
  designationId: objectId,
  reportingManagerId: objectId.nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  workLocation: z.string().trim().max(120),
  shiftId: objectId.nullable(),
};

export const createEmployeeSchema = z
  .object({
    firstName: name('First name'),
    middleName: name('Middle name', false).default(''),
    lastName: name('Last name'),
    workEmail: email,
    ...Object.fromEntries(Object.entries(personalFields).map(([k, v]) => [k, v.optional()])),
    ...employmentFields,
    reportingManagerId: objectId.nullable().default(null),
    workLocation: employmentFields.workLocation.default(''),
    shiftId: objectId.nullable().default(null),
    joiningDate: dateOnly,
    probationEndDate: dateOnly.nullable().default(null),
  })
  .refine((v) => !v.probationEndDate || v.probationEndDate > v.joiningDate, {
    path: ['probationEndDate'],
    message: 'Probation must end after the joining date',
  });

// HR edit. Org changes may carry the date they take effect (for employment history).
export const updateEmployeeSchema = z
  .object({
    firstName: name('First name'),
    middleName: name('Middle name', false),
    lastName: name('Last name'),
    workEmail: email,
    ...personalFields,
    ...employmentFields,
    joiningDate: dateOnly,
    probationEndDate: dateOnly.nullable(),
    effectiveDate: dateOnly,
  })
  .partial()
  .refine((v) => Object.keys(v).some((k) => k !== 'effectiveDate'), 'Provide at least one field to update');

/** Fields an employee may change on their own profile without approval (DECISIONS E3). */
export const selfUpdateSchema = z
  .object({ personalEmail: optionalEmail, phone, currentAddress: address, emergencyContact })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const lifecycleSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('activate'), effectiveDate: dateOnly, note: z.string().trim().max(500).default('') }),
  z.object({
    action: z.literal('start_notice'),
    effectiveDate: dateOnly,
    lastWorkingDate: dateOnly,
    reason: z.string().trim().max(500).default(''),
  }),
  z.object({ action: z.literal('withdraw_notice'), effectiveDate: dateOnly, note: z.string().trim().max(500).default('') }),
  z.object({ action: z.literal('exit'), effectiveDate: dateOnly, reason: z.string().trim().min(2, 'Give a reason').max(500) }),
]);

export const probationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm'), effectiveDate: dateOnly, note: z.string().trim().max(500).default('') }),
  z.object({ action: z.literal('extend'), newEndDate: dateOnly, note: z.string().trim().min(2, 'Give a reason').max(500) }),
]);

const digits = (min, max, label) => z.string().trim().regex(new RegExp(`^\\d{${min},${max}}$`), label);

export const sensitiveSchema = z
  .object({
    bank: z
      .object({
        accountHolderName: z.string().trim().max(120),
        bankName: z.string().trim().max(120),
        branch: z.string().trim().max(120),
        ifsc: z.union([z.literal(''), z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC, e.g. HDFC0001234')]),
        accountNumber: z.union([z.literal(''), digits(9, 18, 'Account number must be 9–18 digits')]),
      })
      .partial(),
    pan: z.union([z.literal(''), z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN, e.g. ABCDE1234F')]),
    aadhaarLast4: z.union([z.literal(''), digits(4, 4, 'Enter only the last 4 digits')]),
    uan: z.union([z.literal(''), digits(12, 12, 'UAN must be 12 digits')]),
  })
  .partial();

export const sensitiveQuery = z.strictObject({ reveal: z.enum(['true', 'false']).optional() });

export const listEmployeesQuery = listQuerySchema(['fullName', 'employeeCode', 'joiningDate'], {
  department: objectId.optional(),
  designation: objectId.optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  status: z.enum(LIFECYCLE_STATUSES).optional(),
  manager: objectId.optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});
