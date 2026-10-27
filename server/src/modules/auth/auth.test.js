import { describe, expect, it } from 'vitest';
import { client, createTestUser, getApp, signedInAs, TEST_PASSWORD } from '../../../test/helpers.js';
import { takeSentMail } from '../../shared/mailer.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { User } from '../users/user.model.js';
import { MAX_FAILED_LOGINS } from './auth.service.js';
import request from 'supertest';

const tokenFrom = (mail) => new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');

describe('auth: login and session', () => {
  it('signs in with valid credentials, sets an HttpOnly cookie and returns permissions', async () => {
    const user = await createTestUser({ roles: ['employee'] });
    const c = await client();
    const res = await c.login(user.email);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(user.email);
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.permissions).toContain('self:profile');
    expect(res.body.data.permissions).not.toContain('users:read');
    const cookie = res.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/senova\.sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await c.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toBe(String(user._id));
    expect(await AuditLog.exists({ action: 'auth.login', entityId: String(user._id) })).toBeTruthy();
  });

  it('normalizes the email address', async () => {
    const user = await createTestUser();
    const c = await client();
    expect((await c.login(`  ${user.email.toUpperCase()} `)).status).toBe(200);
  });

  it('gives the same generic error for unknown email, wrong password and disabled accounts', async () => {
    const disabled = await createTestUser({ status: 'disabled' });
    const active = await createTestUser();
    const c = await client();

    const responses = [
      await c.login('nobody@senova.test'),
      await c.login(active.email, 'Wrong-password-123'),
      await c.login(disabled.email),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid email or password');
    }
  });

  it('rejects a login without a CSRF token', async () => {
    const user = await createTestUser();
    const res = await request(await getApp()).post('/api/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('validates the login body', async () => {
    const c = await client();
    const res = await c.post('/api/v1/auth/login').send({ email: 'not-an-email', password: '' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d) => d.path)).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('rejects a malformed JSON body without leaking internals', async () => {
    const c = await client();
    const res = await c.post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(res.body)).not.toMatch(/stack|SyntaxError/);
  });

  it(`locks the account after ${MAX_FAILED_LOGINS} failed attempts, even for the right password`, async () => {
    const user = await createTestUser();
    const c = await client();
    for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) {
      expect((await c.login(user.email, 'Wrong-password-123')).status).toBe(401);
    }
    const locked = await c.login(user.email);
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('logout destroys the session', async () => {
    const { client: c } = await signedInAs(['employee']);
    expect((await c.post('/api/v1/auth/logout')).status).toBe(204);
    expect((await c.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('requires authentication for /me', async () => {
    const res = await request(await getApp()).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('invalidates existing sessions when the account is disabled', async () => {
    const { user, client: c } = await signedInAs(['employee']);
    await User.updateOne({ _id: user._id }, { status: 'disabled', $inc: { authVersion: 1 } });
    expect((await c.get('/api/v1/auth/me')).status).toBe(401);
  });
});

describe('auth: password reset', () => {
  it('always answers forgot-password the same way', async () => {
    const user = await createTestUser();
    const c = await client();
    takeSentMail();
    const known = await c.post('/api/v1/auth/forgot-password').send({ email: user.email });
    const unknown = await c.post('/api/v1/auth/forgot-password').send({ email: 'ghost@senova.test' });
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    const mail = takeSentMail();
    expect(mail).toHaveLength(1);
    expect(mail[0].to).toBe(user.email);
  });

  it('resets the password with a single-use token and signs out other sessions', async () => {
    const { user, client: oldSession } = await signedInAs(['employee']);
    const c = await client();
    takeSentMail();
    await c.post('/api/v1/auth/forgot-password').send({ email: user.email });
    const token = tokenFrom(takeSentMail()[0]);

    const weak = await c.post('/api/v1/auth/reset-password').send({ token, password: 'short' });
    expect(weak.status).toBe(422);

    const newPassword = 'Brand-new-password-77';
    const reset = await c.post('/api/v1/auth/reset-password').send({ token, password: newPassword });
    expect(reset.status).toBe(200);

    const reused = await c.post('/api/v1/auth/reset-password').send({ token, password: 'Another-password-88' });
    expect(reused.status).toBe(400);

    expect((await oldSession.get('/api/v1/auth/me')).status).toBe(401);
    expect((await c.login(user.email, TEST_PASSWORD)).status).toBe(401);
    expect((await c.login(user.email, newPassword)).status).toBe(200);
  });

  it('rejects an unknown token', async () => {
    const c = await client();
    const res = await c.post('/api/v1/auth/reset-password').send({ token: 'x'.repeat(43), password: 'Valid-password-123' });
    expect(res.status).toBe(400);
  });
});

describe('auth: change password', () => {
  it('requires the correct current password and keeps the current session', async () => {
    const { user, client: c } = await signedInAs(['employee']);
    const wrong = await c.post('/api/v1/auth/change-password').send({ currentPassword: 'nope', newPassword: 'Changed-password-123' });
    expect(wrong.status).toBe(422);

    const res = await c.post('/api/v1/auth/change-password').send({ currentPassword: TEST_PASSWORD, newPassword: 'Changed-password-123' });
    expect(res.status).toBe(204);
    expect((await c.get('/api/v1/auth/me')).status).toBe(200);

    const other = await client();
    expect((await other.login(user.email, 'Changed-password-123')).status).toBe(200);
  });
});
