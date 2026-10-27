/**
 * Non-production time & leave setup: a default shift, placeholder leave types (DECISIONS A7 —
 * replace with the company's real policy), the fixed-date national holidays for the current year,
 * and two timesheet projects. Each part runs only if that data does not exist yet.
 * Festival holidays (Holi, Diwali, Eid…) move every year and must be entered by HR.
 */
import { Shift } from '../src/modules/attendance/shift.model.js';
import { LeaveType } from '../src/modules/leave/leave.models.js';
import { Holiday } from '../src/modules/holidays/holiday.model.js';
import { Project } from '../src/modules/timesheets/timesheet.models.js';
import { parseDateOnly } from '../src/shared/dates.js';

const LEAVE_TYPES = [
  { name: 'Casual leave', code: 'CL', annualQuotaDays: 12, accrual: 'monthly', color: '#3459ad' },
  { name: 'Sick leave', code: 'SL', annualQuotaDays: 12, accrual: 'annual', color: '#0d9488' },
  { name: 'Earned leave', code: 'EL', annualQuotaDays: 15, accrual: 'monthly', carryForwardMaxDays: 30, minNoticeDays: 7, availableDuringProbation: false, color: '#b45309' },
  { name: 'Loss of pay', code: 'LOP', paid: false, unlimited: true, annualQuotaDays: 0, color: '#64748b' },
];

export async function seedTimeData() {
  if (!(await Shift.exists({}))) {
    await Shift.create({ name: 'General shift', code: 'GEN', startTime: '09:30', endTime: '18:30', weeklyOffs: [0, 6], isDefault: true });
    console.log('Seeded default shift (09:30–18:30, Sat/Sun off).');
  }
  if (!(await LeaveType.exists({}))) {
    await LeaveType.create(LEAVE_TYPES);
    console.log('Seeded placeholder leave types CL / SL / EL / LOP.');
  }
  const year = new Date().getUTCFullYear();
  if (!(await Holiday.exists({ year }))) {
    await Holiday.create([
      { date: parseDateOnly(`${year}-01-26`), name: 'Republic Day', type: 'public' },
      { date: parseDateOnly(`${year}-08-15`), name: 'Independence Day', type: 'public' },
      { date: parseDateOnly(`${year}-10-02`), name: 'Gandhi Jayanti', type: 'public' },
    ]);
    console.log(`Seeded fixed-date national holidays for ${year}. Add festival holidays in Settings → Holidays.`);
  }
  if (!(await Project.exists({}))) {
    await Project.create([
      { name: 'Internal & admin', code: 'INT', description: 'Meetings, training and administration' },
      { name: 'Senova HRMS', code: 'HRMS', description: 'Internal HR platform' },
    ]);
    console.log('Seeded timesheet projects INT / HRMS.');
  }
}
