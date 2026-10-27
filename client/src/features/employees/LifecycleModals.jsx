import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Button, Input, Modal, Textarea, useToast } from '../../components/ui/index.js';

const date = z.iso.date('Choose a date');
const ACTIONS = {
  activate: {
    title: 'Mark as joined',
    description: 'Confirms the employee has joined. The joining date becomes the date below.',
    schema: z.object({ effectiveDate: date, note: z.string().max(500) }),
    fields: [['effectiveDate', 'Actual joining date', 'date']],
    confirm: 'Mark as joined',
  },
  start_notice: {
    title: 'Record resignation',
    description: 'Moves the employee to their notice period.',
    schema: z
      .object({ effectiveDate: date, lastWorkingDate: date, reason: z.string().max(500) })
      .refine((v) => v.lastWorkingDate >= v.effectiveDate, { path: ['lastWorkingDate'], message: 'Must be on or after the resignation date' }),
    fields: [
      ['effectiveDate', 'Resignation date', 'date'],
      ['lastWorkingDate', 'Last working day', 'date'],
    ],
    textField: ['reason', 'Reason'],
    confirm: 'Start notice period',
  },
  withdraw_notice: {
    title: 'Withdraw resignation',
    description: 'Returns the employee to active status and clears the exit dates.',
    schema: z.object({ effectiveDate: date, note: z.string().max(500) }),
    fields: [['effectiveDate', 'Withdrawn on', 'date']],
    confirm: 'Withdraw resignation',
  },
  exit: {
    title: 'Complete exit',
    description: 'Marks the employee as exited. Their login, if any, is disabled immediately.',
    schema: z.object({ effectiveDate: date, reason: z.string().trim().min(2, 'Give a reason').max(500) }),
    fields: [['effectiveDate', 'Exit date', 'date']],
    textField: ['reason', 'Reason'],
    confirm: 'Complete exit',
    danger: true,
  },
};

// eslint-disable-next-line react-refresh/only-export-components
export const availableLifecycleActions = (status) =>
  ({ pre_joining: ['activate', 'exit'], active: ['start_notice', 'exit'], notice_period: ['withdraw_notice', 'exit'] })[status] ?? [];

export function LifecycleModal({ action, employee, mutation, onClose }) {
  const toast = useToast();
  const config = ACTIONS[action];
  const today = new Date().toISOString().slice(0, 10);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ resolver: config ? zodResolver(config.schema) : undefined });

  useEffect(() => {
    if (!action) return;
    mutation.reset();
    reset({
      effectiveDate: action === 'exit' ? (employee.exit?.lastWorkingDate ?? today) : today,
      lastWorkingDate: '',
      reason: '',
      note: '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  if (!config) return null;
  const onSubmit = handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync({ action, ...values });
      toast.success(`${config.title}: done`);
      onClose();
    } catch {
      /* shown below */
    }
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={config.title}
      description={`${employee.fullName} · ${config.description}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="lifecycle-form" variant={config.danger ? 'danger' : 'primary'} loading={mutation.isPending}>
            {config.confirm}
          </Button>
        </>
      }
    >
      <form id="lifecycle-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {mutation.error && <Alert>{mutation.error.message}</Alert>}
        {config.fields.map(([name, label, type]) => (
          <Input key={name} label={label} type={type} required error={errors[name]?.message} {...register(name)} />
        ))}
        {config.textField && <Textarea label={config.textField[1]} required={action === 'exit'} error={errors[config.textField[0]]?.message} {...register(config.textField[0])} />}
      </form>
    </Modal>
  );
}

const probationSchemas = {
  confirm: z.object({ effectiveDate: date, note: z.string().max(500) }),
  extend: z.object({ newEndDate: date, note: z.string().trim().min(2, 'Give a reason').max(500) }),
};

export function ProbationModal({ action, employee, mutation, onClose }) {
  const toast = useToast();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ resolver: action ? zodResolver(probationSchemas[action]) : undefined });

  useEffect(() => {
    if (!action) return;
    mutation.reset();
    reset({ effectiveDate: employee.probation?.endDate ?? new Date().toISOString().slice(0, 10), newEndDate: '', note: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  if (!action) return null;
  const onSubmit = handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync({ action, ...values });
      toast.success(action === 'confirm' ? 'Probation confirmed' : 'Probation extended');
      onClose();
    } catch {
      /* shown below */
    }
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={action === 'confirm' ? 'Confirm probation' : 'Extend probation'}
      description={`${employee.fullName} · current end date ${employee.probation?.endDate ?? '—'}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="probation-form" loading={mutation.isPending}>
            {action === 'confirm' ? 'Confirm' : 'Extend'}
          </Button>
        </>
      }
    >
      <form id="probation-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {mutation.error && <Alert>{mutation.error.message}</Alert>}
        {action === 'confirm' ? (
          <Input label="Confirmation date" type="date" required error={errors.effectiveDate?.message} {...register('effectiveDate')} />
        ) : (
          <Input label="New end date" type="date" required error={errors.newEndDate?.message} {...register('newEndDate')} />
        )}
        <Textarea label={action === 'extend' ? 'Reason' : 'Note'} required={action === 'extend'} error={errors.note?.message} {...register('note')} />
      </form>
    </Modal>
  );
}
