import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarPlus, Palmtree, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useBalances, useLeaveMutations, useLeaveRequests, useLeaveTypes } from './api.js';
import { EmployeePicker } from '../employees/EmployeePicker.jsx';
import { applyFieldErrors } from '../../lib/api.js';
import { REQUEST_STATUS } from '../../lib/labels.js';
import { formatDate, formatDayShort, formatUnits, localToday } from '../../lib/format.js';
import { useDebouncedValue } from '../../lib/useDebouncedValue.js';
import { Alert, Badge, Button, Card, CardHeader, DataTable, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Pagination, Select, Spinner, TabPanel, Tabs, Textarea, useToast } from '../../components/ui/index.js';

const applySchema = z
  .object({
    leaveTypeId: z.string().min(1, 'Choose a leave type'),
    startDate: z.iso.date('Choose a start date'),
    endDate: z.iso.date('Choose an end date'),
    startSession: z.enum(['full', 'second_half']),
    endSession: z.enum(['full', 'first_half']),
    reason: z.string().trim().max(500),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'End date must be on or after the start date' })
  .refine((v) => !(v.startDate === v.endDate && v.startSession === 'second_half' && v.endSession === 'first_half'), { path: ['endSession'], message: 'Choose either the first or the second half' });

const describeDates = (r) => {
  const single = r.startDate === r.endDate;
  const half = r.startSession === 'second_half' ? ' (2nd half)' : r.endSession === 'first_half' && single ? ' (1st half)' : '';
  return single ? `${formatDayShort(r.startDate)}${half}` : `${formatDayShort(r.startDate)}${r.startSession === 'second_half' ? ' (2nd half)' : ''} → ${formatDayShort(r.endDate)}${r.endSession === 'first_half' ? ' (1st half)' : ''}`;
};

