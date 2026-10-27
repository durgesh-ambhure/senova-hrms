import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, sessionFor } from '../../test/utils.jsx';

const totals = {
  employees: 1,
  gross: 148200,
  deductions: 2000,
  net: 146200,
  employerCost: 1800,
};
const run = (over = {}) => ({
  id: 'r1',
  month: '2026-09',
  type: 'regular',
  sequence: 1,
  status: 'under_review',
  ruleVersion: 1,
  rulesVerified: false,
  totals,
  issues: { blockers: 0, warnings: 0 },
  skipped: [],
  preparedBy: 'u-prep',
  preparedByName: 'Farah Khan',
  approvedBy: null,
  approvedByName: null,
  history: [],
  ...over,
});
const runRoutes = (r) => ({
  [`GET /payroll/runs/${r.id}`]: [200, { data: r }],
  [`GET /payroll/runs/${r.id}/entries`]: [200, { data: [] }],
  [`GET /payroll/runs/${r.id}/adjustments`]: [200, { data: [] }],
});

afterEach(() => vi.unstubAllGlobals());

describe('payroll run approval chain', () => {
  it('lets HR approve a run someone else prepared', async () => {
    const { calls } = mockApi({
      'GET /auth/me': sessionFor(['payroll:read', 'payroll:approve'], {
        id: 'u-hr',
        name: 'Kavita Rao',
      }),
      ...runRoutes(run()),
      'POST /payroll/runs/r1/approve': [
        200,
        {
          data: run({
            status: 'approved',
            approvedBy: 'u-hr',
            approvedByName: 'Kavita Rao',
          }),
        },
      ],
    });
    renderApp('/payroll/runs/r1');
    await userEvent.setup().click(await screen.findByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/payroll/runs/r1/approve')).toBe(true));
  });

  it('does not offer approval to the preparer, even with the permission', async () => {
    mockApi({
      'GET /auth/me': sessionFor(['payroll:process', 'payroll:approve'], {
        id: 'u-prep',
        name: 'Farah Khan',
      }),
      ...runRoutes(run()),
    });
    renderApp('/payroll/runs/r1');
    expect(await screen.findByText(/someone else must approve it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
  });

  it('blocks finalizing until the rules are verified, and hides it from the approver', async () => {
    const approved = run({
      status: 'approved',
      approvedBy: 'u-hr',
      approvedByName: 'Kavita Rao',
    });
    mockApi({
      'GET /auth/me': sessionFor(['payroll:read', 'payroll:finalize'], {
        id: 'u-root',
        name: 'Arjun Mehta',
      }),
      ...runRoutes(approved),
    });
    const view = renderApp('/payroll/runs/r1');
    expect(await screen.findByRole('button', { name: /Finalize/ })).toBeDisabled();
    expect(screen.getByText(/must be verified by a payroll professional/)).toBeInTheDocument();
    view.unmount();

    mockApi({
      'GET /auth/me': sessionFor(['payroll:approve', 'payroll:finalize'], {
        id: 'u-hr',
        name: 'Kavita Rao',
      }),
      ...runRoutes(approved),
    });
    renderApp('/payroll/runs/r1');
    expect(await screen.findByRole('heading', { name: /September 2026 payroll/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Finalize/ })).not.toBeInTheDocument();
  });
});

describe('payslips', () => {
  it('lists my payslips and downloads the PDF', async () => {
    const slip = {
      id: 'p1',
      month: '2026-09',
      runType: 'regular',
      employee: {
        id: 'e1',
        fullName: 'Priya Sharma',
        employeeCode: 'SEN-0003',
      },
      paidDays: 30,
      lopDays: 0,
      daysInMonth: 30,
      lines: [
        { code: 'BASIC', label: 'Basic', type: 'earning', amount: 74100 },
        {
          code: 'PF_EE',
          label: 'Provident fund',
          type: 'deduction',
          amount: 1800,
        },
      ],
      totals: { gross: 148200, deductions: 2000, net: 146200 },
      ytd: { from: '2026-04', gross: 889200, tds: 0, net: 877200 },
    };
    const { calls } = mockApi({
      'GET /auth/me': sessionFor(['self:payslips'], { employee: 'e1' }),
      'GET /payroll/payslips': [200, { data: [slip] }],
      'GET /payroll/payslips/p1': [200, { data: slip }],
    });
    const createObjectURL = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    renderApp('/payroll/payslips');
    const user = userEvent.setup();
    const row = (await screen.findByText('September 2026')).closest('tr');
    await user.click(within(row).getByRole('button', { name: 'View' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Provident fund')).toBeInTheDocument(); // the payslip loads after the dialog opens
    expect(within(dialog).getByText(/Year to date from April 2026/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Download PDF/ }));
    await waitFor(() => expect(calls.some((c) => c.path === '/payroll/payslips/p1/pdf')).toBe(true));
  });
});

describe('salary revisions', () => {
  it('previews the breakdown and blocks saving an invalid structure', async () => {
    const employee = {
      id: 'e2',
      fullName: 'Rohan Iyer',
      employeeCode: 'SEN-0005',
      joiningDate: '2024-01-15',
    };
    mockApi({
      'GET /auth/me': sessionFor(['payroll:read', 'payroll:salary:manage'], {
        id: 'u-prep',
        employee: 'e-farah',
      }),
      'GET /payroll/salaries/e2': [200, { data: { employee, revisions: [], currentRevision: null } }],
      'POST /payroll/salaries/preview': ({ body }) => [
        200,
        {
          data: {
            ruleVersion: 1,
            breakdown: {
              valid: body.annualCtc !== '100',
              problem: 'Fixed allowances exceed the gross salary',
              components: [{ code: 'BASIC', label: 'Basic', monthly: 74100 }],
              gross: 148200,
              ctcMonthly: 150000,
              employer: { pf: 1800, esi: 0, gratuity: 0 },
            },
          },
        },
      ],
    });
    renderApp('/payroll/salaries/e2');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /New revision/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Annual CTC/), '100');
    expect(await within(dialog).findByText('Fixed allowances exceed the gross salary')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save revision' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Annual CTC/), '0000');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save revision' })).toBeEnabled());
    expect(within(dialog).getByText('Gross per month')).toBeInTheDocument();
  });

  it('never offers to change your own salary', async () => {
    mockApi({
      'GET /auth/me': sessionFor(['payroll:read', 'payroll:salary:manage'], {
        employee: 'e2',
      }),
      'GET /payroll/salaries/e2': [
        200,
        {
          data: {
            employee: {
              id: 'e2',
              fullName: 'Farah Khan',
              employeeCode: 'SEN-0004',
              joiningDate: '2024-01-15',
            },
            revisions: [],
            currentRevision: null,
          },
        },
      ],
    });
    renderApp('/payroll/salaries/e2');
    expect(await screen.findByText('No salary defined')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New revision/ })).not.toBeInTheDocument();
  });
});
