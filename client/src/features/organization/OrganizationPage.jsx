import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Archive, ArchiveRestore, Building, Pencil, Plus } from 'lucide-react';
import { useDepartments, useDesignations, useOrgMutations } from '../employees/api.js';
import { applyFieldErrors } from '../../lib/api.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, TabPanel, Tabs, Textarea, useToast } from '../../components/ui/index.js';

const departmentSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(100),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,12}$/, '2–12 letters, digits or hyphens'),
  description: z.string().trim().max(500),
});
const designationSchema = z.object({
  title: z.string().trim().min(2, 'Title is required').max(100),
  level: z.coerce.number().int().min(1, '1–20').max(20, '1–20'),
  description: z.string().trim().max(500),
});

function OrgFormModal({ kind, item, open, onClose }) {
  const toast = useToast();
  const { create, update } = useOrgMutations(kind);
  const mutation = item ? update : create;
  const isDept = kind === 'department';
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(isDept ? departmentSchema : designationSchema) });

  useEffect(() => {
    if (!open) return;
    mutation.reset();
    reset(isDept ? { name: item?.name ?? '', code: item?.code ?? '', description: item?.description ?? '' } : { title: item?.title ?? '', level: item?.level ?? 1, description: item?.description ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync(item ? { id: item.id, ...values } : values);
      toast.success(`${isDept ? 'Department' : 'Designation'} ${item ? 'updated' : 'created'}`);
      onClose();
    } catch (err) {
      applyFieldErrors(err, setError);
    }
  });

  const noun = isDept ? 'department' : 'designation';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? `Edit ${noun}` : `New ${noun}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="org-form" loading={mutation.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="org-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {mutation.error && !mutation.error.details && <Alert>{mutation.error.message}</Alert>}
        {isDept ? (
          <>
            <Input label="Name" required data-autofocus error={errors.name?.message} {...register('name')} />
            <Input label="Code" required hint="Short code, e.g. ENG" error={errors.code?.message} {...register('code')} />
          </>
        ) : (
          <>
            <Input label="Title" required data-autofocus error={errors.title?.message} {...register('title')} />
            <Input label="Level" type="number" min={1} max={20} required hint="1 = most junior" error={errors.level?.message} {...register('level')} />
          </>
        )}
        <Textarea label="Description" error={errors.description?.message} {...register('description')} />
      </form>
    </Modal>
  );
}

function OrgTable({ kind }) {
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null); // null | 'new' | item
  const isDept = kind === 'department';
  const departments = useDepartments(showArchived);
  const designations = useDesignations(showArchived);
  const query = isDept ? departments : designations;
  const { update } = useOrgMutations(kind);

  const toggleArchive = async (item) => {
    try {
      await update.mutateAsync({ id: item.id, status: item.status === 'active' ? 'archived' : 'active' });
      toast.success(item.status === 'active' ? 'Archived' : 'Restored');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const columns = [
    isDept
      ? { key: 'name', header: 'Department', render: (d) => <span className="font-medium text-slate-900">{d.name}</span> }
      : { key: 'title', header: 'Designation', render: (d) => <span className="font-medium text-slate-900">{d.title}</span> },
    isDept ? { key: 'code', header: 'Code', render: (d) => <Badge>{d.code}</Badge> } : { key: 'level', header: 'Level' },
    ...(isDept ? [{ key: 'head', header: 'Head', render: (d) => d.head?.name ?? <span className="text-slate-400">—</span> }] : []),
    { key: 'employeeCount', header: 'Current employees', className: 'tabular-nums' },
    { key: 'status', header: 'Status', render: (d) => <Badge tone={d.status === 'active' ? 'success' : 'neutral'}>{d.status === 'active' ? 'Active' : 'Archived'}</Badge> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right whitespace-nowrap',
      render: (d) => (
        <>
          <Button variant="ghost" size="sm" onClick={() => setEditing(d)} aria-label={`Edit ${d.name ?? d.title}`}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => toggleArchive(d)} aria-label={`${d.status === 'active' ? 'Archive' : 'Restore'} ${d.name ?? d.title}`}>
            {d.status === 'active' ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
          </Button>
        </>
      ),
    },
  ];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-brand-700" />
          Show archived
        </label>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" aria-hidden="true" /> New {kind}
        </Button>
      </div>
      <DataTable
        caption={isDept ? 'Departments' : 'Designations'}
        columns={columns}
        rows={query.data}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        empty={<EmptyState icon={Building} title={`No ${kind}s yet`} description={`Create your first ${kind} to start adding employees.`} />}
      />
      <OrgFormModal kind={kind} item={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </Card>
  );
}

export function OrganizationPage() {
  const [tab, setTab] = useState('departments');
  return (
    <>
      <PageHeader title="Organization" description="Departments and designations used across employee records." />
      <Tabs
        label="Organization"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'departments', label: 'Departments' },
          { value: 'designations', label: 'Designations' },
        ]}
      />
      <TabPanel value={tab}>{tab === 'departments' ? <OrgTable kind="department" /> : <OrgTable kind="designation" />}</TabPanel>
    </>
  );
}
