import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ClipboardCheck, ListChecks, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useMyTasks, useOnboardingMutations, useOverview, useTemplates } from './api.js';
import { TaskList } from './TaskList.jsx';
import { applyFieldErrors } from '../../lib/api.js';
import { ASSIGNEE_TYPES, DOCUMENT_CATEGORIES } from '../../lib/labels.js';
import { formatDate } from '../../lib/format.js';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, DataTable, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Select, TabPanel, Tabs, Textarea, useToast } from '../../components/ui/index.js';
import { LifecycleBadge } from '../employees/EmployeesPage.jsx';

function MyTasksTab() {
  const { user } = useAuth();
  const q = useMyTasks();
  if (q.isLoading) return <PageLoader label="Loading your tasks" />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data.length) return <Card><EmptyState icon={ClipboardCheck} title="You're all caught up" description="Onboarding tasks assigned to you, or to you as a manager, appear here." /></Card>;
  const canAct = (t) => (t.assigneeType === 'employee' && t.employee.id === user.employee) || t.assigneeType === 'manager';
  return (
    <Card>
      <CardHeader title="Waiting on you" description={`${q.data.length} open task${q.data.length === 1 ? '' : 's'}`} />
      <TaskList tasks={q.data} showEmployee canAct={canAct} />
    </Card>
  );
}

function ProgressTab() {
  const [kind, setKind] = useState('onboarding');
  const [state, setState] = useState('open');
  const q = useOverview({ kind, state });
  const columns = [
    {
      key: 'employee',
      header: 'Employee',
      render: (r) => (
        <Link to={`/employees/${r.employee.id}`} className="block">
          <span className="block font-medium text-slate-900 hover:text-brand-700">{r.employee.fullName}</span>
          <span className="block text-xs text-slate-500">
            {r.employee.employeeCode} · {r.employee.department}
          </span>
        </Link>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <LifecycleBadge status={r.employee.lifecycleStatus} /> },
    { key: 'joining', header: 'Joining', className: 'whitespace-nowrap', render: (r) => formatDate(r.employee.joiningDate) },
    {
      key: 'progress',
      header: 'Progress',
      render: (r) => (
        <div className="min-w-36">
          <div className="flex justify-between text-xs text-slate-600">
            <span>
              {r.completed + r.waived}/{r.total}
            </span>
            <span>{r.progress}%</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-slate-100" role="progressbar" aria-valuenow={r.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.employee.fullName} progress`}>
            <div className="h-1.5 rounded-full bg-accent-500" style={{ width: `${r.progress}%` }} />
          </div>
        </div>
      ),
    },
    { key: 'overdue', header: 'Overdue', render: (r) => (r.overdue ? <Badge tone="danger">{r.overdue}</Badge> : <span className="text-slate-400">0</span>) },
    { key: 'nextDue', header: 'Next due', className: 'whitespace-nowrap', render: (r) => formatDate(r.nextDue) },
  ];
  const sel = 'h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm';
  return (
    <Card>
      <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
        <select aria-label="Checklist type" value={kind} onChange={(e) => setKind(e.target.value)} className={sel}>
          <option value="onboarding">Onboarding</option>
          <option value="offboarding">Offboarding</option>
        </select>
        <select aria-label="Completion" value={state} onChange={(e) => setState(e.target.value)} className={sel}>
          <option value="open">In progress</option>
          <option value="completed">Completed</option>
          <option value="all">All</option>
        </select>
      </div>
      <DataTable
        caption="Checklist progress"
        rowKey="key"
        columns={columns}
        rows={q.data?.map((r) => ({ ...r, key: r.employee.id }))}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={q.refetch}
        empty={<EmptyState icon={ListChecks} title="Nothing here" description="Start a checklist from an employee's profile (Actions → Start checklist)." />}
      />
    </Card>
  );
}

const templateSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(100),
  kind: z.enum(['onboarding', 'offboarding']),
  description: z.string().trim().max(500),
  isActive: z.boolean(),
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(2, 'Task title is required').max(150),
        assigneeType: z.enum(['employee', 'manager', 'hr']),
        dueOffsetDays: z.coerce.number().int().min(-60, '−60 to 180').max(180, '−60 to 180'),
        documentCategory: z.string(),
      }),
    )
    .min(1, 'Add at least one task')
    .max(50),
});

