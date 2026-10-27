import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, sessionFor } from '../../test/utils.jsx';

const roles = [
  { key: 'super_admin', name: 'Super Admin', description: '', permissions: ['*'], isSystem: true, editable: false, userCount: 1 },
  { key: 'hr_admin', name: 'HR Admin', description: 'HR', permissions: [], isSystem: true, editable: true, userCount: 0 },
  { key: 'employee', name: 'Employee', description: 'Self-service', permissions: [], isSystem: true, editable: true, userCount: 1 },
];
const users = [
  { id: 'u1', name: 'Priya Sharma', email: 'priya@senova.test', roles: ['hr_admin'], status: 'active', lastLoginAt: null },
  { id: 'u2', name: 'Rahul Verma', email: 'rahul@senova.test', roles: ['employee'], status: 'invited', lastLoginAt: null },
];
const page = (data) => [200, { data, meta: { page: 1, limit: 20, total: data.length, totalPages: 1 } }];

describe('users page', () => {
  it('lists users from the API with roles and status', async () => {
    mockApi({ 'GET /auth/me': sessionFor(['users:read', 'roles:read']), 'GET /users': page(users), 'GET /roles': [200, { data: roles }] });
    renderApp('/settings/users');
    const table = await screen.findByRole('table', { name: 'User accounts' });
    expect(await within(table).findByText('Rahul Verma')).toBeInTheDocument();
    expect(within(table).getByText('Invited')).toBeInTheDocument();
    expect(await within(table).findByText('HR Admin')).toBeInTheDocument();
    // Read-only users get no invite button or row actions.
    expect(screen.queryByRole('button', { name: /Invite user/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it('shows an error state with retry when the API fails', async () => {
    mockApi({
      'GET /auth/me': sessionFor(['users:read']),
      'GET /users': [500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again later.' } }],
    });
    renderApp('/settings/users');
    expect(await screen.findByText('Something went wrong. Please try again later.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows a filtered empty state', async () => {
    mockApi({ 'GET /auth/me': sessionFor(['users:read']), 'GET /users': page([]) });
    renderApp('/settings/users?status=disabled');
    expect(await screen.findByText('No users match these filters')).toBeInTheDocument();
  });

  it('invites a user: validates, sends allowlisted fields, hides super admin from non-super-admins', async () => {
    const { calls } = mockApi({
      'GET /auth/me': sessionFor(['users:read', 'users:manage', 'roles:read']),
      'GET /users': page(users),
      'GET /roles': [200, { data: roles }],
      'POST /users': ({ body }) => [201, { data: { id: 'u3', ...body, status: 'invited', inviteSent: true } }],
    });
    renderApp('/settings/users');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Invite user/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite user' });

    expect(within(dialog).queryByLabelText(/Super Admin/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await within(dialog).findByText('Name is required')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Full name/), 'Anita Desai');
    await user.type(within(dialog).getByLabelText(/Work email/), 'anita@senova.test');
    await user.click(within(dialog).getByLabelText(/HR Admin/));
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByText('Invitation sent to anita@senova.test')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/users');
    expect({ ...post.body, roles: [...post.body.roles].sort() }).toEqual({ name: 'Anita Desai', email: 'anita@senova.test', roles: ['employee', 'hr_admin'] });
    expect(post.headers['X-CSRF-Token']).toBe('test-csrf');
  });

  it('shows server-side field errors in the form', async () => {
    mockApi({
      'GET /auth/me': sessionFor(['users:read', 'users:manage', 'roles:read']),
      'GET /users': page(users),
      'GET /roles': [200, { data: roles }],
      'POST /users': [422, { error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: [{ path: 'email', message: 'Email domain not allowed' }] } }],
    });
    renderApp('/settings/users');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Invite user/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Full name/), 'Anita Desai');
    await user.type(within(dialog).getByLabelText(/Work email/), 'anita@elsewhere.test');
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await within(dialog).findByText('Email domain not allowed')).toBeInTheDocument();
  });
});
