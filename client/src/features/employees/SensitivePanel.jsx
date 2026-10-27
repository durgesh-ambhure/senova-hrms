import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Lock, Pencil } from 'lucide-react';
import { useEmployeeMutations, useSensitive } from './api.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import { applyFieldErrors } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { Alert, Button, Card, CardHeader, ErrorState, Input, Modal, Spinner, useToast } from '../../components/ui/index.js';

const opt = (re, msg) => z.union([z.literal(''), z.string().trim().regex(re, msg)]);
const schema = z.object({
  bank: z.object({
    accountHolderName: z.string().trim().max(120),
    bankName: z.string().trim().max(120),
    branch: z.string().trim().max(120),
    ifsc: opt(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, 'Enter a valid IFSC, e.g. HDFC0001234'),
    accountNumber: opt(/^\d{9,18}$/, 'Account number must be 9–18 digits'),
  }),
  pan: opt(/^[A-Za-z]{5}\d{4}[A-Za-z]$/, 'Enter a valid PAN, e.g. ABCDE1234F'),
  aadhaarLast4: opt(/^\d{4}$/, 'Enter only the last 4 digits'),
  uan: opt(/^\d{12}$/, 'UAN must be 12 digits'),
});

function EditSensitiveModal({ employee, current, open, onClose }) {
  const toast = useToast();
  const { updateSensitive } = useEmployeeMutations(employee.id);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, dirtyFields },
  } = useForm({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    updateSensitive.reset();
    // Masked numbers are never pre-filled: leave blank to keep the stored value.
    reset({ bank: { accountHolderName: current.bank.accountHolderName, bankName: current.bank.bankName, branch: current.bank.branch, ifsc: current.bank.ifsc, accountNumber: '' }, pan: '', aadhaarLast4: current.aadhaarLast4 ?? '', uan: current.uan ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = handleSubmit(async (values) => {
    const body = { bank: { ...values.bank } };
    if (!dirtyFields.bank?.accountNumber) delete body.bank.accountNumber;
    if (dirtyFields.pan) body.pan = values.pan;
    if (dirtyFields.aadhaarLast4) body.aadhaarLast4 = values.aadhaarLast4;
    if (dirtyFields.uan) body.uan = values.uan;
    try {
      await updateSensitive.mutateAsync(body);
      toast.success('Bank and identity details saved');
      onClose();
    } catch (err) {
      if (!applyFieldErrors(err, setError)) toast.error(err.message);
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bank & identity details"
      description="Account number and PAN are encrypted. Leave a number blank to keep the saved value."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="sensitive-form" loading={updateSensitive.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="sensitive-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2" autoComplete="off">
        <Input label="Account holder name" error={errors.bank?.accountHolderName?.message} {...register('bank.accountHolderName')} />
        <Input label="Bank name" error={errors.bank?.bankName?.message} {...register('bank.bankName')} />
        <Input label="Branch" error={errors.bank?.branch?.message} {...register('bank.branch')} />
        <Input label="IFSC" error={errors.bank?.ifsc?.message} {...register('bank.ifsc')} />
        <Input label="Account number" inputMode="numeric" placeholder={current.bank.accountNumber ?? ''} error={errors.bank?.accountNumber?.message} {...register('bank.accountNumber')} />
        <Input label="PAN" placeholder={current.pan ?? ''} error={errors.pan?.message} {...register('pan')} />
        <Input label="Aadhaar (last 4 digits only)" inputMode="numeric" maxLength={4} hint="The full Aadhaar number is never stored." error={errors.aadhaarLast4?.message} {...register('aadhaarLast4')} />
        <Input label="UAN" inputMode="numeric" error={errors.uan?.message} {...register('uan')} />
      </form>
    </Modal>
  );
}

const Row = ({ label, value }) => (
  <div>
    <dt className="text-xs text-slate-500">{label}</dt>
    <dd className="mt-0.5 font-mono text-sm text-slate-900">{value || <span className="font-sans text-slate-400">—</span>}</dd>
  </div>
);

export function SensitivePanel({ employee }) {
  const { can } = useAuth();
  const [reveal, setReveal] = useState(false);
  const [editing, setEditing] = useState(false);
  const q = useSensitive(employee.id, reveal, true);
  const canEdit = can('employees:manage') && !employee.archived;

  return (
    <Card>
      <CardHeader
        title="Bank & identity"
        description="Restricted. Revealing full numbers is recorded in the audit log."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setReveal((r) => !r)} disabled={q.isFetching}>
              {reveal ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              {reveal ? 'Hide numbers' : 'Reveal numbers'}
            </Button>
            {canEdit && q.data && (
              <Button size="sm" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
              </Button>
            )}
          </>
        }
      />
      <div className="p-5">
        {q.isLoading ? (
          <div className="flex justify-center py-6 text-brand-700">
            <Spinner label="Loading" />
          </div>
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={q.refetch} />
        ) : (
          <>
            {!q.data.updatedAt && (
              <div className="mb-4">
                <Alert tone="info">
                  <span className="inline-flex items-center gap-2">
                    <Lock className="h-4 w-4" aria-hidden="true" /> No bank or identity details recorded yet.
                  </span>
                </Alert>
              </div>
            )}
            <dl className="grid gap-4 sm:grid-cols-3">
              <Row label="Account holder" value={q.data.bank.accountHolderName} />
              <Row label="Bank" value={[q.data.bank.bankName, q.data.bank.branch].filter(Boolean).join(', ')} />
              <Row label="IFSC" value={q.data.bank.ifsc} />
              <Row label="Account number" value={q.data.bank.accountNumber} />
              <Row label="PAN" value={q.data.pan} />
              <Row label="Aadhaar" value={q.data.aadhaarLast4 ? `XXXX XXXX ${q.data.aadhaarLast4}` : ''} />
              <Row label="UAN" value={q.data.uan} />
            </dl>
            {q.data.updatedAt && <p className="mt-4 text-xs text-slate-500">Last updated {formatDateTime(q.data.updatedAt)}</p>}
          </>
        )}
      </div>
      {q.data && <EditSensitiveModal employee={employee} current={q.data} open={editing} onClose={() => setEditing(false)} />}
    </Card>
  );
}
