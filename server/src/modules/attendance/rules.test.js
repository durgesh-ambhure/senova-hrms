import { describe, expect, it } from 'vitest';
import { attendanceDateFor, computeAttendance, shiftWindow } from './attendance.rules.js';
import { accruedUnits, availableUnits, carryForwardUnits, computeLeaveSlots, slotsOverlap } from '../leave/leave.rules.js';
import { eachDate, monthRange, weekStartOf, zonedParts, zonedToUtc } from '../../shared/dates.js';

const IST = 'Asia/Kolkata';
const day = { name: 'Day', startTime: '09:30', endTime: '18:30', lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15, fullDayMinutes: 480, halfDayMinutes: 240, weeklyOffs: [0, 6] };
const night = { ...day, name: 'Night', startTime: '22:00', endTime: '06:00' };
const at = (date, time, tz = IST) => zonedToUtc(date, time, tz);

describe('time zone helpers', () => {
  it('converts wall-clock time to UTC, including DST zones', () => {
    expect(at('2025-03-03', '09:30').toISOString()).toBe('2025-03-03T04:00:00.000Z');
    // New York: EST (UTC−5) before 9 March 2025, EDT (UTC−4) after.
    expect(at('2025-03-07', '09:00', 'America/New_York').toISOString()).toBe('2025-03-07T14:00:00.000Z');
    expect(at('2025-03-10', '09:00', 'America/New_York').toISOString()).toBe('2025-03-10T13:00:00.000Z');
    expect(zonedParts(new Date('2025-03-03T20:00:00Z'), IST)).toMatchObject({ date: '2025-03-04', time: '01:30' });
  });

  it('computes weeks and months', () => {
    expect(weekStartOf('2025-03-05')).toBe('2025-03-03');
    expect(weekStartOf('2025-03-09')).toBe('2025-03-03');
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(eachDate('2025-02-27', '2025-03-02')).toEqual(['2025-02-27', '2025-02-28', '2025-03-01', '2025-03-02']);
  });
});

describe('attendance rules', () => {
  it('assigns overnight punches after midnight to the previous day', () => {
    expect(attendanceDateFor(at('2025-03-04', '02:00'), night, IST, 4)).toBe('2025-03-03');
    expect(attendanceDateFor(at('2025-03-04', '09:59'), night, IST, 4)).toBe('2025-03-03');
    expect(attendanceDateFor(at('2025-03-04', '10:01'), night, IST, 4)).toBe('2025-03-04');
    expect(attendanceDateFor(at('2025-03-04', '02:00'), day, IST, 4)).toBe('2025-03-04');
    const w = shiftWindow(night, '2025-03-03', IST);
    expect(w.end - w.start).toBe(8 * 3600_000);
  });

  it('ignores lateness within the grace period and counts it beyond', () => {
    const base = { shift: day, date: '2025-03-03', tz: IST };
    expect(computeAttendance({ ...base, checkIn: at('2025-03-03', '09:45') }).lateByMinutes).toBe(0);
    expect(computeAttendance({ ...base, checkIn: at('2025-03-03', '09:46') }).lateByMinutes).toBe(16);
    expect(computeAttendance({ ...base, checkIn: at('2025-03-03', '09:00') }).status).toBe('incomplete');
  });

  it('classifies full, half and short days, net of breaks', () => {
    const base = { shift: day, date: '2025-03-03', tz: IST, checkIn: at('2025-03-03', '09:30') };
    const full = computeAttendance({ ...base, checkOut: at('2025-03-03', '18:30'), breaks: [{ start: at('2025-03-03', '13:00'), end: at('2025-03-03', '13:30') }] });
    expect(full).toMatchObject({ workedMinutes: 510, breakMinutes: 30, status: 'present', earlyByMinutes: 0 });
    const half = computeAttendance({ ...base, checkOut: at('2025-03-03', '14:00') });
    expect(half).toMatchObject({ workedMinutes: 270, status: 'half_day', earlyByMinutes: 270 });
    expect(computeAttendance({ ...base, checkOut: at('2025-03-03', '11:00') }).status).toBe('absent');
    expect(computeAttendance({ ...base, checkIn: null }).status).toBe('absent');
  });

  it('computes overtime only when enabled, and handles overnight shifts', () => {
    const input = { shift: night, date: '2025-03-03', tz: IST, checkIn: at('2025-03-03', '22:00'), checkOut: at('2025-03-04', '07:00') };
    expect(computeAttendance(input)).toMatchObject({ workedMinutes: 540, overtimeMinutes: 0, status: 'present' });
    expect(computeAttendance({ ...input, overtimeEnabled: true }).overtimeMinutes).toBe(60);
  });
});

