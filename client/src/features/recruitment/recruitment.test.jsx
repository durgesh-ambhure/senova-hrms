import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, sessionFor } from '../../test/utils.jsx';

const recruiter = sessionFor(['recruitment:jobs:manage', 'recruitment:candidates:manage', 'recruitment:interviews:manage', 'recruitment:offers:manage'], { name: 'Ishita Bose' });
const page = (data) => [200, { data, meta: { page: 1, limit: 20, total: data.length, totalPages: 1 } }];

describe('candidates', () => {
  it('stops on a phone duplicate until the recruiter confirms it is a different person', async () => {
    let attempts = 0;
    const { calls } = mockApi({
      'GET /auth/me': recruiter,
      'GET /recruitment/candidates': page([]),
      'GET /recruitment/candidates/duplicates': [200, { data: [] }],
      'POST /recruitment/candidates': ({ body }) => {
        attempts += 1;
        if (!body.allowPhoneDuplicate) {
          return [409, { error: { code: 'DUPLICATE_CANDIDATE', message: 'A candidate with the same email or phone already exists', details: [{ id: 'c9', fullName: 'Ravi Kumar', email: 'ravi@mail.test', phone: '+91 9876543210', matchedOn: ['phone'] }] } }];
        }
        return [201, { data: { id: 'c10', fullName: 'Anil Kumar' } }];
      },
      'GET /recruitment/candidates/c10': [200, { data: { id: 'c10', fullName: 'Anil Kumar', accessLevel: 'full', skills: [], files: [], experienceYears: 0 } }],
      'GET /recruitment/candidates/c10/applications': [200, { data: { items: [], counts: {} } }],
      'GET /recruitment/candidates/c10/activity': [200, { data: [] }],
      'GET /recruitment/interviews': [200, { data: [] }],
      'GET /recruitment/offers': [200, { data: [] }],
    });
    renderApp('/recruitment/candidates');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Add candidate/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add candidate' });
    await user.type(within(dialog).getByLabelText(/First name/), 'Anil');
    await user.type(within(dialog).getByLabelText(/Last name/), 'Kumar');
    await user.type(within(dialog).getByLabelText(/^Email/), 'anil@mail.test');
    await user.type(within(dialog).getByLabelText(/^Phone/), '+91 98765 43210');
    await user.click(within(dialog).getByRole('button', { name: 'Add candidate' }));

    expect(await within(dialog).findByText('Someone with this phone number already exists')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Ravi Kumar' })).toHaveAttribute('href', '/recruitment/candidates/c9');
    const submit = within(dialog).getByRole('button', { name: 'Add candidate' });
    expect(submit).toBeDisabled();
    await user.click(within(dialog).getByLabelText(/different person/));
    await user.click(submit);
    expect(await screen.findByRole('heading', { name: 'Anil Kumar' })).toBeInTheDocument();
    expect(attempts).toBe(2);
    expect(calls.filter((c) => c.method === 'POST').at(-1).body).toMatchObject({ allowPhoneDuplicate: true, skills: [] });
  });

  it('shows interviewers a limited profile without contact details', async () => {
    mockApi({
      'GET /auth/me': sessionFor(['recruitment:interviews:feedback'], { employee: 'e1' }),
      'GET /recruitment/candidates/c1': [200, { data: { id: 'c1', fullName: 'Asha Verma', currentTitle: 'Engineer', accessLevel: 'limited', skills: ['Node.js'], files: [], experienceYears: 4, noticePeriodDays: 30 } }],
      'GET /recruitment/candidates/c1/applications': [200, { data: { items: [], counts: {} } }],
      'GET /recruitment/interviews': [200, { data: [] }],
    });
    renderApp('/recruitment/candidates/c1');
    expect(await screen.findByText(/Contact details and compensation are hidden/)).toBeInTheDocument();
    expect(screen.queryByText('Email')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByText('Activity')).not.toBeInTheDocument();
  });
});

describe('pipeline', () => {
  it('groups applications by stage and offers only the moves the server allows', async () => {
    const apps = [
      { id: 'a1', candidate: { id: 'c1', fullName: 'Asha Verma', currentTitle: 'Engineer' }, job: { id: 'j1', code: 'REQ-0001', title: 'Backend' }, stage: 'screening', allowedMoves: ['shortlisted', 'rejected', 'withdrawn'], interviews: { count: 0, next: null } },
      { id: 'a2', candidate: { id: 'c2', fullName: 'Karan Mehta', currentTitle: '' }, job: { id: 'j1', code: 'REQ-0001', title: 'Backend' }, stage: 'hired', allowedMoves: [], interviews: { count: 2, next: null } },
    ];
    const { calls } = mockApi({
      'GET /auth/me': recruiter,
      'GET /recruitment/jobs': page([]),
      'GET /recruitment/applications': page(apps),
      'POST /recruitment/applications/a1/move': ({ body }) => [200, { data: { ...apps[0], stage: body.to } }],
    });
    renderApp('/recruitment/applications');
    const screening = await screen.findByRole('listitem', { name: 'Screening: 1' });
    expect(within(screening).getByText('Asha Verma')).toBeInTheDocument();
    expect(screen.getByText(/1 hired/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(screening).getByRole('button', { name: 'Move Asha Verma' }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent);
    expect(items).toEqual(['Move to Shortlisted', 'Reject…', 'Move to Withdrawn']);
    await user.click(screen.getByRole('menuitem', { name: 'Reject…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reject candidate' }));
    expect(await within(dialog).findByText('Give a reason for rejecting')).toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox'), 'Not enough depth');
    await user.click(within(dialog).getByRole('button', { name: 'Reject candidate' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/recruitment/applications/a1/move')?.body).toEqual({ to: 'rejected', reason: 'Not enough depth' }));
  });
});
