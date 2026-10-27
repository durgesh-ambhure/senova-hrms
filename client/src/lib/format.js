const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(value) {
  return value ? dateFmt.format(new Date(value)) : '—';
}

export function formatDateTime(value) {
  return value ? dateTimeFmt.format(new Date(value)) : '—';
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export function humanize(value = '') {
  return value.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' });
export function formatTime(value) {
  return value ? timeFmt.format(new Date(value)) : '—';
}

/** 450 → "7h 30m" */
export function formatMinutes(minutes) {
  if (!minutes) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Leave and attendance amounts are half-day units: 3 → "1.5 days". */
export function formatUnits(units) {
  if (units === null || units === undefined) return 'Unlimited';
  const days = units / 2;
  return `${days} ${Math.abs(days) === 1 ? 'day' : 'days'}`;
}

/** "YYYY-MM-DD" helpers that never shift across time zones. */
export const addDaysTo = (dateOnly, n) => {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const weekdayOf = (dateOnly) => new Date(`${dateOnly}T00:00:00Z`).getUTCDay();
export const mondayOf = (dateOnly) => addDaysTo(dateOnly, -((weekdayOf(dateOnly) + 6) % 7));
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const formatDayShort = (dateOnly) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${dateOnly}T00:00:00Z`));

const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
/** Rupee amounts from the API (already converted from paise). */
export const formatINR = (rupees) => (rupees === null || rupees === undefined ? '—' : inrFmt.format(rupees));

export const formatMonth = (month) => (month ? new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`)) : '—');
