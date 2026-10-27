import { z } from 'zod';

const text = (max) => z.string().trim().max(max);

const isValidTimezone = (tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const policiesSchema = z
  .object({
    attendance: z
      .object({
        correctionWindowDays: z.number().int().min(1).max(60),
        overtimeEnabled: z.boolean(),
        overnightCutoffHours: z.number().int().min(0).max(8),
      })
      .partial(),
    leave: z
      .object({
        countNonWorkingDays: z.boolean(),
        backdatedDays: z.number().int().min(0).max(90),
        maxAdvanceDays: z.number().int().min(1).max(730),
      })
      .partial(),
  })
  .partial();

export const updateCompanySchema = z
  .object({
    legalName: text(200).min(2).optional(),
    displayName: text(80).min(2).optional(),
    contactEmail: z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email())]).optional(),
    phone: text(30).optional(),
    website: z.union([z.literal(''), z.url()]).optional(),
    address: z
      .object({
        line1: text(200),
        line2: text(200),
        city: text(100),
        state: text(100),
        postalCode: text(20),
        country: text(100),
      })
      .partial()
      .optional(),
    timezone: z.string().refine(isValidTimezone, 'Unknown timezone').optional(),
    dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).optional(),
    financialYearStartMonth: z.number().int().min(1).max(12).optional(),
    policies: policiesSchema.optional(),
    employeeCodePrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2,10}$/, '2–10 letters')
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
