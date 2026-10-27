import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { getApp, signedInAs } from '../../../test/helpers.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { CompanySettings } from './companySettings.model.js';
import { getSettings } from './company.service.js';

describe('company settings', () => {
  it('every signed-in role can read; only company:manage can update', async () => {
    const { client: employee } = await signedInAs(['employee']);
    const read = await employee.get('/api/v1/company');
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({ timezone: 'Asia/Kolkata', currency: 'INR', financialYearStartMonth: 4 });
    expect((await employee.patch('/api/v1/company').send({ displayName: 'Hacked' })).status).toBe(403);
  });

  it('updates allowlisted fields, merges address and writes an audit entry', async () => {
    const { client: admin } = await signedInAs(['super_admin']);
    const res = await admin.patch('/api/v1/company').send({ displayName: 'Senova Labs', address: { city: 'Pune' }, currency: 'USD' });
    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe('Senova Labs');
    expect(res.body.data.address.city).toBe('Pune');
    expect(res.body.data.address.country).toBe('India');
    expect(res.body.data.currency).toBe('INR');
    const log = await AuditLog.findOne({ action: 'company.updated' }).lean();
    expect(log.changes.displayName).toEqual({ from: 'Senova', to: 'Senova Labs' });
  });

  it('fills in settings added by later releases for documents saved earlier', async () => {
    // Simulate a record written before `policies` existed.
    await CompanySettings.collection.updateOne({ key: 'company' }, { $unset: { policies: '' } }, { upsert: true });
    const settings = await getSettings();
    expect(settings.policies).toMatchObject({ attendance: { correctionWindowDays: 7 }, leave: { countNonWorkingDays: false } });
  });

  it('validates timezone', async () => {
    const { client: admin } = await signedInAs(['super_admin']);
    expect((await admin.patch('/api/v1/company').send({ timezone: 'Mars/Olympus' })).status).toBe(422);
  });
});

describe('dashboard and audit', () => {
  it('returns only widgets the user may see', async () => {
    const { client: employee } = await signedInAs(['employee']);
    const e = await employee.get('/api/v1/dashboard/summary');
    expect(e.status).toBe(200);
    expect(e.body.data.widgets).toEqual({});

    const { client: admin } = await signedInAs(['super_admin']);
    const a = await admin.get('/api/v1/dashboard/summary');
    expect(a.body.data.widgets.userAccounts.active).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(a.body.data.widgets.recentActivity)).toBe(true);
  });

  it('restricts audit logs to audit:read', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    expect((await hr.get('/api/v1/audit-logs')).status).toBe(403);
    const { client: admin } = await signedInAs(['super_admin']);
    const res = await admin.get('/api/v1/audit-logs?action=auth.login');
    expect(res.status).toBe(200);
    expect(res.body.data.every((l) => l.action === 'auth.login')).toBe(true);
  });
});

describe('health and platform', () => {
  it('exposes liveness and readiness', async () => {
    const app = await getApp();
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
    const ready = await request(app).get('/api/v1/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.data.database).toBe('up');
  });

  it('sets security headers and no-store caching on API responses', async () => {
    const res = await request(await getApp()).get('/api/v1/auth/csrf');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('only allows trusted CORS origins', async () => {
    const app = await getApp();
    const trusted = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    expect(trusted.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const evil = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(await getApp()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
