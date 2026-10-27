import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, ArchiveRestore, ClipboardList, KeyRound, LogOut, MoreHorizontal, Pencil, ShieldCheck, UserCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useEmployee, useEmployeeHistory, useEmployeeMutations, useMyEmployee } from './api.js';
import { LifecycleModal, ProbationModal, availableLifecycleActions } from './LifecycleModals.jsx';
import { SensitivePanel } from './SensitivePanel.jsx';
import { LifecycleBadge } from './EmployeesPage.jsx';
import { emptyAddress, selfProfileSchema } from './schemas.js';
import { SalaryHistory } from '../payroll/SalaryPages.jsx';
import { DocumentsPanel } from '../documents/DocumentsPanel.jsx';
import { TaskList } from '../onboarding/TaskList.jsx';
import { useEmployeeTasks, useOnboardingMutations, useTemplates } from '../onboarding/api.js';
import { applyFieldErrors } from '../../lib/api.js';
import { EMPLOYMENT_TYPES, EVENT_LABELS, GENDERS, PROBATION } from '../../lib/labels.js';
import { formatDate, formatDateTime, initials } from '../../lib/format.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Menu,
  Modal,
  PageLoader,
  Select,
  Spinner,
  StatusBadge,
  TabPanel,
  Tabs,
  useToast,
} from '../../components/ui/index.js';

const Field = ({ label, children }) => (
  <div>
    <dt className="text-xs font-medium text-slate-500">{label}</dt>
    <dd className="mt-0.5 text-sm text-slate-900">{children || <span className="text-slate-400">—</span>}</dd>
  </div>
);
const formatAddress = (a = {}) => [a.line1, a.line2, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(', ');

function OverviewTab({ e }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Employment" />
        <dl className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Employee code">{e.employeeCode}</Field>
          <Field label="Employment type">{EMPLOYMENT_TYPES[e.employmentType]}</Field>
          <Field label="Department">{e.department?.name}</Field>
          <Field label="Designation">{e.designation?.title}</Field>
          <Field label="Reporting manager">{e.reportingManager && <Link to={`/employees/${e.reportingManager.id}`} className="text-brand-700 hover:text-brand-900">{e.reportingManager.fullName}</Link>}</Field>
          <Field label="Work location">{e.workLocation}</Field>
          <Field label="Shift">{e.shift?.name ?? 'Company default'}</Field>
          <Field label="Joining date">{formatDate(e.joiningDate)}</Field>
          <Field label="Probation">
            {PROBATION[e.probation?.status]}
            {e.probation?.endDate && e.probation.status !== 'confirmed' && ` · ends ${formatDate(e.probation.endDate)}`}
            {e.probation?.confirmedOn && ` · ${formatDate(e.probation.confirmedOn)}`}
          </Field>
          {e.exit?.lastWorkingDate && <Field label="Last working day">{formatDate(e.exit.lastWorkingDate)}</Field>}
          {e.exit?.exitDate && <Field label="Exit date">{formatDate(e.exit.exitDate)}</Field>}
          {e.exit?.reason && <Field label="Exit reason">{e.exit.reason}</Field>}
        </dl>
      </Card>
      <Card>
        <CardHeader title="Contact" />
        <dl className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Work email">{e.workEmail}</Field>
          <Field label="Phone">{e.phone}</Field>
          {e.viewLevel === 'full' && <Field label="Personal email">{e.personalEmail}</Field>}
          {e.account !== undefined && (
            <Field label="Login account">{e.account ? <StatusBadge status={e.account.status} /> : 'No login'}</Field>
          )}
        </dl>
      </Card>
    </div>
  );
}

function PersonalTab({ e }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Personal" />
        <dl className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Date of birth">{formatDate(e.dateOfBirth)}</Field>
          <Field label="Gender">{GENDERS[e.gender]}</Field>
          <Field label="Current address">{formatAddress(e.currentAddress)}</Field>
          <Field label="Permanent address">{formatAddress(e.permanentAddress)}</Field>
        </dl>
      </Card>
      <Card>
        <CardHeader title="Emergency contact" />
        <dl className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Name">{e.emergencyContact?.name}</Field>
          <Field label="Relationship">{e.emergencyContact?.relationship}</Field>
          <Field label="Phone">{e.emergencyContact?.phone}</Field>
        </dl>
      </Card>
    </div>
  );
}