function ApplyLeaveModal({ onClose, employee }) {
  const toast = useToast();
  const types = useLeaveTypes();
  const balances = useBalances({ employee: employee?.id });
  const { apply, preview } = useLeaveMutations();
  const today = localToday();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(applySchema), defaultValues: { leaveTypeId: '', startDate: today, endDate: today, startSession: 'full', endSession: 'full', reason: '' } });

  const values = useWatch({ control });
  const key = useDebouncedValue(JSON.stringify([values.leaveTypeId, values.startDate, values.endDate, values.startSession, values.endSession]), 350);
  const [plan, setPlan] = useState(null);
  useEffect(() => {
    const [leaveTypeId, startDate, endDate, startSession, endSession] = JSON.parse(key);
    if (!leaveTypeId || !startDate || !endDate || endDate < startDate) return;
    preview
      .mutateAsync({ leaveTypeId, startDate, endDate, startSession, endSession, employeeId: employee?.id })
      .then((p) => setPlan({ ok: true, ...p }), (err) => setPlan({ ok: false, message: err.details?.[0]?.message ?? err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const balanceFor = (typeId) => balances.data?.balances.find((b) => b.leaveType.id === typeId);
  const selectedType = types.data?.find((t) => t.id === values.leaveTypeId);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await apply.mutateAsync({ ...v, employeeId: employee?.id });
      toast.success('Leave request sent for approval');
      onClose();
    } catch (err) {
      if (!applyFieldErrors(err, setError)) toast.error(err.message);
    }
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={employee ? `Apply leave for ${employee.fullName}` : 'Apply for leave'}
      description="Weekly offs and holidays are not charged."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="apply-form" loading={apply.isPending} disabled={plan && !plan.ok}>
            Send request
          </Button>
        </>
      }
    >
      <form id="apply-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Select label="Leave type" required className="sm:col-span-2" error={errors.leaveTypeId?.message} {...register('leaveTypeId')}>
          <option value="">Choose…</option>
          {types.data?.map((t) => {
            const b = balanceFor(t.id);
            if (balances.data && !b) return null;
            return (
              <option key={t.id} value={t.id}>
                {t.name} — {b ? (t.unlimited ? 'unlimited' : `${formatUnits(b.availableUnits)} available`) : '…'}
              </option>
            );
          })}
        </Select>
        <Input label="From" type="date" required error={errors.startDate?.message} {...register('startDate')} />
        <Input label="To" type="date" required min={values.startDate} error={errors.endDate?.message} {...register('endDate')} />
        {selectedType?.allowHalfDay !== false && (
          <>
            <Select label="First day" {...register('startSession')}>
              <option value="full">Full day</option>
              <option value="second_half">Second half only</option>
            </Select>
            <Select label="Last day" error={errors.endSession?.message} {...register('endSession')}>
              <option value="full">Full day</option>
              <option value="first_half">First half only</option>
            </Select>
          </>
        )}
        <Textarea label="Reason" className="sm:col-span-2" rows={2} {...register('reason')} />
        <div className="sm:col-span-2" aria-live="polite">
          {preview.isPending && !plan && <Spinner className="h-4 w-4 text-brand-600" />}
          {plan?.ok && (
            <Alert tone="info">
              <strong>{formatUnits(plan.units)}</strong> will be charged ({plan.days.map((d) => `${formatDayShort(d.date)}${d.half !== 'full' ? ` ½` : ''}`).join(', ')}).
              {plan.availableUnits !== null && <> Balance after approval: {formatUnits(plan.availableUnits - plan.units)}.</>}
            </Alert>
          )}
          {plan && !plan.ok && <Alert>{plan.message}</Alert>}
        </div>
      </form>
    </Modal>
  );
}

function DecisionModal({ request, kind, onClose }) {
  const toast = useToast();
  const { decide, decideCancellation } = useLeaveMutations();
  const mutation = kind === 'cancellation' ? decideCancellation : decide;
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const submit = async (decision) => {
    if (decision === 'rejected' && note.trim().length < 3) return setError('Give a reason');
    try {
      await mutation.mutateAsync({ id: request.id, decision, note: note.trim() });
      toast.success(decision === 'approved' ? 'Approved' : 'Rejected');
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={kind === 'cancellation' ? 'Cancellation request' : 'Leave request'}
      description={`${request.employee.fullName} · ${request.leaveType.name} · ${describeDates(request)} · ${formatUnits(request.units)}`}
      size="sm"
      footer={
        <>
          <Button variant="danger" onClick={() => submit('rejected')} loading={mutation.isPending}>
            Reject
          </Button>
          <Button onClick={() => submit('approved')} loading={mutation.isPending}>
            Approve{kind === 'cancellation' ? ' cancellation' : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {(kind === 'cancellation' ? request.cancellation?.reason : request.reason) && <p className="text-sm text-slate-700">“{kind === 'cancellation' ? request.cancellation.reason : request.reason}”</p>}
        <Textarea label="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} error={error} />
      </div>
    </Modal>
  );
}

function RequestsTable({ scope, employeeFilter }) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const q = useLeaveRequests({ scope, page, limit: 20, status: status || undefined, employee: employeeFilter });
  const { cancel } = useLeaveMutations();
  const [deciding, setDeciding] = useState(null);

  const doCancel = (r) =>
    cancel.mutateAsync({ id: r.id, reason: '' }).then(
      (res) => toast.success(res.status === 'cancelled' ? 'Leave cancelled' : 'Cancellation sent for approval'),
      (e) => toast.error(e.message),
    );

  const columns = [
    ...(scope !== 'mine' ? [{ key: 'employee', header: 'Employee', render: (r) => <span className="font-medium text-slate-900">{r.employee.fullName}</span> }] : []),
    {
      key: 'type',
      header: 'Type',
      render: (r) => (
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.leaveType.color }} aria-hidden="true" />
          {r.leaveType.name}
        </span>
      ),
    },
    { key: 'dates', header: 'Dates', render: (r) => describeDates(r) },
    { key: 'units', header: 'Days', className: 'whitespace-nowrap', render: (r) => formatUnits(r.units) },
    { key: 'reason', header: 'Reason', render: (r) => <span className="line-clamp-2 text-slate-600">{r.reason || '—'}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <div>
          <Badge tone={REQUEST_STATUS[r.status].tone}>{REQUEST_STATUS[r.status].label}</Badge>
          {r.decidedByName && <p className="mt-0.5 text-xs text-slate-500">by {r.decidedByName}{r.decisionNote ? ` — “${r.decisionNote}”` : ''}</p>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right whitespace-nowrap',
      render: (r) => {
        if (scope === 'approvals') {
          return (
            <Button size="sm" variant="secondary" onClick={() => setDeciding({ request: r, kind: r.status === 'cancellation_requested' ? 'cancellation' : 'leave' })}>
              Review
            </Button>
          );
        }
        if (['pending', 'approved'].includes(r.status)) {
          return (
            <Button size="sm" variant="ghost" onClick={() => doCancel(r)}>
              {r.status === 'pending' ? 'Withdraw' : scope === 'all' ? 'Cancel' : 'Request cancellation'}
            </Button>
          );
        }
        return null;
      },
    },
  ];

  return (
    <Card>
      {scope !== 'approvals' && (
        <div className="flex gap-3 border-b border-slate-100 p-4">
          <select aria-label="Filter by status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm">
            <option value="">All statuses</option>
            {['pending', 'approved', 'rejected', 'cancelled', 'cancellation_requested'].map((s) => (
              <option key={s} value={s}>
                {REQUEST_STATUS[s].label}
              </option>
            ))}
          </select>
        </div>
      )}
      <DataTable
        caption="Leave requests"
        columns={columns}
        rows={q.data?.data}
        isLoading={q.isLoading}
        isFetching={q.isFetching}
        error={q.error}
        onRetry={q.refetch}
        empty={<EmptyState icon={Palmtree} title={scope === 'approvals' ? 'Nothing waiting for you' : 'No leave requests'} />}
      />
      <Pagination meta={q.data?.meta} onPageChange={setPage} />
      {deciding && <DecisionModal request={deciding.request} kind={deciding.kind} onClose={() => setDeciding(null)} />}
    </Card>
  );
}

export function LeaveRequestsPage() {
  const { can, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [applying, setApplying] = useState(false);
  const [onBehalf, setOnBehalf] = useState(null);
  const canSelf = Boolean(user.employee) && can('self:leave');
  const canApprove = can('leave:manage') || can('leave:approve:team');
  const isHr = can('leave:manage');
  const tabs = [
    ...(canSelf ? [{ value: 'mine', label: 'My leave' }] : []),
    ...(canApprove ? [{ value: 'approvals', label: 'Approvals' }] : []),
    ...(isHr ? [{ value: 'all', label: 'All requests' }] : []),
  ];
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : tabs[0]?.value;
  return (
    <>
      <PageHeader
        title="Leave"
        description="Apply for leave, track requests and approve your team's."
        actions={
          <>
            {isHr && (
              <Button variant="secondary" onClick={() => setOnBehalf('pick')}>
                Apply on behalf
              </Button>
            )}
            {canSelf && (
              <Button onClick={() => setApplying(true)}>
                <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Apply for leave
              </Button>
            )}
          </>
        }
      />
      {!tabs.length ? (
        <Alert tone="info">Your account isn't linked to an employee profile.</Alert>
      ) : (
        <>
          <Tabs label="Leave sections" tabs={tabs} value={tab} onChange={(v) => setParams({ tab: v })} />
          <TabPanel value={tab}>
            <RequestsTable key={tab} scope={tab} />
          </TabPanel>
        </>
      )}
      {applying && <ApplyLeaveModal onClose={() => setApplying(false)} />}
      {onBehalf === 'pick' && <PickEmployeeModal onClose={() => setOnBehalf(null)} onPick={(e) => setOnBehalf(e)} />}
      {onBehalf && onBehalf !== 'pick' && <ApplyLeaveModal employee={onBehalf} onClose={() => setOnBehalf(null)} />}
    </>
  );
}

function PickEmployeeModal({ onClose, onPick }) {
  const [value, setValue] = useState(null);
  return (
    <Modal
      open
      onClose={onClose}
      title="Apply leave on behalf of"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!value} onClick={() => onPick(value)}>
            Continue
          </Button>
        </>
      }
    >
      <EmployeePicker label="Employee" value={value} onChange={setValue} />
    </Modal>
  );
}

// Balances

function AdjustModal({ employee, balance, year, onClose }) {
  const toast = useToast();
  const { adjust } = useLeaveMutations();
  const schema = z.object({
    days: z.coerce.number().refine((v) => v !== 0 && Number.isInteger(v * 2), 'Use a non-zero number of whole or half days'),
    reason: z.string().trim().min(3, 'Give a reason').max(300),
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { days: 1, reason: '' } });
  const onSubmit = handleSubmit(async (v) => {
    try {
      await adjust.mutateAsync({ employeeId: employee.id, leaveTypeId: balance.leaveType.id, year, ...v });
      toast.success('Balance adjusted');
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Adjust ${balance.leaveType.name}`}
      description={`${employee.fullName} · ${year} · currently ${formatUnits(balance.availableUnits)} available`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="adjust-form" loading={adjust.isPending}>
            Save adjustment
          </Button>
        </>
      }
    >
      <form id="adjust-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <Input label="Days (use a minus sign to deduct)" type="number" step="0.5" error={errors.days?.message} {...register('days')} />
        <Textarea label="Reason" required hint="Recorded in the balance history and audit log." error={errors.reason?.message} {...register('reason')} />
      </form>
    </Modal>
  );
}

function BalanceCards({ employeeId, canAdjust }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const q = useBalances({ employee: employeeId, year });
  const [adjusting, setAdjusting] = useState(null);
  if (q.isLoading) return <PageLoader label="Loading balances" />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-32">
          {[-1, 0, 1].map((d) => {
            const y = new Date().getFullYear() + d;
            return (
              <option key={y} value={y}>
                {y}
              </option>
            );
          })}
        </Select>
        <span className="text-sm text-slate-500">{q.data.employee.fullName}</span>
      </div>
      {q.data.balances.length === 0 ? (
        <Card>
          <EmptyState icon={Palmtree} title="No leave types apply" />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.balances.map((b) => (
            <Card key={b.leaveType.id} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: b.leaveType.color }} aria-hidden="true" />
                  <h3 className="font-semibold text-slate-900">{b.leaveType.name}</h3>
                </div>
                {!b.leaveType.paid && <Badge>Unpaid</Badge>}
              </div>
              <p className="mt-3 text-3xl font-semibold tabular-nums text-slate-900">{b.leaveType.unlimited ? '∞' : b.availableUnits / 2}</p>
              <p className="text-xs text-slate-500">{b.leaveType.unlimited ? 'No limit' : 'days available'}</p>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                {!b.leaveType.unlimited && (
                  <>
                    <dt>Carried forward</dt>
                    <dd className="text-right tabular-nums">{b.openingUnits / 2}</dd>
                    <dt>Accrued</dt>
                    <dd className="text-right tabular-nums">{b.accruedUnits / 2}</dd>
                    <dt>Adjusted</dt>
                    <dd className="text-right tabular-nums">{b.adjustedUnits / 2}</dd>
                  </>
                )}
                <dt>Used</dt>
                <dd className="text-right tabular-nums">{b.usedUnits / 2}</dd>
                <dt>Pending approval</dt>
                <dd className="text-right tabular-nums">{b.pendingUnits / 2}</dd>
              </dl>
              {canAdjust && !b.leaveType.unlimited && (
                <Button variant="ghost" size="sm" className="mt-3 -ml-3" onClick={() => setAdjusting(b)}>
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Adjust
                </Button>
              )}
              {b.adjustments.length > 0 && (
                <details className="mt-2 text-xs text-slate-500">
                  <summary className="cursor-pointer">Adjustment history</summary>
                  <ul className="mt-1 space-y-1">
                    {b.adjustments.map((a, i) => (
                      <li key={i}>
                        {a.units > 0 ? '+' : ''}
                        {a.units / 2} · {a.reason} · {a.byName} {formatDate(a.at)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          ))}
        </div>
      )}
      {adjusting && <AdjustModal employee={q.data.employee} balance={adjusting} year={year} onClose={() => setAdjusting(null)} />}
    </div>
  );
}

export function LeaveBalancesPage() {
  const { can, user } = useAuth();
  const canOthers = can('leave:manage') || can('leave:approve:team');
  const [other, setOther] = useState(null);
  return (
    <>
      <PageHeader title="Leave balances" description="Balances are shown in days; half days count as 0.5." />
      {canOthers && (
        <Card className="mb-6 p-4">
          <div className="max-w-sm">
            <EmployeePicker label="View balances for" value={other} onChange={setOther} hint={can('leave:manage') ? undefined : 'Only your team members are available.'} />
          </div>
        </Card>
      )}
      {other ? (
        <BalanceCards key={other.id} employeeId={other.id} canAdjust={can('leave:manage') && other.id !== user.employee} />
      ) : user.employee ? (
        <BalanceCards employeeId={undefined} canAdjust={false} />
      ) : (
        <Alert tone="info">Choose an employee to view their balances.</Alert>
      )}
      <Card className="mt-6">
        <CardHeader title="How balances work" />
        <ul className="list-disc space-y-1 p-5 pl-10 text-sm text-slate-600">
          <li>Leave accrues from your joining month, monthly or yearly depending on the leave type.</li>
          <li>Requests waiting for approval are held aside, so they reduce what's available straight away.</li>
          <li>Unused leave carries into the next year only up to the leave type's limit.</li>
        </ul>
      </Card>
    </>
  );
}
