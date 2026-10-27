import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useHolidayMutations, useHolidays } from './api.js';
import { applyFieldErrors } from '../../lib/api.js';
import { HOLIDAY_TYPES } from '../../lib/labels.js';
import { formatDayShort, localToday } from '../../lib/format.js';
import { Alert, Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, Input, Modal, PageHeader, Select, Textarea, useToast } from '../../components/ui/index.js';

const schema = z.object({
  date: z.iso.date('Choose a date'),
  name: z.string().trim().min(2, 'Name is required').max(100),
  type: z.enum(['public', 'company', 'optional']),
  locations: z.string().max(1000),
  description: z.string().trim().max(300),
});

function HolidayModal({ holiday, onClose }) {
  const toast = useToast();
  const { create, update } = useHolidayMutations();
  const mutation = holiday ? update : create;
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema) });
  useEffect(() => {
    reset(holiday ? { ...holiday, locations: holiday.locations.join(', ') } : { date: '', name: '', type: 'public', locations: '', description: '' });
  }, [holiday, reset]);
  const onSubmit = handleSubmit(async (values) => {
    const body = { ...values, locations: values.locations.split(',').map((l) => l.trim()).filter(Boolean) };
    try {
      await mutation.mutateAsync(holiday ? { id: holiday.id, ...body } : body);
      toast.success(holiday ? 'Holiday updated' : 'Holiday added');
      onClose();
    } catch (err) {
      if (!applyFieldErrors(err, setError)) toast.error(err.message);
    }
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={holiday ? 'Edit holiday' : 'Add holiday'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="holiday-form" loading={mutation.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="holiday-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <Input label="Date" type="date" required min={localToday()} error={errors.date?.message} {...register('date')} />
        <Input label="Name" required error={errors.name?.message} {...register('name')} />
        <Select label="Type" hint="Optional holidays stay working days unless the employee takes leave." {...register('type')}>
          {Object.entries(HOLIDAY_TYPES).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Input label="Work locations" placeholder="All locations" hint="Comma-separated, e.g. Pune, Mumbai. Leave empty for everyone." error={errors.locations?.message} {...register('locations')} />
        <Textarea label="Description" rows={2} {...register('description')} />
      </form>
    </Modal>
  );
}

export function HolidaysPage() {
  const { can } = useAuth();
  const toast = useToast();
  const canManage = can('organization:manage');
  const [year, setYear] = useState(() => new Date().getFullYear());
  const q = useHolidays(year);
  const { remove } = useHolidayMutations();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const today = localToday();

  const columns = [
    { key: 'date', header: 'Date', className: 'whitespace-nowrap', render: (h) => <span className={h.date < today ? 'text-slate-400' : 'font-medium text-slate-900'}>{formatDayShort(h.date)}</span> },
    { key: 'name', header: 'Holiday', render: (h) => <span className="font-medium text-slate-900">{h.name}</span> },
    { key: 'type', header: 'Type', render: (h) => <Badge tone={h.type === 'optional' ? 'neutral' : 'accent'}>{HOLIDAY_TYPES[h.type]}</Badge> },
    { key: 'locations', header: 'Applies to', render: (h) => (h.locations.length ? h.locations.join(', ') : 'All locations') },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'text-right whitespace-nowrap',
            render: (h) =>
              h.date >= today && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(h)} aria-label={`Edit ${h.name}`}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(h)} aria-label={`Remove ${h.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Holidays"
        description="Company holiday calendar. Past holidays are locked because attendance and leave depend on them."
        actions={
          canManage && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add holiday
            </Button>
          )
        }
      />
      <Card>
        <div className="flex items-center gap-2 border-b border-slate-100 p-4">
          <Button variant="ghost" size="sm" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-14 text-center font-semibold text-slate-900">{year}</span>
          <Button variant="ghost" size="sm" onClick={() => setYear((y) => y + 1)} aria-label="Next year">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <DataTable
          caption={`Holidays in ${year}`}
          columns={columns}
          rows={q.data}
          isLoading={q.isLoading}
          error={q.error}
          onRetry={q.refetch}
          empty={<EmptyState icon={CalendarDays} title={`No holidays for ${year}`} description={canManage ? 'Add the festival and company holidays your offices observe.' : undefined} />}
        />
      </Card>
      {!canManage && (
        <div className="mt-4">
          <Alert tone="info">Holidays are managed by HR.</Alert>
        </div>
      )}
      {editing && <HolidayModal holiday={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove holiday"
        description={`Remove ${deleting?.name} on ${deleting ? formatDayShort(deleting.date) : ''}?`}
        confirmLabel="Remove"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() =>
          remove
            .mutateAsync(deleting.id)
            .then(() => toast.success('Holiday removed'), (e) => toast.error(e.message))
            .finally(() => setDeleting(null))
        }
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