function HistoryTab({ id }) {
  const q = useEmployeeHistory(id, true);
  if (q.isLoading) return <PageLoader label="Loading history" />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data.length) return <EmptyState title="No history yet" />;
  return (
    <Card>
      <ol className="relative space-y-0 p-5">
        {q.data.map((ev, i) => (
          <li key={ev.id} className="relative flex gap-4 pb-5 last:pb-0">
            {i < q.data.length - 1 && <span aria-hidden="true" className="absolute left-[7px] top-4 h-full w-px bg-slate-200" />}
            <span aria-hidden="true" className="relative mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 border-accent-500 bg-white" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">{EVENT_LABELS[ev.type] ?? ev.type}</p>
              {(ev.from || ev.to) && (
                <p className="text-sm text-slate-600">
                  {ev.from && <span>{ev.from.replace('_', ' ')} → </span>}
                  {ev.to?.replace('_', ' ')}
                </p>
              )}
              {ev.note && <p className="text-sm text-slate-600">“{ev.note}”</p>}
              <p className="text-xs text-slate-500">
                Effective {formatDate(ev.effectiveDate)} · {ev.actorName ?? 'System'} · {formatDateTime(ev.createdAt)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function OnboardingTab({ e, isSelf, isManager }) {
  const { can } = useAuth();
  const q = useEmployeeTasks(e.id);
  const isHr = can('onboarding:manage');
  const canAct = (t) => isHr || (isSelf && t.assigneeType === 'employee') || (isManager && t.assigneeType === 'manager');
  if (q.isLoading) return <PageLoader label="Loading tasks" />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const groups = ['onboarding', 'offboarding'].map((kind) => [kind, q.data.filter((t) => t.kind === kind)]).filter(([, t]) => t.length);
  if (!groups.length) return <Card><EmptyState icon={ClipboardList} title="No checklist assigned" description={isHr ? 'Use “Start checklist” in the actions menu.' : undefined} /></Card>;
  return (
    <div className="space-y-6">
      {groups.map(([kind, tasks]) => {
        const done = tasks.filter((t) => t.status !== 'pending').length;
        return (
          <Card key={kind}>
            <CardHeader title={kind === 'onboarding' ? 'Onboarding' : 'Offboarding'} description={`${done} of ${tasks.length} done`} />
            <div className="px-5 pt-3">
              <div className="h-2 rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round((done / tasks.length) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${kind} progress`}>
                <div className="h-2 rounded-full bg-accent-500" style={{ width: `${(done / tasks.length) * 100}%` }} />
              </div>
            </div>
            <TaskList tasks={tasks.map((t) => ({ ...t, employee: { id: e.id, fullName: e.fullName } }))} canAct={canAct} />
          </Card>
        );
      })}
    </div>
  );
}

function StartChecklistModal({ employee, onClose }) {
  const toast = useToast();
  const kind = ['notice_period', 'exited'].includes(employee.lifecycleStatus) ? 'offboarding' : 'onboarding';
  const templates = useTemplates();
  const { start } = useOnboardingMutations();
  const options = templates.data?.filter((t) => t.kind === kind && t.isActive) ?? [];
  const [templateId, setTemplateId] = useState('');
  const chosen = templateId || options[0]?.id || '';
  const submit = async () => {
    try {
      const tasks = await start.mutateAsync({ employeeId: employee.id, templateId: chosen });
      toast.success(`${tasks.length} ${kind} tasks assigned`);
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Start ${kind}`}
      description={kind === 'onboarding' ? 'Due dates are calculated from the joining date.' : 'Due dates are calculated from the last working day.'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!chosen} loading={start.isPending}>
            Assign checklist
          </Button>
        </>
      }
    >
      {templates.isLoading ? (
        <Spinner label="Loading checklists" />
      ) : options.length === 0 ? (
        <Alert tone="info">
          No active {kind} checklists. <Link to="/onboarding?tab=checklists" className="font-medium underline">Create one</Link>.
        </Alert>
      ) : (
        <Select label="Checklist" value={chosen} onChange={(ev) => setTemplateId(ev.target.value)}>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.tasks.length} tasks)
            </option>
          ))}
        </Select>
      )}
    </Modal>
  );
}

function SelfEditModal({ employee, onClose }) {
  const toast = useToast();
  const { updateSelf } = useEmployeeMutations(employee.id);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(selfProfileSchema) });
  useEffect(() => {
    reset({
      personalEmail: employee.personalEmail ?? '',
      phone: employee.phone ?? '',
      currentAddress: { ...emptyAddress, ...employee.currentAddress },
      emergencyContact: { name: '', relationship: '', phone: '', ...employee.emergencyContact },
    });
  }, [employee, reset]);
  const onSubmit = handleSubmit(async (values) => {
    try {
      await updateSelf.mutateAsync(values);
      toast.success('Your details were updated');
      onClose();
    } catch (err) {
      if (!applyFieldErrors(err, setError)) toast.error(err.message);
    }
  });
  const a = errors.currentAddress ?? {};
  return (
    <Modal
      open
      onClose={onClose}
      title="Update my details"
      description="Other changes (name, department, bank details) go through HR."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="self-form" loading={updateSelf.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="self-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Phone" type="tel" error={errors.phone?.message} {...register('phone')} />
        <Input label="Personal email" type="email" error={errors.personalEmail?.message} {...register('personalEmail')} />
        <Input label="Address line 1" className="sm:col-span-2" error={a.line1?.message} {...register('currentAddress.line1')} />
        <Input label="Address line 2" className="sm:col-span-2" {...register('currentAddress.line2')} />
        <Input label="City" {...register('currentAddress.city')} />
        <Input label="State" {...register('currentAddress.state')} />
        <Input label="Postal code" {...register('currentAddress.postalCode')} />
        <Input label="Country" {...register('currentAddress.country')} />
        <Input label="Emergency contact name" {...register('emergencyContact.name')} />
        <Input label="Relationship" {...register('emergencyContact.relationship')} />
        <Input label="Emergency contact phone" type="tel" error={errors.emergencyContact?.phone?.message} {...register('emergencyContact.phone')} />
      </form>
    </Modal>
  );
}

function ProfileView({ employee: e, isSelf }) {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const m = useEmployeeMutations(e.id);
  const [tab, setTab] = useState('overview');
  const [lifecycle, setLifecycle] = useState(null);
  const [probation, setProbation] = useState(null);
  const [dialog, setDialog] = useState(null); // 'start' | 'self' | 'archive' | 'restore' | 'account'

  const canManage = can('employees:manage');
  const isManager = Boolean(user.employee) && e.reportingManager?.id === user.employee;
  const full = e.viewLevel === 'full';
  const onProbation = ['on_probation', 'extended'].includes(e.probation?.status) && ['active', 'notice_period'].includes(e.lifecycleStatus);

  const tabs = [
    { value: 'overview', label: 'Overview' },
    ...(full ? [{ value: 'personal', label: 'Personal' }] : []),
    ...(can('documents:manage') || isSelf ? [{ value: 'documents', label: 'Documents' }] : []),
    ...(can('onboarding:manage') || isSelf || isManager ? [{ value: 'onboarding', label: 'On/offboarding' }] : []),
    ...(full ? [{ value: 'history', label: 'History' }] : []),
    ...((can('payroll:read') || can('payroll:salary:manage')) ? [{ value: 'compensation', label: 'Compensation' }] : []),
    ...(can('employees:sensitive:read') ? [{ value: 'sensitive', label: 'Bank & identity' }] : []),
  ];

  const lifecycleLabels = { activate: 'Mark as joined', start_notice: 'Record resignation', withdraw_notice: 'Withdraw resignation', exit: 'Complete exit' };
  const menuItems = canManage
    ? [
        { label: 'Edit details', icon: Pencil, onSelect: () => navigate(`/employees/${e.id}/edit`), hidden: e.archived },
        ...availableLifecycleActions(e.lifecycleStatus).map((a) => ({ label: lifecycleLabels[a], icon: a === 'exit' ? LogOut : UserCheck, onSelect: () => setLifecycle(a), hidden: e.archived, danger: a === 'exit' })),
        { label: 'Confirm probation', icon: ShieldCheck, onSelect: () => setProbation('confirm'), hidden: !onProbation || e.archived },
        { label: 'Extend probation', icon: ShieldCheck, onSelect: () => setProbation('extend'), hidden: !onProbation || e.archived },
        { label: 'Start checklist', icon: ClipboardList, onSelect: () => setDialog('start'), hidden: !can('onboarding:manage') || e.archived },
        { label: 'Create login account', icon: KeyRound, onSelect: () => setDialog('account'), hidden: !can('users:manage') || e.account !== null || e.lifecycleStatus === 'exited' || e.archived },
        { label: 'Archive record', icon: Archive, onSelect: () => setDialog('archive'), hidden: e.archived || !['pre_joining', 'exited'].includes(e.lifecycleStatus) },
        { label: 'Restore record', icon: ArchiveRestore, onSelect: () => setDialog('restore'), hidden: !e.archived },
      ]
    : [];

  const confirmAction = async (mutation, message) => {
    try {
      await mutation.mutateAsync();
      toast.success(message);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDialog(null);
    }
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-800 text-lg font-semibold text-white">{initials(e.fullName)}</span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{e.fullName}</h1>
            <p className="text-sm text-slate-500">
              {e.designation?.title} · {e.department?.name} · {e.employeeCode}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <LifecycleBadge status={e.lifecycleStatus} />
              {onProbation && <Badge tone="warning">{PROBATION[e.probation.status]}</Badge>}
              {e.archived && <Badge>Archived</Badge>}
              {!full && <Badge tone="neutral">Team view</Badge>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isSelf && (
            <Button variant="secondary" onClick={() => setDialog('self')}>
              <Pencil className="h-4 w-4" aria-hidden="true" /> Update my details
            </Button>
          )}
          {menuItems.some((i) => !i.hidden) && (
            <Menu
              label="Employee actions"
              items={menuItems}
              trigger={(props) => (
                <Button variant="secondary" {...props}>
                  Actions <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            />
          )}
        </div>
      </div>

      <Tabs label="Employee profile sections" tabs={tabs} value={tab} onChange={setTab} />
      <TabPanel value={tab}>
        {tab === 'overview' && <OverviewTab e={e} />}
        {tab === 'personal' && <PersonalTab e={e} />}
        {tab === 'documents' && <DocumentsPanel employee={e} isSelf={isSelf} />}
        {tab === 'onboarding' && <OnboardingTab e={e} isSelf={isSelf} isManager={isManager} />}
        {tab === 'history' && <HistoryTab id={e.id} />}
        {tab === 'compensation' && <SalaryHistory employeeId={e.id} />}
        {tab === 'sensitive' && <SensitivePanel employee={e} />}
      </TabPanel>

      {lifecycle && <LifecycleModal action={lifecycle} employee={e} mutation={m.lifecycle} onClose={() => setLifecycle(null)} />}
      {probation && <ProbationModal action={probation} employee={e} mutation={m.probation} onClose={() => setProbation(null)} />}
      {dialog === 'start' && <StartChecklistModal employee={e} onClose={() => setDialog(null)} />}
      {dialog === 'self' && <SelfEditModal employee={e} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog === 'archive' || dialog === 'restore' || dialog === 'account'}
        title={dialog === 'account' ? 'Create login account' : dialog === 'archive' ? 'Archive employee record' : 'Restore employee record'}
        description={
          dialog === 'account'
            ? `An invitation will be emailed to ${e.workEmail} with the Employee role. Adjust roles later under Users.`
            : dialog === 'archive'
              ? 'The record is hidden from the directory but kept, with its history and documents. You can restore it later.'
              : 'The record returns to the directory.'
        }
        confirmLabel={dialog === 'account' ? 'Send invitation' : dialog === 'archive' ? 'Archive' : 'Restore'}
        loading={m.archive.isPending || m.restore.isPending || m.createAccount.isPending}
        onConfirm={() =>
          dialog === 'account'
            ? confirmAction(m.createAccount, `Invitation sent to ${e.workEmail}`)
            : confirmAction(dialog === 'archive' ? m.archive : m.restore, dialog === 'archive' ? 'Record archived' : 'Record restored')
        }
        onClose={() => setDialog(null)}
      />
    </>
  );
}

export function EmployeeProfilePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const q = useEmployee(id);
  if (q.isLoading) return <PageLoader label="Loading profile" />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.error.status >= 500 ? q.refetch : undefined} title={q.error.status === 404 ? 'Employee not found' : undefined} />;
  return <ProfileView employee={q.data} isSelf={q.data.id === user.employee} />;
}

export function MyProfilePage() {
  const q = useMyEmployee();
  if (q.isLoading) return <PageLoader label="Loading your profile" />;
  if (q.error?.status === 404) {
    return <Card><EmptyState title="No employee profile linked" description="Your login isn't connected to an employee record yet. Contact HR if this is unexpected." /></Card>;
  }
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <ProfileView employee={q.data} isSelf />;
}
