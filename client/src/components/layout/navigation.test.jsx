import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { mockApi, renderApp, sessionFor } from '../../test/utils.jsx';

const summary = (widgets = {}) => [
  200,
  {
    data: {
      company: { displayName: 'Senova' },
      user: { name: 'Priya Sharma', lastLoginAt: null },
      widgets,
    },
  },
];

describe('permission-aware navigation', () => {
  it('shows employees only the items they can use', async () => {
    mockApi({
      'GET /auth/me': sessionFor(['company:read', 'self:profile']),
      'GET /dashboard/summary': summary(),
    });
    renderApp('/dashboard');
    const nav = await screen.findAllByRole('navigation', { name: 'Main' });
    const links = within(nav[0])
      .getAllByRole('link')
      .map((l) => l.textContent);
    expect(links).toEqual(['Dashboard', 'My profile', 'Holidays']);
    expect(await screen.findByText('Your workspace is being set up')).toBeInTheDocument();
  });

  it('shows administration items to a super admin', async () => {
    mockApi({
      'GET /auth/me': sessionFor(['*'], { roles: ['super_admin'] }),
      'GET /dashboard/summary': summary({
        userAccounts: { active: 3, invited: 1, disabled: 0 },
        recentActivity: [],
      }),
    });
    renderApp('/dashboard');
    const nav = await screen.findAllByRole('navigation', { name: 'Main' });
    const links = within(nav[0])
      .getAllByRole('link')
      .map((l) => l.textContent);
    expect(links).toEqual([
      'Dashboard',
      'My profile',
      'Employees',
      'Onboarding',
      'Attendance',
      'Leave',
      'Leave balances',
      'Timesheets',
      'Holidays',
      'Jobs',
      'Candidates',
      'Pipeline',
      'Interviews',
      'Offers',
      'Payroll runs',
      'Payslips',
      'Salaries',
      'Payroll settings',
      'Reports',
      'Organization',
      'Time & leave policies',
      'Users',
      'Roles & permissions',
      'Company',
      'Audit log',
    ]);
    expect(await screen.findByText('Active accounts')).toBeInTheDocument();
  });

  it('labels the directory "My team" for managers without company-wide access', async () => {
    mockApi({
      'GET /auth/me': sessionFor(['employees:read:team', 'self:profile', 'self:onboarding'], { employee: 'e1' }),
      'GET /dashboard/summary': summary(),
    });
    renderApp('/dashboard');
    const nav = await screen.findAllByRole('navigation', { name: 'Main' });
    const links = within(nav[0])
      .getAllByRole('link')
      .map((l) => l.textContent);
    expect(links).toEqual(['Dashboard', 'My profile', 'My team', 'Onboarding', 'Holidays']);
  });

  it('shows a forbidden page when a user opens a page they lack permission for', async () => {
    mockApi({ 'GET /auth/me': sessionFor(['self:profile']) });
    renderApp('/settings/users');
    expect(
      await screen.findByRole('heading', {
        name: "You don't have access to this page",
      }),
    ).toBeInTheDocument();
  });

  it('shows a not-found page for unknown routes', async () => {
    mockApi({ 'GET /auth/me': sessionFor(['self:profile']) });
    renderApp('/nowhere');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
