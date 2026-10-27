import { PayrollRun } from './payroll.models.js';

/**
 * Has payroll for this month been finalized? Attendance and leave that fed a finalized payroll are
 * locked (DECISIONS A16): corrections go through a supplementary payroll run instead.
 */
export async function isMonthFinalized(month, session) {
  return Boolean(await PayrollRun.exists({ month, type: 'regular', status: 'finalized' }).session(session ?? null));
}

export async function finalizedMonthsIn(months, session) {
  if (!months.length) return [];
  return PayrollRun.distinct('month', { month: { $in: months }, type: 'regular', status: 'finalized' }).session(session ?? null);
}
