import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, sessionFor } from '../../test/utils.jsx';

const departments = [{ id: 'd1', name: 'Engineering', code: 'ENG', status: 'active', employeeCount: 2 }];
const designations = [{ id: 'g1', title: 'Software Engineer', level: 3, status: 'active', employeeCount: 2 }];
const org = { 'GET /departments': [200, { data: departments }], 'GET /designations': [200, { data: designations }] };

const employee = (overrides = {}) => ({
  id: 'e2',
  employeeCode: 'SEN-0002',
  firstName: 'Rohan',
  middleName: '',
  lastName: 'Gupta',
  fullName: 'Rohan Gupta',
  workEmail: 'rohan.gupta@senova.test',
  phone: '+91 98000 00000',
  department: { id: 'd1', name: 'Engineering' },
  designation: { id: 'g1', title: 'Software Engineer' },
  reportingManager: { id: 'e1', fullName: 'Vikram Singh' },
  employmentType: 'full_time',
  workLocation: 'Pune',
  joiningDate: '2024-04-01',
  lifecycleStatus: 'active',
  probation: { status: 'confirmed', endDate: '2024-10-01' },
  archived: false,
  viewLevel: 'full',
  ...overrides,
});
const page = (data) => [200, { data, meta: { page: 1, limit: 20, total: data.length, totalPages: 1 } }];

describe('employee directory', () => {
  it('lists employees and sends filters to the server', async () => {
    const { calls } = mockApi({
      ...org,
      'GET /auth/me': sessionFor(['employees:read:all', 'employees:manage']),
      'GET /employees': ({ query }) => page(query.department === 'd1' ? [employee()] : [employee(), employee({ id: 'e3', fullName: 'Sneha Kulkarni', employeeCode: 'SEN-0003' })]),
    });
    renderApp('/employees');
    const table = await screen.findByRole('table', { name: 'Employees' });
    expect(await within(table).findByText('Sneha Kulkarni')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add employee/ })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Filter by department'), 'd1');
    await waitFor(() => expect(within(table).queryByText('Sneha Kulkarni')).not.toBeInTheDocument());
    expect(calls.some((c) => c.path === '/employees' && c.query.department === 'd1')).toBe(true);
  });

  it('shows a team-scoped title and no add button for managers', async () => {
    mockApi({ ...org, 'GET /auth/me': sessionFor(['employees:read:team', 'self:profile'], { employee: 'e1' }), 'GET /employees': page([]) });
    renderApp('/employees');
    expect(await screen.findByRole('heading', { name: 'My team' })).toBeInTheDocument();
    expect(await screen.findByText('No one reports to you yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Add employee/ })).not.toBeInTheDocument();
  });
});

describe('employee form', () => {
  it('validates required fields and creates the employee with a clean payload', async () => {
    const { calls } = mockApi({
      ...org,
      'GET /auth/me': sessionFor(['employees:read:all', 'employees:manage']),
      'POST /employees': ({ body }) => [201, { data: employee({ id: 'e9', employeeCode: 'SEN-0009', fullName: `${body.firstName} ${body.lastName}` }) }],
      'GET /employees/e9': [200, { data: employee({ id: 'e9', employeeCode: 'SEN-0009', fullName: 'Meera Iyer' }) }],
    });
    renderApp('/employees/new');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Create employee' }));
    expect(await screen.findByText('First name is required')).toBeInTheDocument();
    expect(screen.getByText('Choose a department')).toBeInTheDocument();
    expect(screen.getByText('Joining date is required')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/First name/), 'Meera');
    await user.type(screen.getByLabelText(/Last name/), 'Iyer');
    await user.type(screen.getByLabelText(/Work email/), 'meera@senova.test');
    await user.selectOptions(screen.getByLabelText(/Department/), 'd1');
    await user.selectOptions(screen.getByLabelText(/Designation/), 'g1');
    await user.type(screen.getByLabelText(/Joining date/), '2025-04-01');
    await user.type(screen.getByLabelText(/Probation ends/), '2025-03-01');
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    expect(await screen.findByText('Probation must end after the joining date')).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/Probation ends/));
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    expect(await screen.findByRole('heading', { name: 'Meera Iyer' })).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/employees');
    expect(post.body).toMatchObject({ firstName: 'Meera', lastName: 'Iyer', departmentId: 'd1', designationId: 'g1', joiningDate: '2025-04-01', probationEndDate: null, reportingManagerId: null });
    expect(post.body).not.toHaveProperty('employeeCode');
  });

  it('maps server field errors onto the form', async () => {
    mockApi({
      ...org,
      'GET /auth/me': sessionFor(['employees:read:all', 'employees:manage']),
      'POST /employees': [409, { error: { code: 'CONFLICT', message: 'Another employee already uses this work email', details: [{ path: 'workEmail', message: 'Already in use' }] } }],
    });
    renderApp('/employees/new');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/First name/), 'Meera');
    await user.type(screen.getByLabelText(/Last name/), 'Iyer');
    await user.type(screen.getByLabelText(/Work email/), 'taken@senova.test');
    await user.selectOptions(screen.getByLabelText(/Department/), 'd1');
    await user.selectOptions(screen.getByLabelText(/Designation/), 'g1');
    await user.type(screen.getByLabelText(/Joining date/), '2025-04-01');
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    expect(await screen.findByText('Already in use')).toBeInTheDocument();
  });
});

