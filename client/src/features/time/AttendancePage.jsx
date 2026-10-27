import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Coffee, LogIn, LogOut, PencilLine } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useAttendanceMutations, useCorrections, useMyToday, useTeamToday } from './api.js';
import { MonthCalendar } from './MonthCalendar.jsx';
import { applyFieldErrors } from '../../lib/api.js';
import { REQUEST_STATUS } from '../../lib/labels.js';
import { addDaysTo, formatDate, formatMinutes, formatTime, localToday } from '../../lib/format.js';
import { Alert, Badge, Button, Card, CardHeader, DataTable, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Select, TabPanel, Tabs, Textarea, useToast } from '../../components/ui/index.js';

const currentMonth = () => localToday().slice(0, 7);

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function TodayCard({ onRequestCorrection }) {
  const toast = useToast();
  const q = useMyToday();
  const m = useAttendanceMutations();
  const now = useNow();

  if (q.isLoading) return <Card className="p-6"><PageLoader label="Loading today" /></Card>;
  if (q.error) return <Card><ErrorState error={q.error} onRetry={q.refetch} /></Card>;
  const { record, shift, day, openRecord, canPunch } = q.data;
  const onBreak = record?.onBreak;
  const elapsed = record?.checkIn && !record.checkOut ? Math.floor((now - new Date(record.checkIn)) / 60000) - (record.breakMinutes ?? 0) : null;

  const run = async (mutation, message) => {
    try {
      await mutation.mutateAsync();
      toast.success(message);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const busy = m.checkIn.isPending || m.checkOut.isPending || m.startBreak.isPending || m.endBreak.isPending;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-6 bg-gradient-to-r from-brand-900 to-brand-700 px-6 py-6 text-white">
        <div>
          <p className="text-sm text-brand-200">
            {formatDate(q.data.date)} · {shift.name} {shift.startTime}–{shift.endTime}
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {record?.checkOut ? formatMinutes(record.workedMinutes) : elapsed !== null ? formatMinutes(Math.max(0, elapsed)) : '—'}
          </p>
          <p className="mt-1 text-sm text-brand-100">
            {record?.checkOut
              ? `Checked in ${formatTime(record.checkIn)}, out ${formatTime(record.checkOut)}`
              : record?.checkIn
                ? `Checked in at ${formatTime(record.checkIn)}${onBreak ? ' · on a break' : ''}${record.lateByMinutes ? ` · ${record.lateByMinutes} min late` : ''}`
                : day?.holiday
                  ? `Holiday: ${day.holiday.name}`
                  : day?.weeklyOff
                    ? 'Weekly off'
                    : 'Not checked in yet'}
          </p>
        </div>
        {canPunch && (
          <div className="flex flex-wrap gap-2">
            {!record?.checkIn && (
              <Button className="bg-white text-brand-900 hover:bg-brand-50" loading={busy} onClick={() => run(m.checkIn, 'Checked in')}>
                <LogIn className="h-4 w-4" aria-hidden="true" /> Check in
              </Button>
            )}
            {record?.checkIn && !record.checkOut && (
              <>
                <Button variant="secondary" disabled={busy} onClick={() => run(onBreak ? m.endBreak : m.startBreak, onBreak ? 'Break ended' : 'Break started')}>
                  <Coffee className="h-4 w-4" aria-hidden="true" /> {onBreak ? 'End break' : 'Start break'}
                </Button>
                <Button className="bg-white text-brand-900 hover:bg-brand-50" loading={busy} onClick={() => run(m.checkOut, 'Checked out')}>
                  <LogOut className="h-4 w-4" aria-hidden="true" /> Check out
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {openRecord && (
        <div className="border-t border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900">
          <AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden="true" />
          You didn't check out on {formatDate(openRecord.date)}.{' '}
          <button type="button" className="font-medium underline" onClick={() => onRequestCorrection(openRecord.date)}>
            Request a correction
          </button>
        </div>
      )}
    </Card>
  );
}

const correctionSchema = z
  .object({
    date: z.iso.date('Choose a date'),
    checkIn: z.string().regex(/^\d{2}:\d{2}$/, 'Enter a time'),
    checkOut: z.string().regex(/^\d{2}:\d{2}$/, 'Enter a time'),
    reason: z.string().trim().min(5, 'Explain what happened').max(500),
  })
  .refine((v) => v.date <= localToday(), { path: ['date'], message: 'You cannot correct a future day' });

function CorrectionModal({ date, onClose }) {
  const toast = useToast();
  const { requestCorrection } = useAttendanceMutations();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(correctionSchema), defaultValues: { date, checkIn: '09:30', checkOut: '18:30', reason: '' } });
  const onSubmit = handleSubmit(async (values) => {
    try {
      await requestCorrection.mutateAsync(values);
      toast.success('Correction sent for approval');
      onClose();
    } catch (err) {
      if (!applyFieldErrors(err, setError)) toast.error(err.message);
    }
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Request attendance correction"
      description="Your manager or HR reviews it. A check-out earlier than check-in means the shift ran past midnight."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="correction-form" loading={requestCorrection.isPending}>
            Send request
          </Button>
        </>
      }
    >
      <form id="correction-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Date" type="date" max={localToday()} className="sm:col-span-2" error={errors.date?.message} {...register('date')} />
        <Input label="Check-in" type="time" error={errors.checkIn?.message} {...register('checkIn')} />
        <Input label="Check-out" type="time" error={errors.checkOut?.message} {...register('checkOut')} />
        <Textarea label="Reason" className="sm:col-span-2" required error={errors.reason?.message} {...register('reason')} />
      </form>
    </Modal>
  );
}

function CorrectionsTable({ scope }) {
  const toast = useToast();
  const q = useCorrections({ scope, status: scope === 'approvals' ? 'pending' : undefined });
  const m = useAttendanceMutations();
  const [reviewing, setReviewing] = useState(null);
  const [note, setNote] = useState('');

  const decide = async (decision) => {
    try {
      await m.reviewCorrection.mutateAsync({ id: reviewing.id, decision, note });
      toast.success(decision === 'approved' ? 'Correction approved' : 'Correction rejected');
      setReviewing(null);
      setNote('');
    } catch (err) {
      toast.error(err.details?.[0]?.message ?? err.message);
    }
  };

  const columns = [
    ...(scope === 'approvals' ? [{ key: 'employee', header: 'Employee', render: (c) => <span className="font-medium text-slate-900">{c.employee.fullName}</span> }] : []),
    { key: 'date', header: 'Date', className: 'whitespace-nowrap', render: (c) => formatDate(c.date) },
    { key: 'requested', header: 'Requested', className: 'whitespace-nowrap', render: (c) => `${formatTime(c.requestedCheckIn)} – ${formatTime(c.requestedCheckOut)}` },
    { key: 'original', header: 'Recorded', className: 'whitespace-nowrap', render: (c) => (c.original?.checkIn ? `${formatTime(c.original.checkIn)} – ${c.original.checkOut ? formatTime(c.original.checkOut) : '…'}` : 'No punch') },
    { key: 'reason', header: 'Reason', render: (c) => <span className="line-clamp-2">{c.reason}</span> },
    { key: 'status', header: 'Status', render: (c) => <Badge tone={REQUEST_STATUS[c.status].tone}>{REQUEST_STATUS[c.status].label}</Badge> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (c) =>
        c.status !== 'pending' ? (
          c.reviewNote && <span className="text-xs text-slate-500">“{c.reviewNote}”</span>
        ) : scope === 'approvals' ? (
          <Button size="sm" variant="secondary" onClick={() => setReviewing(c)}>
            Review
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => m.cancelCorrection.mutateAsync(c.id).then(() => toast.success('Request withdrawn'), (e) => toast.error(e.message))}>
            Withdraw
          </Button>
        ),
    },
  ];

  return (
    <>
      <DataTable
        caption={scope === 'approvals' ? 'Corrections awaiting review' : 'My correction requests'}
        columns={columns}
        rows={q.data}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={q.refetch}
        empty={<EmptyState icon={PencilLine} title={scope === 'approvals' ? 'Nothing to review' : 'No correction requests'} />}
      />
      {reviewing && (
        <Modal
          open
          onClose={() => setReviewing(null)}
          title={`Correction for ${reviewing.employee.fullName}`}
          description={`${formatDate(reviewing.date)}: ${formatTime(reviewing.requestedCheckIn)} – ${formatTime(reviewing.requestedCheckOut)}`}
          size="sm"
          footer={
            <>
              <Button variant="danger" onClick={() => decide('rejected')} loading={m.reviewCorrection.isPending}>
                Reject
              </Button>
              <Button onClick={() => decide('approved')} loading={m.reviewCorrection.isPending}>
                Approve
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-slate-700">“{reviewing.reason}”</p>
          <Textarea label="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Modal>
      )}
    </>
  );
}

const TEAM_STATE = {
  checked_in: { label: 'In', tone: 'success' },
  on_break: { label: 'On break', tone: 'warning' },
  checked_out: { label: 'Checked out', tone: 'neutral' },
  not_checked_in: { label: 'Not in', tone: 'danger' },
  on_leave: { label: 'On leave', tone: 'brand' },
  holiday: { label: 'Holiday', tone: 'accent' },
  weekly_off: { label: 'Weekly off', tone: 'neutral' },
};

function TeamTab() {
  const q = useTeamToday();
  const [selected, setSelected] = useState('');
  const [month, setMonth] = useState(currentMonth);
  const columns = [
    {
      key: 'employee',
      header: 'Employee',
      render: (r) => (
        <Link to={`/employees/${r.employee.id}`} className="block">
          <span className="block font-medium text-slate-900 hover:text-brand-700">{r.employee.fullName}</span>
          <span className="block text-xs text-slate-500">{r.employee.department}</span>
        </Link>
      ),
    },
    { key: 'state', header: 'Status', render: (r) => <Badge tone={TEAM_STATE[r.state].tone}>{r.leave ? `${r.leave.type}${r.leave.half !== 'full' ? ' (half)' : ''}` : r.holiday ?? TEAM_STATE[r.state].label}</Badge> },
    { key: 'in', header: 'In', className: 'whitespace-nowrap', render: (r) => formatTime(r.checkIn) },
    { key: 'out', header: 'Out', className: 'whitespace-nowrap', render: (r) => formatTime(r.checkOut) },
    { key: 'late', header: 'Late', render: (r) => (r.lateByMinutes ? <span className="text-amber-700">{r.lateByMinutes} min</span> : '—') },
  ];
  const counts = (q.data ?? []).reduce((acc, r) => ({ ...acc, [r.state]: (acc[r.state] ?? 0) + 1 }), {});
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Today"
          description={q.data ? `${(counts.checked_in ?? 0) + (counts.on_break ?? 0) + (counts.checked_out ?? 0)} in · ${counts.on_leave ?? 0} on leave · ${counts.not_checked_in ?? 0} not in` : undefined}
        />
        <DataTable caption="Team attendance today" rowKey="key" columns={columns} rows={q.data?.map((r) => ({ ...r, key: r.employee.id }))} isLoading={q.isLoading} error={q.error} onRetry={q.refetch} empty={<EmptyState title="No team members" />} />
      </Card>
      {q.data?.length > 0 && (
        <div className="space-y-3">
          <Select label="View monthly attendance for" value={selected} onChange={(e) => setSelected(e.target.value)} className="max-w-sm">
            <option value="">Choose a person…</option>
            {q.data.map((r) => (
              <option key={r.employee.id} value={r.employee.id}>
                {r.employee.fullName}
              </option>
            ))}
          </Select>
          {selected && <MonthCalendar employeeId={selected} month={month} onMonthChange={setMonth} title="Monthly attendance" />}
        </div>
      )}
    </div>
  );
}

export function AttendancePage() {
  const { can, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [month, setMonth] = useState(currentMonth);
  const [correctionDate, setCorrectionDate] = useState(null);
  const canTeam = can('attendance:read:all') || can('attendance:read:team');
  const canApprove = can('attendance:manage') || can('attendance:approve:team');
  const hasProfile = Boolean(user.employee) && can('self:attendance');

  const tabs = [
    ...(hasProfile ? [{ value: 'mine', label: 'My attendance' }] : []),
    ...(canTeam ? [{ value: 'team', label: can('attendance:read:all') ? 'Everyone' : 'My team' }] : []),
    ...(canApprove ? [{ value: 'approvals', label: 'Corrections to review' }] : []),
  ];
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : tabs[0]?.value;

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Check in and out, see your month, and fix missed punches."
        actions={
          hasProfile && (
            <Button variant="secondary" onClick={() => setCorrectionDate(addDaysTo(localToday(), -1))}>
              <PencilLine className="h-4 w-4" aria-hidden="true" /> Request correction
            </Button>
          )
        }
      />
      {!tabs.length ? (
        <Alert tone="info">Your account isn't linked to an employee profile, so there is no attendance to show.</Alert>
      ) : (
        <>
          <Tabs label="Attendance sections" tabs={tabs} value={tab} onChange={(v) => setParams({ tab: v })} />
          <TabPanel value={tab}>
            {tab === 'mine' && (
              <div className="space-y-6">
                <TodayCard onRequestCorrection={setCorrectionDate} />
                <MonthCalendar month={month} onMonthChange={setMonth} />
                <Card>
                  <CardHeader title="My correction requests" />
                  <CorrectionsTable scope="mine" />
                </Card>
              </div>
            )}
            {tab === 'team' && <TeamTab />}
            {tab === 'approvals' && (
              <Card>
                <CardHeader title="Corrections to review" description="Approving replaces the recorded punches for that day." />
                <CorrectionsTable scope="approvals" />
              </Card>
            )}
          </TabPanel>
        </>
      )}
      {correctionDate && <CorrectionModal date={correctionDate} onClose={() => setCorrectionDate(null)} />}
    </>
  );
}

