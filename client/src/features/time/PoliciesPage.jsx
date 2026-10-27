import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Archive, ArchiveRestore, Clock, Pencil, Plus, Tags } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useLeaveMutations, useLeaveTypes, useShiftMutations, useShifts, useUpdatePolicies } from './api.js';
import { useCompany } from '../settings/api.js';
import { applyFieldErrors } from '../../lib/api.js';
import { EMPLOYMENT_TYPES, WEEKDAYS } from '../../lib/labels.js';
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Select, TabPanel, Tabs, Textarea, useToast } from '../../components/ui/index.js';

// Rules

const rulesSchema = z.object({
  attendance: z.object({
    correctionWindowDays: z.coerce.number().int().min(1, '1–60').max(60, '1–60'),
    overnightCutoffHours: z.coerce.number().int().min(0, '0–8').max(8, '0–8'),
    overtimeEnabled: z.boolean(),
  }),
  leave: z.object({
    backdatedDays: z.coerce.number().int().min(0, '0–90').max(90, '0–90'),
    maxAdvanceDays: z.coerce.number().int().min(1, '1–730').max(730, '1–730'),
    countNonWorkingDays: z.boolean(),
  }),
});

function RulesTab() {
  const { can } = useAuth();
  const toast = useToast();
  const company = useCompany();
  const update = useUpdatePolicies();
  const canAttendance = can('company:manage') || can('attendance:manage');
  const canLeave = can('company:manage') || can('leave:manage');
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty, dirtyFields },
  } = useForm({ resolver: zodResolver(rulesSchema) });
  useEffect(() => {
    if (company.data) reset(company.data.policies);
  }, [company.data, reset]);

  if (company.isLoading) return <PageLoader label="Loading policies" />;
  if (company.error) return <ErrorState error={company.error} onRetry={company.refetch} />;

  const onSubmit = handleSubmit(async (values) => {
    const body = {};
    if (canAttendance && dirtyFields.attendance) body.attendance = values.attendance;
    if (canLeave && dirtyFields.leave) body.leave = values.leave;
    try {
      const saved = await update.mutateAsync(body);
      reset(saved);
      toast.success('Policies saved. They apply to new punches and leave requests.');
    } catch (err) {
      if (!applyFieldErrors(err, setError)) toast.error(err.message);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <Card>
        <CardHeader title="Attendance rules" description="Provisional defaults — confirm against DECISIONS A1–A6." />
        <fieldset disabled={!canAttendance} className="grid gap-4 p-5 sm:grid-cols-2">
          <Input label="Correction window (days)" type="number" hint="How far back employees may request a missing-punch correction." error={errors.attendance?.correctionWindowDays?.message} {...register('attendance.correctionWindowDays')} />
          <Input label="Overnight cut-off (hours)" type="number" hint="Punches up to this many hours after a night shift ends count towards the previous day." error={errors.attendance?.overnightCutoffHours?.message} {...register('attendance.overnightCutoffHours')} />
          <Checkbox label="Calculate overtime" description="Minutes worked beyond the shift's full-day minutes are recorded as overtime." {...register('attendance.overtimeEnabled')} />
        </fieldset>
      </Card>
      <Card>
        <CardHeader title="Leave rules" description="Provisional defaults — confirm against DECISIONS A8–A10." />
        <fieldset disabled={!canLeave} className="grid gap-4 p-5 sm:grid-cols-2">
          <Input label="Back-dated leave allowed (days)" type="number" error={errors.leave?.backdatedDays?.message} {...register('leave.backdatedDays')} />
          <Input label="Plan ahead at most (days)" type="number" error={errors.leave?.maxAdvanceDays?.message} {...register('leave.maxAdvanceDays')} />
          <Checkbox label="Count weekly offs and holidays inside leave (sandwich rule)" description="Off: a Friday–Monday leave costs 2 days. On: it costs 4." {...register('leave.countNonWorkingDays')} />
        </fieldset>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={!isDirty} onClick={() => reset(company.data.policies)}>
          Discard
        </Button>
        <Button type="submit" disabled={!isDirty} loading={update.isPending}>
          Save policies
        </Button>
      </div>
    </form>
  );
}

// Shifts

const shiftSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(60),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{2,12}$/, '2–12 letters, digits or hyphens'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Enter a time'),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Enter a time'),
    lateGraceMinutes: z.coerce.number().int().min(0).max(120),
    earlyLeaveGraceMinutes: z.coerce.number().int().min(0).max(120),
    fullDayHours: z.coerce.number().min(1).max(16),
    halfDayHours: z.coerce.number().min(0.5).max(12),
    weeklyOffs: z.array(z.number()).max(6, 'At least one working day is needed'),
    isDefault: z.boolean(),
  })
  .refine((v) => v.halfDayHours < v.fullDayHours, { path: ['halfDayHours'], message: 'Must be less than a full day' });

