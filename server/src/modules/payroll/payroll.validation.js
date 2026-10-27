import { z } from 'zod';
import { objectId } from '../users/user.validation.js';
import { dateOnly, monthString } from '../../shared/dates.js';
import { rupees, rupeesToPaise } from '../../shared/money.js';

/** "12.5" (percent) → 1250 basis points, exactly. */
export const percent = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const bp = rupeesToPaise(v);
  if (bp === null || bp > 10_000) {
    ctx.addIssue({ code: 'custom', message: 'Enter a percentage between 0 and 100 (up to 2 decimals)' });
    return z.NEVER;
  }
  return bp;
});

const slab = z.object({ from: rupees, to: rupees.nullable(), monthly: rupees, february: rupees.nullable().optional() });

export const ruleSetBody = z
  .object({
    effectiveFrom: monthString,
    template: z.object({ basicPercentOfGross: percent, hraPercentOfBasic: percent }).partial(),
    pf: z.object({ enabled: z.boolean(), employeePercent: percent, employerPercent: percent, epsPercent: percent, wageCeiling: rupees, epsCeiling: rupees }).partial(),
    esi: z.object({ enabled: z.boolean(), employeePercent: percent, employerPercent: percent, wageLimit: rupees }).partial(),
    pt: z.object({ enabled: z.boolean(), state: z.string().trim().max(10), slabs: z.array(slab).max(20) }).partial(),
    gratuity: z.object({ percentOfBasic: percent }).partial(),
    lop: z.object({ includeAbsence: z.boolean() }).partial(),
    notes: z.string().trim().max(2000),
  })
  .partial();

export const verifyBody = z.object({ reference: z.string().trim().min(5, 'Say who confirmed the values and how (e.g. "ABC & Co, email 12 Oct")').max(500) });

export const revisionBody = z.object({
  effectiveFrom: dateOnly,
  annualCtc: rupees.refine((v) => v > 0, 'Enter the annual CTC'),
  basicPercentOfGross: percent.nullable().optional(),
  hraPercentOfBasic: percent.nullable().optional(),
  fixedAllowances: z
    .array(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, '2–10 letters/digits'), label: z.string().trim().min(2).max(60), monthly: rupees, pfWage: z.boolean().default(false) }))
    .max(10)
    .default([]),
  pfApplicable: z.boolean().default(true),
  pfOnFullWage: z.boolean().default(false),
  reason: z.string().trim().max(500).default(''),
});
export const previewBody = revisionBody.omit({ effectiveFrom: true, reason: true }).extend({ effectiveFrom: dateOnly.optional() });

export const salaryListQuery = z.strictObject({
  search: z.string().trim().max(100).optional(),
  department: objectId.optional(),
  missing: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const runBody = z.object({
  month: monthString,
  type: z.enum(['regular', 'supplementary']).default('regular'),
  reason: z.string().trim().max(500).default(''),
  payDate: dateOnly.nullable().optional(),
});
export const runListQuery = z.strictObject({ month: monthString.optional(), status: z.string().max(20).optional(), year: z.coerce.number().int().min(2000).max(2100).optional() });
export const adjustmentBody = z.object({
  employeeId: objectId,
  kind: z.enum(['tds', 'earning', 'deduction']),
  label: z.string().trim().min(2).max(80).optional(),
  amount: rupees.refine((v) => v > 0, 'Enter an amount above zero'),
  reason: z.string().trim().max(300).default(''),
});
export const tdsImportBody = z.object({
  rows: z
    .array(z.object({ employeeCode: z.string().trim().min(1).max(30), amount: rupees }))
    .min(1)
    .max(2000),
});
export const noteBody = z.object({ note: z.string().trim().max(500).default('') });
export const entryListQuery = z.strictObject({ search: z.string().trim().max(100).optional(), issues: z.enum(['true', 'false']).optional() });
export const payslipListQuery = z.strictObject({ employee: objectId.optional(), month: monthString.optional(), year: z.coerce.number().int().min(2000).max(2100).optional() });
export const reportQuery = z.strictObject({ month: monthString });
export const historyQuery = z.strictObject({ from: monthString, to: monthString });
