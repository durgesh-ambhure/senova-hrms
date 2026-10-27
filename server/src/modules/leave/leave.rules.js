import { eachDate } from '../../shared/dates.js';
import { UNITS_PER_DAY } from './leave.models.js';

/**
 * Pure leave rules (no database). Units are half days: a full day = 2, a half day = 1.
 */

/**
 * The days a request charges. Non-working days (weekly offs, holidays) are skipped unless the
 * sandwich rule is enabled. A request may start in the second half of its first day and/or end
 * after the first half of its last day.
 */
export function computeLeaveSlots({ startDate, endDate, startSession = 'full', endSession = 'full', calendar, countNonWorkingDays = false }) {
  const slots = [];
  for (const date of eachDate(startDate, endDate)) {
    if (!countNonWorkingDays && !calendar.get(date)?.working) continue;
    const secondHalfOnly = date === startDate && startSession === 'second_half';
    const firstHalfOnly = date === endDate && endSession === 'first_half';
    if (secondHalfOnly && firstHalfOnly) continue; // invalid on a single day; rejected by validation
    const half = secondHalfOnly ? 'second' : firstHalfOnly ? 'first' : 'full';
    slots.push({ date, half, units: half === 'full' ? UNITS_PER_DAY : 1 });
  }
  return slots;
}

const halvesOf = (half) => (half === 'full' ? ['first', 'second'] : [half]);

/** Do two sets of slots claim the same half of any day? */
export function slotsOverlap(a, b) {
  const taken = new Set(a.flatMap((s) => halvesOf(s.half).map((h) => `${s.date}:${h}`)));
  return b.some((s) => halvesOf(s.half).some((h) => taken.has(`${s.date}:${h}`)));
}

/**
 * Units accrued in `year` up to `asOf` ("YYYY-MM-DD"). Pro-rated from the joining month
 * (the joining month counts in full). Provisional policy — see DECISIONS A8.
 *   annual  → the year's pro-rated quota is available from the first eligible month
 *   monthly → quota / 12 credited at the start of each eligible month up to `asOf`
 * Uses floor on the cumulative total, so rounding never drifts across months.
 */
export function accruedUnits({ type, year, joiningDate, asOf }) {
  if (type.unlimited || !type.annualQuotaDays) return 0;
  const quota = Math.round(type.annualQuotaDays * UNITS_PER_DAY);
  const [joinY, joinM] = joiningDate.split('-').map(Number);
  if (joinY > year) return 0;
  const firstMonth = joinY === year ? joinM : 1;
  const [asY, asM] = asOf.split('-').map(Number);
  let months;
  if (type.accrual === 'annual') months = asY < year ? 0 : 13 - firstMonth;
  else {
    const lastMonth = asY > year ? 12 : asY < year ? 0 : asM;
    months = Math.max(0, lastMonth - firstMonth + 1);
  }
  return Math.floor((quota * months) / 12);
}

export const availableUnits = (b) => b.openingUnits + b.accruedUnits + b.adjustedUnits - b.usedUnits - b.pendingUnits;

/** Carry-forward into the next year: what was left, capped by the type's maximum. */
export function carryForwardUnits(type, previousBalance) {
  if (!previousBalance || type.unlimited || !type.carryForwardMaxDays) return 0;
  const left = availableUnits({ ...previousBalance, pendingUnits: 0 });
  return Math.max(0, Math.min(left, Math.round(type.carryForwardMaxDays * UNITS_PER_DAY)));
}

export const unitsToDays = (units) => units / UNITS_PER_DAY;
