import { addDays, minutesOf, zonedParts, zonedToUtc } from '../../shared/dates.js';
import { isOvernight } from './shift.model.js';

/**
 * Pure attendance rules — no database access, so they are easy to test exhaustively.
 * All instants are Dates; `tz` is the company IANA time zone.
 */

/** Scheduled start and end instants of a shift on `date`. */
export function shiftWindow(shift, date, tz) {
  const start = zonedToUtc(date, shift.startTime, tz);
  const end = zonedToUtc(isOvernight(shift) ? addDays(date, 1) : date, shift.endTime, tz);
  return { start, end };
}

/**
 * Which attendance date a punch at `instant` belongs to. For overnight shifts, punches between
 * midnight and (shift end + cutoff hours) belong to the shift that started the previous day.
 */
export function attendanceDateFor(instant, shift, tz, cutoffHours) {
  const local = zonedParts(instant, tz);
  if (isOvernight(shift) && local.minutes < minutesOf(shift.endTime) + cutoffHours * 60) return addDays(local.date, -1);
  return local.date;
}

const minutesBetween = (a, b) => Math.max(0, Math.floor((b.getTime() - a.getTime()) / 60000));

/**
 * Computes durations and the day status from punches.
 *  worked = (check-out − check-in) − breaks
 *  late   = minutes after shift start, only when beyond the grace period
 *  early  = minutes before shift end, only when beyond the grace period
 *  status = present ≥ full-day minutes; half_day ≥ half-day minutes; else absent;
 *           incomplete while there is no check-out.
 */
export function computeAttendance({ shift, date, checkIn, checkOut, breaks = [], tz, overtimeEnabled = false }) {
  const { start, end } = shiftWindow(shift, date, tz);
  const result = { workedMinutes: 0, breakMinutes: 0, lateByMinutes: 0, earlyByMinutes: 0, overtimeMinutes: 0, status: 'incomplete' };
  if (!checkIn) return { ...result, status: 'absent' };

  const late = minutesBetween(start, checkIn);
  result.lateByMinutes = late > shift.lateGraceMinutes ? late : 0;
  if (!checkOut) return result;

  result.breakMinutes = breaks.filter((b) => b.end).reduce((sum, b) => sum + minutesBetween(b.start, b.end), 0);
  result.workedMinutes = Math.max(0, minutesBetween(checkIn, checkOut) - result.breakMinutes);
  const early = minutesBetween(checkOut, end);
  result.earlyByMinutes = early > shift.earlyLeaveGraceMinutes ? early : 0;
  if (overtimeEnabled) result.overtimeMinutes = Math.max(0, result.workedMinutes - shift.fullDayMinutes);
  result.status = result.workedMinutes >= shift.fullDayMinutes ? 'present' : result.workedMinutes >= shift.halfDayMinutes ? 'half_day' : 'absent';
  return result;
}

/** Credit, in half-day units, that a recorded day contributes (present 2, half-day 1, otherwise 0). */
export const attendanceUnits = (status) => (status === 'present' ? 2 : status === 'half_day' ? 1 : 0);
