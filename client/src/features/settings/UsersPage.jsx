import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { LogOut, Mail, MoreHorizontal, Pencil, Search, UserPlus, KeyRound, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useRoles, useUserMutations, useUsers } from './api.js';
import { UserFormModal } from './UserFormModal.jsx';
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, Menu, PageHeader, Pagination, StatusBadge, useToast } from '../../components/ui/index.js';
import { useDebouncedValue } from '../../lib/useDebouncedValue.js';
import { formatDateTime } from '../../lib/format.js';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'invited', label: 'Invited' },
  { value: 'disabled', label: 'Disabled' },
];

export function UsersPage() {
  const { can } = useAuth();
  const toast = useToast();
  const canManage = can('users:manage');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debouncedSearch = useDebouncedValue(search.trim());

  const query = {
    page: Number(params.get('page') ?? 1),
    limit: 20,
    sort: params.get('sort') ?? 'name',
    status: params.get('status') ?? '',
    role: params.get('role') ?? '',
    search: debouncedSearch,
  };
  const users = useUsers(query);
  const roles = useRoles(can('roles:read'));
  const mutations = useUserMutations();
  const [editing, setEditing] = useState(null); // null | 'new' | user
  const [confirm, setConfirm] = useState(null); // { user, action }

  const setParam = (key, value) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    });

  const roleName = (key) => roles.data?.find((r) => r.key === key)?.name ?? key;

  const actions = {
    resendInvite: { title: 'Resend invitation', description: (u) => `Send a new invitation link to ${u.email}? Previous links stop working.`, run: mutations.resendInvite, done: 'Invitation sent' },
    sendResetLink: { title: 'Send password reset link', description: (u) => `Email a password reset link to ${u.email}?`, run: mutations.sendResetLink, done: 'Reset link sent' },
    revokeSessions: { title: 'Sign out everywhere', description: (u) => `${u.name} will be signed out on every device.`, run: mutations.revokeSessions, done: 'User signed out of all sessions' },
  };

  const runConfirm = async () => {
    const { user, action } = confirm;
    try {
      await actions[action].run.mutateAsync(user.id);
      toast.success(actions[action].done);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConfirm(null);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (u) => (
        <div>
          <p className="font-medium text-slate-900">{u.name}</p>
          <p className="text-xs text-slate-500">{u.email}</p>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (u) => (
        <div className="flex flex-wrap gap-1">
          {u.roles.map((r) => (
            <Badge key={r} tone={r === 'super_admin' ? 'brand' : 'neutral'}>
              {roleName(r)}
            </Badge>
          ))}
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (u) => <StatusBadge status={u.status} /> },
    { key: 'lastLoginAt', header: 'Last sign-in', sortable: true, className: 'whitespace-nowrap', render: (u) => formatDateTime(u.lastLoginAt) },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'w-12 text-right',
            render: (u) => (
              <Menu
                label={`Actions for ${u.name}`}
                items={[
                  { label: 'Edit', icon: Pencil, onSelect: () => setEditing(u) },
                  { label: 'Resend invitation', icon: Mail, onSelect: () => setConfirm({ user: u, action: 'resendInvite' }), hidden: u.status !== 'invited' },
                  { label: 'Send reset link', icon: KeyRound, onSelect: () => setConfirm({ user: u, action: 'sendResetLink' }), hidden: u.status !== 'active' },
                  { label: 'Sign out everywhere', icon: LogOut, onSelect: () => setConfirm({ user: u, action: 'revokeSessions' }), hidden: u.status !== 'active' },
                ]}
                trigger={(props) => (
                  <button type="button" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" {...props}>
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                )}
              />
            ),
          },
        ]
      : []),
  ];

  const filtered = Boolean(query.search || query.status || query.role);

  return (
    <>
      <PageHeader
        title="Users"
        description="Login accounts and their roles. Employee profiles are managed separately."
        actions={
          canManage &&
          roles.data && (
            <Button onClick={() => setEditing('new')}>
              <UserPlus className="h-4 w-4" aria-hidden="true" /> Invite user
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setParam('page', '');
              }}
              placeholder="Search by name or email"
              aria-label="Search users"
              className="h-10 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <select aria-label="Filter by status" value={query.status} onChange={(e) => setParam('status', e.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm sm:w-44">
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select aria-label="Filter by role" value={query.role} onChange={(e) => setParam('role', e.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm sm:w-48">
            <option value="">All roles</option>
            {roles.data?.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <DataTable
          caption="User accounts"
          columns={columns}
          rows={users.data?.data}
          isLoading={users.isLoading}
          isFetching={users.isFetching}
          error={users.error}
          onRetry={users.refetch}
          sort={query.sort}
          onSortChange={(s) => setParam('sort', s)}
          empty={
            <EmptyState
              icon={Users}
              title={filtered ? 'No users match these filters' : 'No users yet'}
              description={filtered ? 'Try a different search or clear the filters.' : 'Invite your first colleague to get started.'}
            />
          }
        />
        <Pagination meta={users.data?.meta} onPageChange={(p) => setParam('page', String(p))} />
      </Card>

      {canManage && roles.data && (
        <UserFormModal
          open={editing !== null}
          onClose={() => setEditing(null)}
          user={editing === 'new' ? null : editing}
          roles={roles.data}
          mutation={editing === 'new' ? mutations.create : mutations.update}
          onSaved={(saved) => {
            setEditing(null);
            if (editing === 'new') {
              toast[saved.inviteSent ? 'success' : 'error'](
                saved.inviteSent ? `Invitation sent to ${saved.email}` : 'User created, but the invitation email failed. Use “Resend invitation”.',
              );
            } else toast.success('User updated');
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm ? actions[confirm.action].title : ''}
        description={confirm ? actions[confirm.action].description(confirm.user) : ''}
        loading={confirm ? actions[confirm.action].run.isPending : false}
        onConfirm={runConfirm}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