function ShiftModal({ shift, onClose }) {
  const toast = useToast();
  const { create, update } = useShiftMutations();
  const mutation = shift ? update : create;
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(shiftSchema) });
  useEffect(() => {
    reset(
      shift
        ? { ...shift, fullDayHours: shift.fullDayMinutes / 60, halfDayHours: shift.halfDayMinutes / 60 }
        : { name: '', code: '', startTime: '09:30', endTime: '18:30', lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15, fullDayHours: 8, halfDayHours: 4, weeklyOffs: [0, 6], isDefault: false },
    );
  }, [shift, reset]);
  const onSubmit = handleSubmit(async ({ fullDayHours, halfDayHours, ...values }) => {
    const body = { ...values, fullDayMinutes: Math.round(fullDayHours * 60), halfDayMinutes: Math.round(halfDayHours * 60) };
    if (shift?.isDefault) delete body.isDefault;
    try {
      await mutation.mutateAsync(shift ? { id: shift.id, ...body } : body);
      toast.success(shift ? 'Shift updated' : 'Shift created');
      onClose();
    } catch (err) {
      if (!applyFieldErrors(err, setError)) toast.error(err.message);
    }
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={shift ? 'Edit shift' : 'New shift'}
      description="Changes apply to future days; past attendance keeps the rules it was recorded with."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="shift-form" loading={mutation.isPending}>
            Save shift
          </Button>
        </>
      }
    >
      <form id="shift-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" required error={errors.name?.message} {...register('name')} />
        <Input label="Code" required error={errors.code?.message} {...register('code')} />
        <Input label="Starts" type="time" error={errors.startTime?.message} {...register('startTime')} />
        <Input label="Ends" type="time" hint="Earlier than the start = overnight shift" error={errors.endTime?.message} {...register('endTime')} />
        <Input label="Late grace (minutes)" type="number" error={errors.lateGraceMinutes?.message} {...register('lateGraceMinutes')} />
        <Input label="Early-leaving grace (minutes)" type="number" error={errors.earlyLeaveGraceMinutes?.message} {...register('earlyLeaveGraceMinutes')} />
        <Input label="Full day = at least (hours)" type="number" step="0.5" error={errors.fullDayHours?.message} {...register('fullDayHours')} />
        <Input label="Half day = at least (hours)" type="number" step="0.5" error={errors.halfDayHours?.message} {...register('halfDayHours')} />
        <Controller
          control={control}
          name="weeklyOffs"
          render={({ field }) => (
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-medium text-slate-700">Weekly offs</legend>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                  const on = field.value?.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => field.onChange(on ? field.value.filter((x) => x !== d) : [...field.value, d])}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${on ? 'bg-brand-800 text-white ring-brand-800' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}
                    >
                      {WEEKDAYS[d]}
                    </button>
                  );
                })}
              </div>
              {errors.weeklyOffs && <p className="mt-1.5 text-xs text-red-600">{errors.weeklyOffs.message}</p>}
            </fieldset>
          )}
        />
        {!shift?.isDefault && <Checkbox label="Company default" description="Used for employees without an assigned shift." {...register('isDefault')} />}
      </form>
    </Modal>
  );
}

