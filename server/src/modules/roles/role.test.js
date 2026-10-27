import { describe, expect, it } from 'vitest';
import { signedInAs } from '../../../test/helpers.js';
import { DEFAULT_ROLES, PERMISSION_KEYS, WILDCARD, hasPermission } from './permissions.js';

describe('permission catalog (unit)', () => {
  it('default roles only reference catalogued permissions', () => {
    for (const role of DEFAULT_ROLES) {
      for (const p of role.permissions) {
        if (p !== WILDCARD) expect(PERMISSION_KEYS.has(p), `${role.key}: ${p}`).toBe(true);
      }
    }
  });

  it('payroll admin cannot approve or finalize payroll by default', () => {
    const payroll = new Set(DEFAULT_ROLES.find((r) => r.key === 'payroll_admin').permissions);
    expect(hasPermission(payroll, 'payroll:process')).toBe(true);
    expect(hasPermission(payroll, 'payroll:approve')).toBe(false);
    expect(hasPermission(payroll, 'payroll:finalize')).toBe(false);
  });

  it('employees only get self-service and company read', () => {
    const employee = DEFAULT_ROLES.find((r) => r.key === 'employee').permissions;
    expect(employee.every((p) => p.startsWith('self:') || p === 'company:read')).toBe(true);
  });

  it('wildcard grants everything', () => {
    expect(hasPermission(new Set([WILDCARD]), 'payroll:finalize')).toBe(true);
  });
});

describe('roles API', () => {
  it('lists roles with user counts for users with roles:read', async () => {
    const { client: c } = await signedInAs(['hr_admin']);
    const res = await c.get('/api/v1/roles');
    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.key)).toEqual(expect.arrayContaining(DEFAULT_ROLES.map((r) => r.key)));
    expect(res.body.data.find((r) => r.key === 'hr_admin').userCount).toBeGreaterThanOrEqual(1);
  });

  it('forbids role changes without roles:manage', async () => {
    const { client: c } = await signedInAs(['hr_admin']);
    expect((await c.patch('/api/v1/roles/employee').send({ permissions: ['users:manage'] })).status).toBe(403);
  });

  it('never allows editing the super_admin role', async () => {
    const { client: c } = await signedInAs(['super_admin']);
    expect((await c.patch('/api/v1/roles/super_admin').send({ permissions: [] })).status).toBe(403);
  });

  it('rejects unknown permissions and protects system roles from deletion', async () => {
    const { client: c } = await signedInAs(['super_admin']);
    expect((await c.post('/api/v1/roles').send({ key: 'auditor', name: 'Auditor', permissions: ['everything:ever'] })).status).toBe(422);
    expect((await c.delete('/api/v1/roles/employee')).status).toBe(403);
  });

  it('creates, updates and deletes a custom role', async () => {
    const { client: c } = await signedInAs(['super_admin']);
    const created = await c.post('/api/v1/roles').send({ key: 'auditor', name: 'Auditor', permissions: ['audit:read'] });
    expect(created.status).toBe(201);
    const updated = await c.patch('/api/v1/roles/auditor').send({ permissions: ['audit:read', 'users:read'] });
    expect(updated.body.data.permissions).toEqual(['audit:read', 'users:read']);
    expect((await c.post('/api/v1/roles').send({ key: 'auditor', name: 'Again' })).status).toBe(409);
    expect((await c.delete('/api/v1/roles/auditor')).status).toBe(204);
  });

  it('a role manager cannot grant permissions they do not hold', async () => {
    const { client: root } = await signedInAs(['super_admin']);
    await root.post('/api/v1/roles').send({ key: 'role_admin', name: 'Role Admin', permissions: ['roles:read', 'roles:manage'] });
    const { client: c } = await signedInAs(['role_admin']);
    const res = await c.post('/api/v1/roles').send({ key: 'sneaky', name: 'Sneaky', permissions: ['payroll:finalize'] });
    expect(res.status).toBe(403);
  });
});
