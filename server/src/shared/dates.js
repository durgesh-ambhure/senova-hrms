import { z } from 'zod';

/**
 * HR dates (joining, birth, exit…) are calendar dates with no time zone. They are stored as
 * midnight UTC and exchanged as "YYYY-MM-DD" strings so they never shift a day across zones.
 */
export function parseDateOnly(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function toDateOnly(date) {
  return date ? new Date(date).toISOString().slice(0, 10) : null;
}

/** Today's calendar date in the given IANA time zone, as "YYYY-MM-DD". */
export function todayIn(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(dateOnly, days) {
  const d = parseDateOnly(dateOnly);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateOnly(d);
}

export function addMonths(dateOnly, months) {
  const d = parseDateOnly(dateOnly);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return toDateOnly(d);
}

/** 0 = Sunday … 6 = Saturday, for a "YYYY-MM-DD" date. */
export function weekdayOf(dateOnly) {
  return parseDateOnly(dateOnly).getUTCDay();
}

/** Inclusive list of "YYYY-MM-DD" dates from `from` to `to`. */
export function eachDate(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Monday of the ISO week containing `dateOnly`. */
export function weekStartOf(dateOnly) {
  return addDays(dateOnly, -((weekdayOf(dateOnly) + 6) % 7));
}

export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

const partsFormatter = new Map();
function formatterFor(timeZone) {
  if (!partsFormatter.has(timeZone)) {
    partsFormatter.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    );
  }
  return partsFormatter.get(timeZone);
}

/** Wall-clock parts of an instant in a time zone: { date: 'YYYY-MM-DD', time: 'HH:mm', minutes }. */
export function zonedParts(instant, timeZone) {
  const p = Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

function offsetMs(instant, timeZone) {
  const p = Object.fromEntries(formatterFor(timeZone).formatToParts(instant).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which the wall clock in `timeZone` shows `dateOnly` `hh:mm` (DST-safe). */
export function zonedToUtc(dateOnly, hhmm, timeZone) {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetMs(new Date(guess), timeZone);
  const second = offsetMs(new Date(guess - first), timeZone);
  return new Date(guess - (first === second ? first : second));
}

export const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** zod: "YYYY-MM-DD" that is a real calendar date. */
export const dateOnly = z.iso.date('Use the format YYYY-MM-DD');
export const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use the format YYYY-MM');
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:mm');
