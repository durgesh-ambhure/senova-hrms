import { describe, expect, it } from 'vitest';
import { client, signedInAs, TEST_PASSWORD } from '../../../test/helpers.js';
import { takeSentMail } from '../../shared/mailer.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { User } from './user.model.js';
import { updateUser } from './user.service.js';
import mongoose from 'mongoose';

const tokenFrom = (mail) => new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');

describe('users: access control', () => {
  it('denies employees, managers and recruiters any user administration', async () => {
    for (const role of ['employee', 'manager', 'recruiter', 'payroll_admin']) {
      const { client: c } = await signedInAs([role]);
      expect((await c.get('/api/v1/users')).status).toBe(403);
      expect((await c.post('/api/v1/users').send({ name: 'X Y', email: 'x@senova.test', roles: ['employee'] })).status).toBe(403);
    }
  });

  it('lets HR Admin read users but not manage them', async () => {
    const { client: c, user } = await signedInAs(['hr_admin']);
    expect((await c.get('/api/v1/users')).status).toBe(200);
    expect((await c.get(`/api/v1/users/${user._id}`)).status).toBe(200);
    expect((await c.patch(`/api/v1/users/${user._id}`).send({ name: 'Renamed' })).status).toBe(403);
  });

  it('returns 401 for anonymous requests', async () => {
    const c = await client();
    expect((await c.get('/api/v1/users')).status).toBe(401);
  });
});

describe('users: invite flow', () => {
  it('invites a user without a password, then the invite link activates the account', async () => {
    const { client: admin } = await signedInAs(['super_admin']);
    takeSentMail();
    const res = await admin.post('/api/v1/users').send({ name: 'Asha Rao', email: 'Asha.Rao@Senova.test', roles: ['employee'] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email: 'asha.rao@senova.test', status: 'invited', inviteSent: true });
    expect(await AuditLog.exists({ action: 'user.created', entityId: res.body.data.id })).toBeTruthy();

    const anon = await client();
    expect((await anon.login('asha.rao@senova.test', TEST_PASSWORD)).status).toBe(401);

    const [mail] = takeSentMail();
    expect(mail.to).toBe('asha.rao@senova.test');
    const accept = await anon.post('/api/v1/auth/reset-password').send({ token: tokenFrom(mail), password: 'Asha-first-password-1' });
    expect(accept.status).toBe(200);
    expect(accept.body.data.purpose).toBe('invite');

    expect((await anon.login('asha.rao@senova.test', 'Asha-first-password-1')).status).toBe(200);
    expect((await User.findOne({ email: 'asha.rao@senova.test' })).status).toBe('active');
  });

  it('rejects duplicate emails and unknown roles', async () => {
    const { client: admin, user } = await signedInAs(['super_admin']);
    const dup = await admin.post('/api/v1/users').send({ name: 'Dup', email: user.email, roles: ['employee'] });
    expect(dup.status).toBe(409);
    const bad = await admin.post('/api/v1/users').send({ name: 'Bad Role', email: 'badrole@senova.test', roles: ['wizard'] });
    expect(bad.status).toBe(422);
  });

  it('ignores fields that are not allowlisted (mass assignment)', async () => {
    const { client: admin } = await signedInAs(['super_admin']);
    const res = await admin
      .post('/api/v1/users')
      .send({ name: 'Mass Assign', email: 'mass@senova.test', roles: ['employee'], status: 'active', passwordHash: 'x', authVersion: 99 });
    expect(res.status).toBe(201);
    const saved = await User.findOne({ email: 'mass@senova.test' }).select('+passwordHash');
    expect(saved.status).toBe('invited');
    expect(saved.passwordHash).toBeNull();
    expect(saved.authVersion).toBe(0);
  });
});

describe('users: anti-escalation', () => {
  it('prevents a non-super-admin user manager from granting super_admin', async () => {
    // A custom role with users:manage but no wildcard.
    const { client: root } = await signedInAs(['super_admin']);
    await root.post('/api/v1/roles').send({ key: 'it_admin', name: 'IT Admin', permissions: ['users:read', 'users:manage', 'roles:read'] });
    const { client: it_ } = await signedInAs(['it_admin']);

    const res = await it_.post('/api/v1/users').send({ name: 'Sneaky', email: 'sneaky@senova.test', roles: ['super_admin'] });
    expect(res.status).toBe(403);

    const { user: victim } = await signedInAs(['super_admin']);
    const demote = await it_.patch(`/api/v1/users/${victim._id}`).send({ status: 'disabled' });
    expect(demote.status).toBe(403);
  });

  it('prevents users from changing their own roles or status', async () => {
    const { client: c, user } = await signedInAs(['super_admin']);
    const res = await c.patch(`/api/v1/users/${user._id}`).send({ roles: ['employee'] });
    expect(res.status).toBe(403);
  });

  it('keeps at least one active super admin (service-level guard)', async () => {
    await User.updateMany({ roles: 'super_admin' }, { status: 'disabled' });
    const { user: last } = await signedInAs(['super_admin']);
    // Through the API another active super admin always exists (self-changes are blocked), so
    // exercise the defence-in-depth guard directly, e.g. as a script or future SSO sync would.
    const req = { auth: { user: { _id: new mongoose.Types.ObjectId(), name: 'system' }, permissions: new Set(['*']) } };
    await expect(updateUser(req, String(last._id), { status: 'disabled' })).rejects.toMatchObject({ status: 409 });
    await expect(updateUser(req, String(last._id), { roles: ['employee'] })).rejects.toMatchObject({ status: 409 });
  });

  it('disabling a user signs them out immediately', async () => {
    const { client: admin } = await signedInAs(['super_admin']);
    const { user, client: victim } = await signedInAs(['employee']);
    expect((await victim.get('/api/v1/auth/me')).status).toBe(200);
    expect((await admin.patch(`/api/v1/users/${user._id}`).send({ status: 'disabled' })).status).toBe(200);
    expect((await victim.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('changing roles takes effect on the next request', async () => {
    const { client: admin } = await signedInAs(['super_admin']);
    const { user, client: c } = await signedInAs(['hr_admin']);
    expect((await c.get('/api/v1/users')).status).toBe(200);
    await admin.patch(`/api/v1/users/${user._id}`).send({ roles: ['employee'] });
    // Session invalidated by the role change; even after re-login access is gone.
    expect((await c.get('/api/v1/users')).status).toBe(401);
    await c.login(user.email);
    expect((await c.get('/api/v1/users')).status).toBe(403);
  });
});

describe('users: listing', () => {
  it('paginates, searches and validates sort fields', async () => {
    const { client: admin } = await signedInAs(['super_admin']);
    await signedInAs(['employee'], { name: 'Zebulon Searchable' });
    const res = await admin.get('/api/v1/users?search=zebulon&limit=5');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 5, total: 1 });

    expect((await admin.get('/api/v1/users?sort=passwordHash')).status).toBe(422);
    expect((await admin.get('/api/v1/users?limit=1000')).status).toBe(422);
    expect((await admin.get('/api/v1/users/not-an-id')).status).toBe(422);
  });

  it('treats regex metacharacters in search as plain text', async () => {
    const { client: admin } = await signedInAs(['super_admin']);
    const res = await admin.get(`/api/v1/users?search=${encodeURIComponent('.*')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('rejects operator injection in query strings', async () => {
    const { client: admin } = await signedInAs(['super_admin']);
    const res = await admin.get('/api/v1/users?status[$ne]=active');
    expect(res.status).toBe(422);
  });
});
