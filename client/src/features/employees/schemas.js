import { z } from 'zod';
import { emailSchema } from '../../lib/passwordPolicy.js';

const optionalDate = z.union([z.literal(''), z.iso.date('Use a valid date')]);
const optionalEmail = z.union([z.literal(''), z.string().trim().pipe(z.email('Enter a valid email address'))]);
export const phoneSchema = z.union([z.literal(''), z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number')]);

const address = z.object({
  line1: z.string().trim().max(200),
  line2: z.string().trim().max(200),
  city: z.string().trim().max(100),
  state: z.string().trim().max(100),
  postalCode: z.string().trim().max(20),
  country: z.string().trim().max(100),
});

export const emptyAddress = { line1: '', line2: '', city: '', state: '', postalCode: '', country: '' };

/** Mirrors the server's create/update validation. The server stays authoritative. */
export const employeeFormSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required').max(60),
    middleName: z.string().trim().max(60),
    lastName: z.string().trim().min(1, 'Last name is required').max(60),
    workEmail: emailSchema,
    personalEmail: optionalEmail,
    phone: phoneSchema,
    dateOfBirth: optionalDate,
    gender: z.string(),
    departmentId: z.string().min(1, 'Choose a department'),
    designationId: z.string().min(1, 'Choose a designation'),
    reportingManager: z.object({ id: z.string(), fullName: z.string() }).nullable(),
    employmentType: z.string().min(1, 'Choose an employment type'),
    workLocation: z.string().trim().max(120),
    shiftId: z.string(),
    joiningDate: z.iso.date('Joining date is required'),
    probationEndDate: optionalDate,
    effectiveDate: optionalDate,
    currentAddress: address,
    permanentAddress: address,
    emergencyContact: z.object({ name: z.string().trim().max(120), relationship: z.string().trim().max(60), phone: phoneSchema }),
  })
  .refine((v) => !v.probationEndDate || v.probationEndDate > v.joiningDate, {
    path: ['probationEndDate'],
    message: 'Probation must end after the joining date',
  });

export const selfProfileSchema = z.object({
  personalEmail: optionalEmail,
  phone: phoneSchema,
  currentAddress: address,
  emergencyContact: z.object({ name: z.string().trim().max(120), relationship: z.string().trim().max(60), phone: phoneSchema }),
});

/** Form values → API payload. On edit, only changed fields are sent. */
export function toEmployeePayload(values, dirtyFields) {
  const map = {
    firstName: values.firstName,
    middleName: values.middleName,
    lastName: values.lastName,
    workEmail: values.workEmail,
    personalEmail: values.personalEmail,
    phone: values.phone,
    dateOfBirth: values.dateOfBirth || null,
    gender: values.gender || null,
    departmentId: values.departmentId,
    designationId: values.designationId,
    reportingManagerId: values.reportingManager?.id ?? null,
    employmentType: values.employmentType,
    workLocation: values.workLocation,
    shiftId: values.shiftId || null,
    joiningDate: values.joiningDate,
    probationEndDate: values.probationEndDate || null,
    currentAddress: values.currentAddress,
    permanentAddress: values.permanentAddress,
    emergencyContact: values.emergencyContact,
  };
  if (!dirtyFields) return map;
  const formKeyFor = { reportingManagerId: 'reportingManager' };
  const payload = Object.fromEntries(Object.entries(map).filter(([k]) => dirtyFields[formKeyFor[k] ?? k]));
  if (values.effectiveDate) payload.effectiveDate = values.effectiveDate;
  return payload;
}
