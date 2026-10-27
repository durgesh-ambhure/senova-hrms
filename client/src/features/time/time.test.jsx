import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, sessionFor } from '../../test/utils.jsx';
import { addDaysTo, localToday, mondayOf } from '../../lib/format.js';

const me = sessionFor(['self:attendance', 'self:leave', 'self:timesheets', 'self:profile'], { employee: 'e1' });
const shift = { name: 'General shift', startTime: '09:30', endTime: '18:30', start: '2025-03-03T04:00:00Z', end: '2025-03-03T13:00:00Z' };
const summary = { employee: { id: 'e1', fullName: 'Priya Sharma' }, month: localToday().slice(0, 7), shift, days: [], totals: { workingDays: 0, presentUnits: 0, paidLeaveUnits: 0, unpaidLeaveUnits: 0, absentUnits: 0, incompleteDays: 0, lateDays: 0 } };

describe('attendance', () => {
  it('checks in and then offers break and check-out', async () => {
    let record = null;
    const { calls } = mockApi({
      'GET /auth/me': me,
      'GET /attendance/me/today': () => [200, { data: { date: localToday(), shift, day: { working: true }, record, openRecord: null, canPunch: true } }],
      'GET /attendance/summary': [200, { data: summary }],
      'GET /attendance/corrections': [200, { data: [] }],
      'POST /attendance/check-in': () => {
        record = { checkIn: new Date().toISOString(), checkOut: null, onBreak: false, breakMinutes: 0, lateByMinutes: 0, workedMinutes: 0 };
        return [201, { data: record }];
      },
    });
    renderApp('/attendance');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Check in/ }));
    expect(await screen.findByRole('button', { name: /Check out/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start break/ })).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/attendance/check-in');
    expect(post.headers['X-CSRF-Token']).toBe('test-csrf');
  });

  it('flags a missed check-out and validates correction requests', async () => {
    mockApi({
      'GET /auth/me': me,
      'GET /attendance/me/today': [200, { data: { date: localToday(), shift, day: { working: true }, record: null, openRecord: { date: addDaysTo(localToday(), -1), checkIn: new Date().toISOString() }, canPunch: true } }],
      'GET /attendance/summary': [200, { data: summary }],
      'GET /attendance/corrections': [200, { data: [] }],
    });
    renderApp('/attendance');
    const user = userEvent.setup();
    expect(await screen.findByText(/You didn't check out/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Request a correction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Request attendance correction' });
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(await within(dialog).findByText('Explain what happened')).toBeInTheDocument();
  });
});

describe('leave', () => {
  const types = [{ id: 'cl', name: 'Casual leave', code: 'CL', allowHalfDay: true, unlimited: false }];
  const balances = { employee: { id: 'e1', fullName: 'Priya Sharma' }, year: 2025, balances: [{ leaveType: { id: 'cl', name: 'Casual leave', paid: true, unlimited: false, color: '#3459ad' }, availableUnits: 4, usedUnits: 0, pendingUnits: 0, openingUnits: 0, accruedUnits: 4, adjustedUnits: 0, adjustments: [] }] };

  it('previews the days charged and blocks requests the server would reject', async () => {
    const { calls } = mockApi({
      'GET /auth/me': me,
      'GET /leave/requests': [200, { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } }],
      'GET /leave/types': [200, { data: types }],
      'GET /leave/balances': [200, { data: balances }],
      'POST /leave/requests/preview': ({ body }) =>
        body.endDate > body.startDate
          ? [409, { error: { code: 'CONFLICT', message: 'Not enough Casual leave balance: 2 day(s) available, 3 requested' } }]
          : [200, { data: { units: 2, days: [{ date: body.startDate, half: 'full', units: 2 }], availableUnits: 4 } }],
    });
    renderApp('/leave/requests');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Apply for leave/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply for leave' });
    await waitFor(() => expect(within(dialog).getByRole('option', { name: /Casual leave — 2 days available/ })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText(/Leave type/), 'cl');
    expect(await within(dialog).findByText(/will be charged/)).toHaveTextContent('1 day');

    const to = within(dialog).getByLabelText(/^To/);
    await user.clear(to);
    await user.type(to, addDaysTo(localToday(), 5));
    expect(await within(dialog).findByText(/Not enough Casual leave balance/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Send request' })).toBeDisabled();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/leave/requests')).toBe(false);
  });

  it('requires a reason before a manager rejects', async () => {
    const request = { id: 'r1', employee: { id: 'e2', fullName: 'Rohan Gupta' }, leaveType: { id: 'cl', name: 'Casual leave', color: '#3459ad' }, startDate: '2025-03-03', endDate: '2025-03-03', startSession: 'full', endSession: 'full', units: 2, status: 'pending', reason: '' };
    const { calls } = mockApi({
      'GET /auth/me': sessionFor(['leave:approve:team', 'self:leave'], { employee: 'e1' }),
      'GET /leave/requests': ({ query }) => [200, { data: query.scope === 'approvals' ? [request] : [], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } }],
      'POST /leave/requests/r1/decision': [200, { data: { ...request, status: 'rejected' } }],
    });
    renderApp('/leave/requests?tab=approvals');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await within(dialog).findByText('Give a reason')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Note/), 'Release week');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/leave/requests/r1/decision')?.body).toEqual({ decision: 'rejected', note: 'Release week' }));
  });
});

describe('timesheets', () => {
  const week = mondayOf(localToday());
  const projects = [{ id: 'p1', name: 'Senova HRMS', code: 'HRMS', status: 'active' }];

  it('validates hours before saving and sends minutes to the server', async () => {
    const { calls } = mockApi({
      'GET /auth/me': me,
      'GET /timesheets/projects': [200, { data: projects }],
      [`GET /timesheets/mine/${week}`]: [200, { data: { id: null, weekStart: week, entries: [], totalMinutes: 0, status: 'draft', history: [] } }],
      [`PUT /timesheets/mine/${week}`]: ({ body }) => [200, { data: { id: 't1', weekStart: week, entries: body.entries.map((e) => ({ ...e, project: projects[0] })), totalMinutes: 450, status: 'draft', history: [] } }],
    });
    renderApp('/timesheets');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Add row/ }));
    const hours = screen.getByLabelText('Row 1 hours');
    await user.clear(hours);
    await user.type(hours, '30');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Row 1: hours must be between 0 and 24')).toBeInTheDocument();

    await user.clear(hours);
    await user.type(hours, '7.5');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body.entries[0]).toMatchObject({ projectId: 'p1', minutes: 450 }));
  });

  it('shows submitted weeks read-only', async () => {
    mockApi({
      'GET /auth/me': me,
      'GET /timesheets/projects': [200, { data: projects }],
      [`GET /timesheets/mine/${week}`]: [200, { data: { id: 't1', weekStart: week, entries: [{ id: 'x', date: week, project: projects[0], task: 'Build', minutes: 480, note: '' }], totalMinutes: 480, status: 'submitted', history: [] } }],
    });
    renderApp('/timesheets');
    expect(await screen.findByText('Submitted')).toBeInTheDocument();
    expect(screen.getByLabelText('Row 1 hours')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  });
});
