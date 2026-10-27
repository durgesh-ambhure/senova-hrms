import { ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { useMonthlySummary } from './api.js';
import { ATTENDANCE_KIND, WEEKDAYS } from '../../lib/labels.js';
import { formatMinutes, formatTime, formatUnits, weekdayOf } from '../../lib/format.js';
import { Card, CardHeader, ErrorState, Spinner } from '../../components/ui/index.js';

const KIND_STYLES = {
  present: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  half_day: 'bg-amber-50 text-amber-800 ring-amber-200',
  absent: 'bg-red-50 text-red-700 ring-red-200',
  incomplete: 'bg-red-50 text-red-700 ring-red-300',
  leave: 'bg-brand-50 text-brand-800 ring-brand-200',
  holiday: 'bg-accent-50 text-accent-700 ring-accent-100',
  weekly_off: 'bg-slate-50 text-slate-500 ring-slate-200',
  today: 'bg-white text-brand-800 ring-brand-400',
  upcoming: 'bg-white text-slate-400 ring-slate-100',
  not_employed: 'bg-slate-50 text-slate-300 ring-slate-100',
};

const shiftMonth = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};
const monthLabel = (month) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));

function Stat({ label, value, tone = 'text-slate-900' }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

/** Month grid of attendance with totals, for one employee (self when `employeeId` is omitted). */
export function MonthCalendar({ employeeId, month, onMonthChange, title = 'This month' }) {
  const q = useMonthlySummary({ month, employee: employeeId });
  const days = q.data?.days ?? [];
  const lead = days.length ? (weekdayOf(days[0].date) + 6) % 7 : 0;

  return (
    <Card>
      <CardHeader
        title={title}
        description={q.data ? `${q.data.employee.fullName} · ${q.data.shift.name} (${q.data.shift.startTime}–${q.data.shift.endTime})` : undefined}
        actions={
          <div className="flex items-center gap-1">
            <button type="button" className="rounded-md p-1.5 hover:bg-slate-100" onClick={() => onMonthChange(shiftMonth(month, -1))} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-32 text-center text-sm font-medium text-slate-800">{monthLabel(month)}</span>
            <button type="button" className="rounded-md p-1.5 hover:bg-slate-100" onClick={() => onMonthChange(shiftMonth(month, 1))} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </button>
            {q.isFetching && <Spinner className="ml-1 h-4 w-4 text-brand-600" />}
          </div>
        }
      />
      {q.isLoading ? (
        <div className="flex justify-center py-12 text-brand-700">
          <Spinner label="Loading attendance" />
        </div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : (
        <div className="space-y-5 p-5">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label="Working days" value={q.data.totals.workingDays} />
            <Stat label="Present" value={formatUnits(q.data.totals.presentUnits)} tone="text-emerald-700" />
            <Stat label="Paid leave" value={formatUnits(q.data.totals.paidLeaveUnits)} tone="text-brand-700" />
            <Stat label="Unpaid leave" value={formatUnits(q.data.totals.unpaidLeaveUnits)} />
            <Stat label="Absent" value={formatUnits(q.data.totals.absentUnits)} tone={q.data.totals.absentUnits ? 'text-red-600' : undefined} />
            <Stat label="Missing punches" value={q.data.totals.incompleteDays} tone={q.data.totals.incompleteDays ? 'text-red-600' : undefined} />
            <Stat label="Late arrivals" value={q.data.totals.lateDays} />
          </dl>
          <div>
            <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400" aria-hidden="true">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <div key={d}>{WEEKDAYS[d]}</div>
              ))}
            </div>
            <ol className="mt-1.5 grid grid-cols-7 gap-1.5" aria-label={`Attendance for ${monthLabel(month)}`}>
              {Array.from({ length: lead }, (_, i) => (
                <li key={`lead-${i}`} aria-hidden="true" />
              ))}
              {days.map((d) => {
                const kind = ATTENDANCE_KIND[d.kind] ?? ATTENDANCE_KIND.upcoming;
                const label = d.holiday ?? (d.leave ? d.leave.types.map((t) => t.code).join('+') : kind.label);
                return (
                  <li
                    key={d.date}
                    className={clsx('min-h-16 rounded-lg p-1.5 text-left ring-1 ring-inset sm:min-h-20 sm:p-2', KIND_STYLES[d.kind] ?? KIND_STYLES.upcoming)}
                    title={`${d.date}: ${label}`}
                  >
                    <span className="block text-xs font-semibold">{Number(d.date.slice(8))}</span>
                    <span className="mt-0.5 block truncate text-[10px] font-medium sm:text-[11px]">{label}</span>
                    {d.record?.checkIn && (
                      <span className="hidden text-[10px] text-current opacity-80 sm:block">
                        {formatTime(d.record.checkIn)}–{d.record.checkOut ? formatTime(d.record.checkOut) : '…'}
                      </span>
                    )}
                    {d.record?.workedMinutes > 0 && <span className="hidden text-[10px] opacity-80 sm:block">{formatMinutes(d.record.workedMinutes)}</span>}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </Card>
  );
}
