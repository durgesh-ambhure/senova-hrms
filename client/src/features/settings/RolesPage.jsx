import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import clsx from 'clsx';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { usePermissionCatalog, useRoleMutations, useRoles } from './api.js';
import { applyFieldErrors } from '../../lib/api.js';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, ErrorState, Input, Modal, PageHeader, PageLoader, useToast } from '../../components/ui/index.js';

const newRoleSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(60),
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use lower_snake_case, e.g. finance_viewer'),
  description: z.string().trim().max(300).optional(),
});

function NewRoleModal({ open, onClose, onCreated }) {
  const { create } = useRoleMutations();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm({ resolver: zodResolver(newRoleSchema), defaultValues: { name: '', key: '', description: '' } });

  useEffect(() => {
    if (open) {
      reset();
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const role = await create.mutateAsync({ ...values, permissions: [] });
      onCreated(role);
    } catch (err) {
      applyFieldErrors(err, setError, ['name', 'key', 'description']);
    }
  });

  const nameField = register('name', {
    onChange: (e) => {
      if (!dirtyFields.key) setValue('key', e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40));
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New role"
      description="Create the role, then choose its permissions."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="role-form" loading={create.isPending}>
            Create role
          </Button>
        </>
      }
    >
      <form id="role-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {create.error && !create.error.details && <Alert>{create.error.message}</Alert>}
        <Input label="Name" required error={errors.name?.message} data-autofocus {...nameField} />
        <Input label="Key" required hint="Used internally; cannot be changed later." error={errors.key?.message} {...register('key')} />
        <Input label="Description" error={errors.description?.message} {...register('description')} />
      </form>
    </Modal>
  );
}

export function RolesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const canManage = can('roles:manage');
  const roles = useRoles();
  const catalog = usePermissionCatalog();
  const { update, remove } = useRoleMutations();
  const [selectedKey, setSelectedKey] = useState(null);
  const [edits, setEdits] = useState(null); // { key, updatedAt, permissions: Set }
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selected = roles.data?.find((r) => r.key === selectedKey) ?? roles.data?.[0];
  // Unsaved edits apply only to the role version they were made on; otherwise show saved permissions.
  const draft =
    selected && edits?.key === selected.key && edits.updatedAt === selected.updatedAt ? edits.permissions : selected && new Set(selected.permissions);

  const grouped = useMemo(() => {
    const groups = new Map();
    for (const p of catalog.data ?? []) groups.set(p.module, [...(groups.get(p.module) ?? []), p]);
    return [...groups.entries()];
  }, [catalog.data]);

  if (roles.isLoading || catalog.isLoading) return <PageLoader label="Loading roles" />;
  if (roles.error || catalog.error) return <ErrorState error={roles.error ?? catalog.error} onRetry={() => (roles.refetch(), catalog.refetch())} />;

  const editable = canManage && selected?.editable;
  const isWildcard = selected?.permissions.includes('*');
  const dirty = draft && selected && (draft.size !== selected.permissions.length || selected.permissions.some((p) => !draft.has(p)));

  const toggle = (permission) => {
    const next = new Set(draft);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    setEdits({ key: selected.key, updatedAt: selected.updatedAt, permissions: next });
  };

  const save = async () => {
    try {
      await update.mutateAsync({ key: selected.key, permissions: [...draft].sort() });
      toast.success(`${selected.name} updated. Users with this role get the change on their next request.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const doDelete = async () => {
    try {
      await remove.mutateAsync(selected.key);
      toast.success('Role deleted');
      setSelectedKey(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Users can hold several roles; their access is the combination of all of them."
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" /> New role
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <Card className="h-fit">
          <ul className="divide-y divide-slate-100" aria-label="Roles">
            {roles.data.map((r) => (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(r.key)}
                  aria-current={r.key === selected?.key ? 'true' : undefined}
                  className={clsx('flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50', r.key === selected?.key && 'bg-brand-50')}
                >
                  <span>
                    <span className="block text-sm font-medium text-slate-900">{r.name}</span>
                    <span className="block text-xs text-slate-500">
                      {r.userCount} {r.userCount === 1 ? 'user' : 'users'}
                    </span>
                  </span>
                  {!r.isSystem && <Badge tone="accent">Custom</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {selected && (
          <Card>
            <CardHeader
              title={selected.name}
              description={selected.description}
              actions={
                <>
                  {canManage && !selected.isSystem && (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
                    </Button>
                  )}
                  {editable && (
                    <Button size="sm" onClick={save} disabled={!dirty} loading={update.isPending}>
                      Save permissions
                    </Button>
                  )}
                </>
              }
            />
            <div className="space-y-6 p-5">
              {isWildcard && (
                <Alert tone="info">
                  <span className="inline-flex items-center gap-2">
                    <Lock className="h-4 w-4" aria-hidden="true" /> Super Admin has every permission and cannot be modified.
                  </span>
                </Alert>
              )}
              {!isWildcard &&
                grouped.map(([module, perms]) => (
                  <fieldset key={module}>
                    <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{module}</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {perms.map((p) => (
                        <Checkbox
                          key={p.key}
                          label={p.label}
                          description={p.key}
                          checked={draft?.has(p.key) ?? false}
                          onChange={() => toggle(p.key)}
                          disabled={!editable}
                        />
                      ))}
                    </div>
                  </fieldset>
                ))}
            </div>
          </Card>
        )}
      </div>

      <NewRoleModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(role) => {
          setCreating(false);
          setSelectedKey(role.key);
          toast.success(`Role “${role.name}” created. Now choose its permissions.`);
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete role"
        description={`Delete “${selected?.name}”? This is only possible when no user holds the role.`}
        confirmLabel="Delete"
        tone="danger"
        loading={remove.isPending}
        onConfirm={doDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
