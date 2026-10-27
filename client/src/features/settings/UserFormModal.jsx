import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Button, Checkbox, Input, Modal, Select } from '../../components/ui/index.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import { applyFieldErrors } from '../../lib/api.js';
import { emailSchema } from '../../lib/passwordPolicy.js';

const baseSchema = {
  name: z.string().trim().min(2, 'Name is required').max(120),
  roles: z.array(z.string()).min(1, 'Assign at least one role'),
};
const createSchema = z.object({ ...baseSchema, email: emailSchema });
const editSchema = z.object({ ...baseSchema, status: z.enum(['active', 'disabled', 'invited']) });

/** Invite (no `user`) or edit (with `user`) an account. */
export function UserFormModal({ open, onClose, user, roles, mutation, onSaved }) {
  const { user: me, can } = useAuth();
  const isEdit = Boolean(user);
  const isSelf = isEdit && user.id === me.id;
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(isEdit ? editSchema : createSchema) });

  useEffect(() => {
    if (open) {
      reset(isEdit ? { name: user.name, roles: user.roles, status: user.status } : { name: '', email: '', roles: ['employee'] });
      mutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);

  const onSubmit = handleSubmit(async (values) => {
    const body = isEdit
      ? { id: user.id, name: values.name, ...(isSelf ? {} : { roles: values.roles }), ...(isSelf || user.status === 'invited' ? {} : { status: values.status }) }
      : values;
    try {
      const saved = await mutation.mutateAsync(body);
      onSaved(saved);
    } catch (err) {
      applyFieldErrors(err, setError, ['name', 'email', 'roles']);
    }
  });

  // Only a Super Admin may grant super_admin; others don't see it as an option.
  const assignable = roles.filter((r) => r.key !== 'super_admin' || can('*'));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit user' : 'Invite user'}
      description={isEdit ? user.email : 'They will receive an email link to set their own password.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" loading={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Send invitation'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {mutation.error && !mutation.error.details && <Alert>{mutation.error.message}</Alert>}
        <Input label="Full name" required error={errors.name?.message} data-autofocus {...register('name')} />
        {!isEdit && <Input label="Work email" type="email" required error={errors.email?.message} {...register('email')} />}
        {isEdit && !isSelf && user.status !== 'invited' && (
          <Select label="Status" {...register('status')}>
            <option value="active">Active</option>
            <option value="disabled">Disabled — cannot sign in</option>
          </Select>
        )}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">Roles</legend>
          {isSelf && <p className="mb-2 text-xs text-slate-500">You can't change your own roles.</p>}
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            {assignable.map((role) => (
              <Checkbox key={role.key} value={role.key} label={role.name} description={role.description} disabled={isSelf} {...register('roles')} />
            ))}
          </div>
          {errors.roles && (
            <p className="mt-1.5 text-xs text-red-600" role="alert">
              {errors.roles.message}
            </p>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