describe('leave rules', () => {
  // Mon 3 Mar – Sun 9 Mar 2025, with Wed 5 Mar a holiday.
  const calendar = new Map(eachDate('2025-03-01', '2025-03-16').map((d) => {
    const wd = new Date(`${d}T00:00Z`).getUTCDay();
    const weeklyOff = wd === 0 || wd === 6;
    const holiday = d === '2025-03-05' ? { name: 'Holi' } : null;
    return [d, { weeklyOff, holiday, working: !weeklyOff && !holiday }];
  }));

  it('skips weekly offs and holidays unless the sandwich rule is on', () => {
    const slots = computeLeaveSlots({ startDate: '2025-03-03', endDate: '2025-03-10', calendar });
    expect(slots.map((s) => s.date)).toEqual(['2025-03-03', '2025-03-04', '2025-03-06', '2025-03-07', '2025-03-10']);
    expect(slots.reduce((s, x) => s + x.units, 0)).toBe(10);
    const sandwich = computeLeaveSlots({ startDate: '2025-03-03', endDate: '2025-03-10', calendar, countNonWorkingDays: true });
    expect(sandwich).toHaveLength(8);
  });

  it('handles half days at either end', () => {
    const slots = computeLeaveSlots({ startDate: '2025-03-03', endDate: '2025-03-04', startSession: 'second_half', endSession: 'first_half', calendar });
    expect(slots).toEqual([
      { date: '2025-03-03', half: 'second', units: 1 },
      { date: '2025-03-04', half: 'first', units: 1 },
    ]);
    expect(computeLeaveSlots({ startDate: '2025-03-03', endDate: '2025-03-03', endSession: 'first_half', calendar })).toEqual([{ date: '2025-03-03', half: 'first', units: 1 }]);
  });

  it('detects overlaps by half day', () => {
    const morning = [{ date: '2025-03-03', half: 'first', units: 1 }];
    const afternoon = [{ date: '2025-03-03', half: 'second', units: 1 }];
    const full = [{ date: '2025-03-03', half: 'full', units: 2 }];
    expect(slotsOverlap(morning, afternoon)).toBe(false);
    expect(slotsOverlap(morning, full)).toBe(true);
    expect(slotsOverlap(full, [{ date: '2025-03-04', half: 'full', units: 2 }])).toBe(false);
  });

  it('accrues monthly or annually, pro-rated from the joining month, without drift', () => {
    const monthly = { annualQuotaDays: 15, accrual: 'monthly' };
    expect(accruedUnits({ type: monthly, year: 2025, joiningDate: '2020-01-10', asOf: '2025-01-01' })).toBe(2); // 30 × 1/12 = 2.5 → 2
    expect(accruedUnits({ type: monthly, year: 2025, joiningDate: '2020-01-10', asOf: '2025-02-01' })).toBe(5);
    expect(accruedUnits({ type: monthly, year: 2025, joiningDate: '2020-01-10', asOf: '2025-12-31' })).toBe(30);
    expect(accruedUnits({ type: monthly, year: 2025, joiningDate: '2020-01-10', asOf: '2026-03-01' })).toBe(30);
    expect(accruedUnits({ type: monthly, year: 2025, joiningDate: '2025-07-20', asOf: '2025-08-15' })).toBe(5); // Jul + Aug
    const annual = { annualQuotaDays: 12, accrual: 'annual' };
    expect(accruedUnits({ type: annual, year: 2025, joiningDate: '2025-04-01', asOf: '2025-04-02' })).toBe(18); // 9 months of 24
    expect(accruedUnits({ type: annual, year: 2026, joiningDate: '2025-04-01', asOf: '2025-12-31' })).toBe(0);
    expect(accruedUnits({ type: { unlimited: true, annualQuotaDays: 0 }, year: 2025, joiningDate: '2020-01-01', asOf: '2025-06-01' })).toBe(0);
  });

  it('caps carry-forward and computes availability', () => {
    const prev = { openingUnits: 0, accruedUnits: 24, adjustedUnits: 0, usedUnits: 6, pendingUnits: 4 };
    expect(availableUnits(prev)).toBe(14);
    expect(carryForwardUnits({ carryForwardMaxDays: 5 }, prev)).toBe(10);
    expect(carryForwardUnits({ carryForwardMaxDays: 30 }, prev)).toBe(18);
    expect(carryForwardUnits({ carryForwardMaxDays: 0 }, prev)).toBe(0);
  });
});