describe('employee profile', () => {
  it('gives managers a limited team view without personal, history or bank tabs', async () => {
    mockApi({ 'GET /auth/me': sessionFor(['employees:read:team', 'self:profile', 'self:onboarding'], { employee: 'e1' }), 'GET /employees/e2': [200, { data: employee({ viewLevel: 'team' }) }] });
    renderApp('/employees/e2');
    const tabs = await screen.findByRole('tablist', { name: 'Employee profile sections' });
    const names = within(tabs).getAllByRole('tab').map((t) => t.textContent);
    expect(names).toEqual(['Overview', 'On/offboarding']);
    expect(screen.getByText('Team view')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /actions/i })).not.toBeInTheDocument();
  });

  it('shows bank details masked until an authorized user reveals them', async () => {
    const sensitive = (reveal) => ({
      bank: { accountHolderName: 'Rohan Gupta', bankName: 'HDFC Bank', branch: '', ifsc: 'HDFC0001234', accountNumber: reveal ? '50100012345678' : 'XXXX5678' },
      pan: reveal ? 'ABCDE1234F' : 'XXXX234F',
      aadhaarLast4: '4321',
      uan: '',
      updatedAt: '2025-01-01T00:00:00Z',
      revealed: reveal,
    });
    const { calls } = mockApi({
      'GET /auth/me': sessionFor(['employees:read:all', 'employees:sensitive:read']),
      'GET /employees/e2': [200, { data: employee() }],
      'GET /employees/e2/sensitive': ({ query }) => [200, { data: sensitive(query.reveal === 'true') }],
    });
    renderApp('/employees/e2');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Bank & identity' }));
    expect(await screen.findByText('XXXX5678')).toBeInTheDocument();
    expect(screen.queryByText('50100012345678')).not.toBeInTheDocument();
    // Read-only users (no employees:manage) get no edit button.
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Reveal numbers/ }));
    expect(await screen.findByText('50100012345678')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/employees/e2/sensitive' && c.query.reveal === 'true')).toBe(true);
  });

  it('offers lifecycle actions that match the current status', async () => {
    mockApi({
      'GET /auth/me': sessionFor(['employees:read:all', 'employees:manage']),
      'GET /employees/e2': [200, { data: employee({ lifecycleStatus: 'notice_period', exit: { lastWorkingDate: '2025-05-31' } }) }],
    });
    renderApp('/employees/e2');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /actions/i }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Withdraw resignation' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Complete exit' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Record resignation' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Archive record' })).not.toBeInTheDocument();
  });

  it('shows a not-found state for records outside the user’s scope', async () => {
    mockApi({ 'GET /auth/me': sessionFor(['self:profile'], { employee: 'e1' }), 'GET /employees/e2': [404, { error: { code: 'NOT_FOUND', message: 'Employee not found' } }] });
    renderApp('/employees/e2');
    expect(await screen.findByRole('heading', { name: 'Employee not found' })).toBeInTheDocument();
  });
});
