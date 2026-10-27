import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, sessionFor } from '../../test/utils.jsx';

const anonymous = { 'GET /auth/me': [401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }] };
const dashboard = { 'GET /dashboard/summary': [200, { data: { company: { displayName: 'Senova' }, user: { name: 'Priya Sharma', lastLoginAt: null }, widgets: {} } }] };

describe('authentication flow', () => {
  it('redirects anonymous users from protected pages to the login page', async () => {
    mockApi(anonymous);
    renderApp('/settings/users');
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('validates the login form before calling the API', async () => {
    const { calls } = mockApi(anonymous);
    renderApp('/login');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Work email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/auth/login')).toBe(false);
  });

  it('shows the server message when credentials are rejected', async () => {
    mockApi({ ...anonymous, 'POST /auth/login': [401, { error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password' } }] });
    renderApp('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Work email'), 'priya@senova.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('signs in with the CSRF header and lands on the dashboard', async () => {
    const [, session] = sessionFor(['self:profile']);
    const { calls } = mockApi({
      ...anonymous,
      ...dashboard,
      'POST /auth/login': [200, { data: { ...session.data, csrfToken: 'fresh-token' } }],
    });
    renderApp('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Work email'), 'priya@senova.test');
    await user.type(screen.getByLabelText('Password'), 'Correct-password-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: /Priya/ })).toBeInTheDocument();
    const login = calls.find((c) => c.path === '/auth/login');
    expect(login.headers['X-CSRF-Token']).toBe('test-csrf');
    expect(login.body).toEqual({ email: 'priya@senova.test', password: 'Correct-password-1' });
  });

  it('enforces the password policy on the reset form', async () => {
    mockApi(anonymous);
    renderApp('/reset-password?token=abcdefghijklmnopqrstuvwxyz');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Password must be at least 12 characters')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
  });

  it('drops the user back to login when the session expires mid-use', async () => {
    let meCalls = 0;
    mockApi({
      'GET /auth/me': () => (++meCalls === 1 ? sessionFor(['self:profile']) : anonymous['GET /auth/me']),
      'GET /dashboard/summary': [401, { error: { code: 'UNAUTHENTICATED', message: 'Your session has expired.' } }],
    });
    renderApp('/dashboard');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument());
  });
});
