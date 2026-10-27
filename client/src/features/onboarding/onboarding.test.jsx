import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, sessionFor } from '../../test/utils.jsx';

const task = (overrides) => ({
  id: 't1',
  employee: { id: 'e1', fullName: 'Neha Patil', employeeCode: 'SEN-0010' },
  kind: 'onboarding',
  title: 'Upload identity proof',
  assigneeType: 'employee',
  dueDate: '2025-06-29',
  overdue: true,
  documentCategory: 'identity',
  document: null,
  status: 'pending',
  ...overrides,
});

describe('onboarding page', () => {
  it('blocks completing a document task until the document is uploaded', async () => {
    const { calls } = mockApi({
      'GET /auth/me': sessionFor(['self:profile', 'self:onboarding'], { employee: 'e1' }),
      'GET /onboarding/my-tasks': [200, { data: [task(), task({ id: 't2', title: 'Read the handbook', documentCategory: null, overdue: false })] }],
      'POST /onboarding/tasks/t2/complete': [200, { data: task({ id: 't2', status: 'completed' }) }],
    });
    renderApp('/onboarding');
    const idTask = (await screen.findByText('Upload identity proof')).closest('li');
    const items = screen.getAllByRole('listitem');
    expect(within(idTask).getByText(/Overdue/)).toBeInTheDocument();
    expect(within(idTask).getByRole('button', { name: 'Mark done' })).toBeDisabled();
    expect(within(idTask).getByRole('button', { name: /Upload/ })).toBeEnabled();
    // Employees see only their own queue: no HR tabs.
    expect(screen.queryByRole('tab', { name: 'Checklists' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    const handbook = items.find((li) => within(li).queryByText('Read the handbook'));
    await user.click(within(handbook).getByRole('button', { name: 'Mark done' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark done' }));
    expect(await screen.findByText('Task completed')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/onboarding/tasks/t2/complete')).toBe(true);
  });

  it('gives HR progress and checklist tabs', async () => {
    mockApi({
      'GET /auth/me': sessionFor(['onboarding:manage']),
      'GET /onboarding/overview': [
        200,
        {
          data: [
            {
              employee: { id: 'e1', fullName: 'Neha Patil', employeeCode: 'SEN-0010', joiningDate: '2025-07-01', lifecycleStatus: 'pre_joining', department: 'Engineering' },
              total: 8,
              completed: 2,
              waived: 0,
              open: 6,
              overdue: 1,
              progress: 25,
              nextDue: '2025-06-28',
            },
          ],
        },
      ],
    });
    renderApp('/onboarding');
    expect(await screen.findByRole('tab', { name: 'Checklists' })).toBeInTheDocument();
    expect(await screen.findByText('Neha Patil')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Neha Patil progress' })).toHaveAttribute('aria-valuenow', '25');
  });
});
