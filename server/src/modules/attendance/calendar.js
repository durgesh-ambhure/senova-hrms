import { appliesToLocation, holidaysBetween } from '../holidays/holiday.service.js';
import { NON_WORKING_HOLIDAY_TYPES } from '../holidays/holiday.model.js';
import { eachDate, toDateOnly, weekdayOf } from '../../shared/dates.js';

/**
 * Working-day calendar for one employee between two dates: weekly offs come from their shift,
 * holidays from the company calendar filtered by work location. Optional holidays are working days.
 * Returns Map<"YYYY-MM-DD", { weeklyOff, holiday, working }>.
 */
export async function buildWorkCalendar(employee, shift, from, to, holidays) {
  const list = holidays ?? (await holidaysBetween(from, to));
  const byDate = new Map();
  for (const h of list) {
    if (NON_WORKING_HOLIDAY_TYPES.includes(h.type) && appliesToLocation(h, employee.workLocation)) byDate.set(toDateOnly(h.date), { name: h.name, type: h.type });
  }
  const offs = new Set(shift.weeklyOffs);
  const calendar = new Map();
  for (const date of eachDate(from, to)) {
    const weeklyOff = offs.has(weekdayOf(date));
    const holiday = byDate.get(date) ?? null;
    calendar.set(date, { weeklyOff, holiday, working: !weeklyOff && !holiday });
  }
  return calendar;
}
