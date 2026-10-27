import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Briefcase, Pencil, Plus, Search } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useJob, useJobs, useRecruitmentMutations } from './api.js';
import { PipelineBoard } from './PipelineBoard.jsx';
import { useDepartments, useDesignations } from '../employees/api.js';
import { EmployeePicker } from '../employees/EmployeePicker.jsx';
import { applyFieldErrors } from '../../lib/api.js';
import { EMPLOYMENT_TYPES, JOB_STATUS, JOB_TRANSITIONS } from '../../lib/labels.js';
import { formatDate } from '../../lib/format.js';
import { useDebouncedValue } from '../../lib/useDebouncedValue.js';
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, ErrorState, Input, Menu, PageHeader, PageLoader, Pagination, Select, Textarea, buttonClass, useToast } from '../../components/ui/index.js';

export function JobStatusBadge({ status }) {
  return <Badge tone={JOB_STATUS[status].tone}>{JOB_STATUS[status].label}</Badge>;
}

export function JobsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim());
  const pageNo = Number(params.get('page') ?? 1);
  const status = params.get('status') ?? '';
  const q = useJobs({ page: pageNo, limit: 20, status: status || undefined, search: debounced || undefined });
  const columns = [
    {
      key: 'title',
      header: 'Job',
      render: (j) => (
        <Link to={`/recruitment/jobs/${j.id}`} className="block">
          <span className="block font-medium text-slate-900 hover:text-brand-700">{j.title}</span>
          <span className="block text-xs text-slate-500">
            {j.code} · {j.department?.name}
          </span>
        </Link>
      ),
    },
    { key: 'status', header: 'Status', render: (j) => <JobStatusBadge status={j.status} /> },
    { key: 'openings', header: 'Openings', render: (j) => `${j.pipeline.hired} / ${j.openings} hired` },
    { key: 'active', header: 'In pipeline', render: (j) => j.pipeline.active },
    { key: 'manager', header: 'Hiring manager', render: (j) => j.hiringManager?.fullName ?? '—' },
    { key: 'opened', header: 'Opened', className: 'whitespace-nowrap', render: (j) => formatDate(j.openedOn) },
  ];
  return (
    <>
      <PageHeader
        title="Job openings"
        description={can('recruitment:jobs:manage') ? 'Open roles and how far each pipeline has progressed.' : 'Roles where you are the hiring manager.'}
        actions={
          can('recruitment:jobs:manage') && (
            <Link to="/recruitment/jobs/new" className={buttonClass()}>
              <Plus className="h-4 w-4" aria-hidden="true" /> New job
            </Link>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input type="search" aria-label="Search jobs" placeholder="Search title, code or skill" value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm" />
          </div>
          <select aria-label="Filter by status" value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm sm:w-44">
            <option value="">All statuses</option>
            {Object.entries(JOB_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <DataTable caption="Job openings" columns={columns} rows={q.data?.data} isLoading={q.isLoading} isFetching={q.isFetching} error={q.error} onRetry={q.refetch} empty={<EmptyState icon={Briefcase} title="No job openings" />} />
        <Pagination meta={q.data?.meta} onPageChange={(p) => setParams({ ...(status ? { status } : {}), page: String(p) })} />
      </Card>
    </>
  );
}

const jobSchema = z.object({
  title: z.string().trim().min(2, 'Title is required').max(120),
  departmentId: z.string().min(1, 'Choose a department'),
  designationId: z.string(),
  employmentType: z.string().min(1),
  workLocation: z.string().trim().max(120),
  openings: z.coerce.number().int().min(1, 'At least 1').max(500),
  hiringManager: z.object({ id: z.string(), fullName: z.string() }).nullable(),
  skills: z.string().max(2000),
  closesOn: z.union([z.literal(''), z.iso.date()]),
  description: z.string().trim().max(10_000),
  publish: z.boolean(),
});

export function JobFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const job = useJob(id);
  const departments = useDepartments();
  const designations = useDesignations();
  const { createJob, updateJob } = useRecruitmentMutations();
  const mutation = id ? updateJob : createJob;
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(jobSchema), defaultValues: { title: '', departmentId: '', designationId: '', employmentType: 'full_time', workLocation: '', openings: 1, hiringManager: null, skills: '', closesOn: '', description: '', publish: true } });
  useEffect(() => {
    if (job.data) {
      const j = job.data;
      reset({ title: j.title, departmentId: j.department?.id ?? '', designationId: j.designation?.id ?? '', employmentType: j.employmentType, workLocation: j.workLocation, openings: j.openings, hiringManager: j.hiringManager, skills: j.requiredSkills.join(', '), closesOn: j.closesOn ?? '', description: j.description, publish: true });
    }
  }, [job.data, reset]);
  if (id && job.isLoading) return <PageLoader />;
  if (id && job.error) return <ErrorState error={job.error} onRetry={job.refetch} />;

  const onSubmit = handleSubmit(async ({ hiringManager, skills, publish, closesOn, designationId, ...v }) => {
    const body = { ...v, designationId: designationId || null, hiringManagerId: hiringManager?.id ?? null, requiredSkills: skills.split(',').map((s) => s.trim()).filter(Boolean), closesOn: closesOn || null };
    try {
      const saved = id ? await updateJob.mutateAsync({ id, ...body }) : await createJob.mutateAsync({ ...body, status: publish ? 'open' : 'draft' });
      toast.success(id ? 'Job updated' : `Job ${saved.code} created`);
      navigate(`/recruitment/jobs/${saved.id}`);
    } catch (err) {
      if (!applyFieldErrors(err, setError)) toast.error(err.message);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader
        title={id ? `Edit ${job.data.code}` : 'New job opening'}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {id ? 'Save' : 'Create job'}
            </Button>
          </>
        }
      />
      <Card>
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Input label="Job title" required className="sm:col-span-2 lg:col-span-3" error={errors.title?.message} {...register('title')} />
          <Select label="Department" required error={errors.departmentId?.message} {...register('departmentId')}>
            <option value="">Choose…</option>
            {departments.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select label="Designation / level" {...register('designationId')}>
            <option value="">Not specified</option>
            {designations.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </Select>
          <Select label="Employment type" {...register('employmentType')}>
            {Object.entries(EMPLOYMENT_TYPES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <Input label="Work location" {...register('workLocation')} />
          <Input label="Openings" type="number" min={1} error={errors.openings?.message} {...register('openings')} />
          <Input label="Closes on" type="date" {...register('closesOn')} />
          <Controller control={control} name="hiringManager" render={({ field }) => <EmployeePicker label="Hiring manager" value={field.value} onChange={field.onChange} hint="They can follow this pipeline and see interview feedback" />} />
          <Input label="Required skills" className="sm:col-span-2" hint="Comma-separated, e.g. Node.js, MongoDB" {...register('skills')} />
          <Textarea label="Description" rows={8} className="sm:col-span-2 lg:col-span-3" {...register('description')} />
          {!id && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="accent-brand-700" {...register('publish')} /> Open for applications now (otherwise saved as draft)
            </label>
          )}
        </div>
      </Card>
    </form>
  );
}

export function JobDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const q = useJob(id);
  const { updateJob } = useRecruitmentMutations();
  if (q.isLoading) return <PageLoader label="Loading job" />;
  if (q.error) return <ErrorState error={q.error} title={q.error.status === 404 ? 'Job opening not found' : undefined} />;
  const j = q.data;
  const canManage = can('recruitment:jobs:manage');
  const setStatus = (status) => updateJob.mutateAsync({ id, status }).then(() => toast.success(`Job ${JOB_STATUS[status].label.toLowerCase()}`), (e) => toast.error(e.message));

  return (
    <>
      <PageHeader
        title={j.title}
        description={`${j.code} · ${j.department?.name}${j.designation ? ` · ${j.designation.title}` : ''} · ${EMPLOYMENT_TYPES[j.employmentType]}${j.workLocation ? ` · ${j.workLocation}` : ''}`}
        actions={
          canManage && (
            <>
              <Link to={`/recruitment/jobs/${id}/edit`} className={buttonClass({ variant: 'secondary' })}>
                <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
              </Link>
              <Menu
                label="Change job status"
                items={JOB_TRANSITIONS[j.status].map((s) => ({ label: { open: 'Open for applications', on_hold: 'Put on hold', closed: 'Close', filled: 'Mark filled' }[s], onSelect: () => setStatus(s) }))}
                trigger={(props) => (
                  <Button variant="secondary" {...props}>
                    Status
                  </Button>
                )}
              />
            </>
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-slate-500">Status</p>
          <div className="mt-1">
            <JobStatusBadge status={j.status} />
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">Hired</p>
          <p className="text-xl font-semibold tabular-nums text-slate-900">
            {j.pipeline.hired} / {j.openings}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">Active candidates</p>
          <p className="text-xl font-semibold tabular-nums text-slate-900">{j.pipeline.active}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">Hiring manager</p>
          <p className="truncate text-sm font-medium text-slate-900">{j.hiringManager?.fullName ?? '—'}</p>
        </Card>
      </div>
      <Card className="mb-6">
        <CardHeader title="Pipeline" actions={can('recruitment:candidates:manage') && j.status === 'open' && <Link to={`/recruitment/candidates?addTo=${id}`} className={buttonClass({ size: 'sm' })}><Plus className="h-4 w-4" aria-hidden="true" /> Add candidate</Link>} />
        <div className="p-4">
          <PipelineBoard jobId={id} />
        </div>
      </Card>
      <Card>
        <CardHeader title="About the role" />
        <div className="space-y-3 p-5 text-sm text-slate-700">
          {j.requiredSkills.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {j.requiredSkills.map((s) => (
                <Badge key={s} tone="brand">
                  {s}
                </Badge>
              ))}
            </div>
          )}
          <p className="whitespace-pre-line">{j.description || 'No description yet.'}</p>
        </div>
      </Card>
    </>
  );
}