function ShiftsTab() {
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const q = useShifts(showArchived);
  const { update } = useShiftMutations();
  const [editing, setEditing] = useState(null);
  const columns = [
    {
      key: 'name',
      header: 'Shift',
      render: (s) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-900">{s.name}</span>
          {s.isDefault && <Badge tone="brand">Default</Badge>}
          {s.status === 'archived' && <Badge>Archived</Badge>}
        </div>
      ),
    },
    { key: 'time', header: 'Hours', className: 'whitespace-nowrap', render: (s) => `${s.startTime}–${s.endTime}${s.overnight ? ' (overnight)' : ''}` },
    { key: 'offs', header: 'Weekly off', render: (s) => s.weeklyOffs.map((d) => WEEKDAYS[d]).join(', ') || 'None' },
    { key: 'grace', header: 'Grace', render: (s) => `${s.lateGraceMinutes} min late` },
    { key: 'thresholds', header: 'Full / half day', render: (s) => `${s.fullDayMinutes / 60}h / ${s.halfDayMinutes / 60}h` },
    { key: 'employeeCount', header: 'Assigned' },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right whitespace-nowrap',
      render: (s) => (
        <>
          <Button variant="ghost" size="sm" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
            <Pencil className="h-4 w-4" />
          </Button>
          {!s.isDefault && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${s.status === 'active' ? 'Archive' : 'Restore'} ${s.name}`}
              onClick={() => update.mutateAsync({ id: s.id, status: s.status === 'active' ? 'archived' : 'active' }).then(() => toast.success('Saved'), (e) => toast.error(e.message))}
            >
              {s.status === 'active' ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
            </Button>
          )}
        </>
      ),
    },
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-brand-700" /> Show archived
        </label>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" aria-hidden="true" /> New shift
        </Button>
      </div>
      <DataTable caption="Shifts" columns={columns} rows={q.data} isLoading={q.isLoading} error={q.error} onRetry={q.refetch} empty={<EmptyState icon={Clock} title="No shifts yet" description="Without a shift, the built-in 09:30–18:30 Mon–Fri schedule is used." />} />
      {editing && <ShiftModal shift={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

// Leave types

const leaveTypeSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(60),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{1,10}$/, '1–10 letters or digits'),
    description: z.string().trim().max(300),
    paid: z.boolean(),
    unlimited: z.boolean(),
    annualQuotaDays: z.coerce.number().min(0).max(365).refine((v) => Number.isInteger(v * 2), 'Whole or half days'),
    accrual: z.enum(['annual', 'monthly']),
    carryForwardMaxDays: z.coerce.number().min(0).max(365).refine((v) => Number.isInteger(v * 2), 'Whole or half days'),
    allowHalfDay: z.boolean(),
    allowNegativeBalance: z.boolean(),
    availableDuringProbation: z.boolean(),
    minNoticeDays: z.coerce.number().int().min(0).max(90),
    maxConsecutiveDays: z.union([z.literal(''), z.coerce.number().int().min(1).max(365)]),
    employmentTypes: z.array(z.string()),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .refine((v) => !(v.unlimited && v.paid), { path: ['unlimited'], message: 'Unlimited types must be unpaid' })
  .refine((v) => v.unlimited || v.annualQuotaDays > 0, { path: ['annualQuotaDays'], message: 'Set a quota or mark the type unlimited' });

function LeaveTypeModal({ type, onClose }) {
  const toast = useToast();
  const { createType, updateType } = useLeaveMutations();
  const mutation = type ? updateType : createType;
  const {
    register,
    handleSubmit,
    reset,
    control,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(leaveTypeSchema) });
  useEffect(() => {
    reset(
      type
        ? { ...type, maxConsecutiveDays: type.maxConsecutiveDays ?? '' }
        : { name: '', code: '', description: '', paid: true, unlimited: false, annualQuotaDays: 12, accrual: 'monthly', carryForwardMaxDays: 0, allowHalfDay: true, allowNegativeBalance: false, availableDuringProbation: true, minNoticeDays: 0, maxConsecutiveDays: '', employmentTypes: [], color: '#3459ad' },
    );
  }, [type, reset]);
  const unlimited = useWatch({ control, name: 'unlimited' });
  const onSubmit = handleSubmit(async (values) => {
    const body = { ...values, maxConsecutiveDays: values.maxConsecutiveDays === '' ? null : values.maxConsecutiveDays };
    if (type) delete body.unlimited;
    try {
      await mutation.mutateAsync(type ? { id: type.id, ...body } : body);
      toast.success(type ? 'Leave type updated' : 'Leave type created');
      onClose();
    } catch (err) {
      if (!applyFieldErrors(err, setError)) toast.error(err.message);
    }
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={type ? `Edit ${type.name}` : 'New leave type'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="leave-type-form" loading={mutation.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="leave-type-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" required error={errors.name?.message} {...register('name')} />
        <Input label="Code" required error={errors.code?.message} {...register('code')} />
        <Textarea label="Description" rows={2} className="sm:col-span-2" {...register('description')} />
        <Checkbox label="Paid" {...register('paid')} />
        <Checkbox label="Unlimited (no balance, e.g. loss of pay)" disabled={Boolean(type)} description={type ? 'Cannot change once balances exist.' : undefined} {...register('unlimited')} />
        {errors.unlimited && <p className="text-xs text-red-600 sm:col-span-2">{errors.unlimited.message}</p>}
        {!unlimited && (
          <>
            <Input label="Annual quota (days)" type="number" step="0.5" error={errors.annualQuotaDays?.message} {...register('annualQuotaDays')} />
            <Select label="Accrual" hint="Pro-rated from the joining month" {...register('accrual')}>
              <option value="monthly">Monthly (1/12 each month)</option>
              <option value="annual">Annual (all at once)</option>
            </Select>
            <Input label="Carry forward up to (days)" type="number" step="0.5" error={errors.carryForwardMaxDays?.message} {...register('carryForwardMaxDays')} />
            <Checkbox label="Allow negative balance" {...register('allowNegativeBalance')} />
          </>
        )}
        <Input label="Minimum notice (days)" type="number" error={errors.minNoticeDays?.message} {...register('minNoticeDays')} />
        <Input label="Max consecutive days" type="number" placeholder="No limit" error={errors.maxConsecutiveDays?.message} {...register('maxConsecutiveDays')} />
        <Checkbox label="Half days allowed" {...register('allowHalfDay')} />
        <Checkbox label="Available during probation" {...register('availableDuringProbation')} />
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-slate-700">Applies to (none selected = everyone)</legend>
          <div className="flex flex-wrap gap-4">
            {Object.entries(EMPLOYMENT_TYPES).map(([v, l]) => (
              <Checkbox key={v} label={l} value={v} {...register('employmentTypes')} />
            ))}
          </div>
        </fieldset>
        <Input label="Colour" type="color" className="w-32" {...register('color')} />
      </form>
    </Modal>
  );
}

function LeaveTypesTab() {
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const q = useLeaveTypes(showArchived);
  const { updateType } = useLeaveMutations();
  const [editing, setEditing] = useState(null);
  const columns = [
    {
      key: 'name',
      header: 'Leave type',
      render: (t) => (
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} aria-hidden="true" />
          <span className="font-medium text-slate-900">{t.name}</span>
          <Badge>{t.code}</Badge>
          {t.status === 'archived' && <Badge>Archived</Badge>}
        </div>
      ),
    },
    { key: 'paid', header: 'Paid', render: (t) => (t.paid ? 'Paid' : 'Unpaid') },
    { key: 'quota', header: 'Quota', render: (t) => (t.unlimited ? 'Unlimited' : `${t.annualQuotaDays} days · ${t.accrual}`) },
    { key: 'carry', header: 'Carry forward', render: (t) => (t.carryForwardMaxDays ? `up to ${t.carryForwardMaxDays} days` : '—') },
    { key: 'rules', header: 'Rules', render: (t) => [t.allowHalfDay ? 'half days' : 'full days only', !t.availableDuringProbation && 'not in probation', t.minNoticeDays && `${t.minNoticeDays}d notice`].filter(Boolean).join(' · ') },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right whitespace-nowrap',
      render: (t) => (
        <>
          <Button variant="ghost" size="sm" onClick={() => setEditing(t)} aria-label={`Edit ${t.name}`}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${t.status === 'active' ? 'Archive' : 'Restore'} ${t.name}`}
            onClick={() => updateType.mutateAsync({ id: t.id, status: t.status === 'active' ? 'archived' : 'active' }).then(() => toast.success('Saved'), (e) => toast.error(e.message))}
          >
            {t.status === 'active' ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
          </Button>
        </>
      ),
    },
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-brand-700" /> Show archived
        </label>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" aria-hidden="true" /> New leave type
        </Button>
      </div>
      <DataTable caption="Leave types" columns={columns} rows={q.data} isLoading={q.isLoading} error={q.error} onRetry={q.refetch} empty={<EmptyState icon={Tags} title="No leave types yet" />} />
      {editing && <LeaveTypeModal type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

export function PoliciesPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = [
    { value: 'rules', label: 'Rules' },
    ...(can('attendance:manage') ? [{ value: 'shifts', label: 'Shifts' }] : []),
    ...(can('leave:manage') ? [{ value: 'leave-types', label: 'Leave types' }] : []),
  ];
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'rules';
  return (
    <>
      <PageHeader title="Time & leave policies" description="Shifts, leave types and the rules behind attendance and leave." />
      <Tabs label="Policy sections" tabs={tabs} value={tab} onChange={(v) => setParams({ tab: v })} />
      <TabPanel value={tab}>
        {tab === 'rules' && <RulesTab />}
        {tab === 'shifts' && <ShiftsTab />}
        {tab === 'leave-types' && <LeaveTypesTab />}
      </TabPanel>
    </>
  );
}