function TemplateModal({ template, onClose }) {
  const toast = useToast();
  const { createTemplate, updateTemplate } = useOnboardingMutations();
  const mutation = template ? updateTemplate : createTemplate;
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(templateSchema) });
  const { fields, append, remove } = useFieldArray({ control, name: 'tasks' });

  useEffect(() => {
    reset(
      template
        ? { ...template, tasks: template.tasks.map((t) => ({ ...t, documentCategory: t.documentCategory ?? '' })) }
        : { name: '', kind: 'onboarding', description: '', isActive: true, tasks: [{ title: '', assigneeType: 'employee', dueOffsetDays: 0, documentCategory: '' }] },
    );
  }, [template, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const tasks = values.tasks.map((t) => ({ ...t, documentCategory: t.documentCategory || null }));
    const body = template ? { id: template.id, name: values.name, description: values.description, isActive: values.isActive, tasks } : { ...values, tasks };
    try {
      await mutation.mutateAsync(body);
      toast.success(template ? 'Checklist updated' : 'Checklist created');
      onClose();
    } catch (err) {
      if (!applyFieldErrors(err, setError)) toast.error(err.message);
    }
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={template ? 'Edit checklist' : 'New checklist'}
      description="Changes apply to checklists started from now on; tasks already assigned are not rewritten."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="template-form" loading={mutation.isPending}>
            Save checklist
          </Button>
        </>
      }
    >
      <form id="template-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" required error={errors.name?.message} {...register('name')} />
          <Select label="Type" disabled={Boolean(template)} {...register('kind')}>
            <option value="onboarding">Onboarding (from joining date)</option>
            <option value="offboarding">Offboarding (from last working day)</option>
          </Select>
        </div>
        <Textarea label="Description" rows={2} {...register('description')} />
        <Checkbox label="Active" description="Inactive checklists can't be started." {...register('isActive')} />
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">Tasks</legend>
          {errors.tasks?.message && <p className="mb-2 text-xs text-red-600">{errors.tasks.message}</p>}
          <ol className="space-y-3">
            {fields.map((f, i) => (
              <li key={f.id} className="rounded-lg border border-slate-200 p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <Input label={`Task ${i + 1}`} error={errors.tasks?.[i]?.title?.message} {...register(`tasks.${i}.title`)} />
                  <Button variant="ghost" size="sm" className="self-end" onClick={() => remove(i)} disabled={fields.length === 1} aria-label={`Remove task ${i + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Select label="Assigned to" {...register(`tasks.${i}.assigneeType`)}>
                    {Object.entries(ASSIGNEE_TYPES).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                  <Input label="Due (days from anchor)" type="number" hint="Negative = before" error={errors.tasks?.[i]?.dueOffsetDays?.message} {...register(`tasks.${i}.dueOffsetDays`)} />
                  <Select label="Requires document" {...register(`tasks.${i}.documentCategory`)}>
                    <option value="">None</option>
                    {Object.entries(DOCUMENT_CATEGORIES).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </div>
              </li>
            ))}
          </ol>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => append({ title: '', assigneeType: 'employee', dueOffsetDays: 0, documentCategory: '' })} disabled={fields.length >= 50}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add task
          </Button>
        </fieldset>
      </form>
    </Modal>
  );
}

function ChecklistsTab() {
  const q = useTemplates();
  const [editing, setEditing] = useState(null); // null | 'new' | template
  if (q.isLoading) return <PageLoader label="Loading checklists" />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" aria-hidden="true" /> New checklist
        </Button>
      </div>
      {q.data.length === 0 ? (
        <Card>
          <EmptyState icon={ListChecks} title="No checklists yet" description="Create an onboarding checklist with the joining formalities your company needs." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {q.data.map((t) => (
            <Card key={t.id}>
              <CardHeader
                title={t.name}
                description={t.description}
                actions={
                  <Button variant="ghost" size="sm" onClick={() => setEditing(t)} aria-label={`Edit ${t.name}`}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                }
              />
              <div className="flex flex-wrap gap-1.5 px-5 pt-3">
                <Badge tone="brand">{t.kind === 'onboarding' ? 'Onboarding' : 'Offboarding'}</Badge>
                <Badge tone={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Active' : 'Inactive'}</Badge>
                <Badge>{t.tasks.length} tasks</Badge>
              </div>
              <ul className="space-y-1 p-5 text-sm text-slate-700">
                {t.tasks.slice(0, 6).map((x) => (
                  <li key={x.id} className="flex justify-between gap-3">
                    <span className="truncate">{x.title}</span>
                    <span className="shrink-0 text-xs text-slate-500">{ASSIGNEE_TYPES[x.assigneeType]}</span>
                  </li>
                ))}
                {t.tasks.length > 6 && <li className="text-xs text-slate-500">+{t.tasks.length - 6} more</li>}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {editing && <TemplateModal template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

export function OnboardingPage() {
  const { can, user } = useAuth();
  const isHr = can('onboarding:manage');
  const [params, setParams] = useSearchParams();
  const tabs = [
    ...(user.employee ? [{ value: 'mine', label: 'My tasks' }] : []),
    ...(isHr
      ? [
          { value: 'progress', label: 'Progress' },
          { value: 'checklists', label: 'Checklists' },
        ]
      : []),
  ];
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : tabs[0]?.value;

  return (
    <>
      <PageHeader title="Onboarding" description="Joining and exit formalities, tracked task by task." />
      {!tabs.length ? (
        <Alert tone="info">Your account isn't linked to an employee profile, so there are no tasks for you here.</Alert>
      ) : (
        <>
          <Tabs label="Onboarding sections" tabs={tabs} value={tab} onChange={(v) => setParams({ tab: v })} />
          <TabPanel value={tab}>
            {tab === 'mine' && <MyTasksTab />}
            {tab === 'progress' && <ProgressTab />}
            {tab === 'checklists' && <ChecklistsTab />}
          </TabPanel>
        </>
      )}
    </>
  );
}
