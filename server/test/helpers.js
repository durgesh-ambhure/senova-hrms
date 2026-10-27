import request from 'supertest';
import { createApp } from '../src/app.js';
import { User } from '../src/modules/users/user.model.js';
import { ensureDefaultRoles } from '../src/modules/roles/role.service.js';
import { hashPassword } from '../src/shared/security/password.js';

export const TEST_PASSWORD = 'Correct-horse-battery-42';

let app;
export async function getApp() {
  if (!app) {
    await ensureDefaultRoles();
    app = createApp();
  }
  return app;
}

let counter = 0;
export async function createTestUser({ roles = ['employee'], status = 'active', password = TEST_PASSWORD, ...rest } = {}) {
  counter += 1;
  return User.create({
    name: rest.name ?? `Test User ${counter}`,
    email: rest.email ?? `user${counter}.${Date.now()}@senova.test`,
    roles,
    status,
    passwordHash: password ? await hashPassword(password) : null,
    ...rest,
  });
}

/** A cookie-keeping client that sends the CSRF token automatically on unsafe requests. */
export async function client() {
  const agent = request.agent(await getApp());
  let csrfToken;
  const refreshCsrf = async () => {
    const res = await agent.get('/api/v1/auth/csrf');
    csrfToken = res.body.data.csrfToken;
  };
  await refreshCsrf();

  const withCsrf = (method) => (url) => agent[method](url).set('X-CSRF-Token', csrfToken);
  return {
    agent,
    get: (url) => agent.get(url),
    post: withCsrf('post'),
    patch: withCsrf('patch'),
    put: withCsrf('put'),
    delete: withCsrf('delete'),
    refreshCsrf,
    async login(email, password = TEST_PASSWORD) {
      const res = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', csrfToken).send({ email, password });
      if (res.body?.data?.csrfToken) csrfToken = res.body.data.csrfToken;
      return res;
    },
  };
}

let org;
/** One active department and designation shared by a test file. */
export async function getOrg() {
  if (!org) {
    const { Department } = await import('../src/modules/organization/department.model.js');
    const { Designation } = await import('../src/modules/organization/designation.model.js');
    org = {
      department: await Department.create({ name: `Engineering ${Date.now()}`, code: `E${counter}${Date.now() % 1000}` }),
      designation: await Designation.create({ title: `Engineer ${Date.now()}`, level: 3 }),
    };
  }
  return org;
}

/** Inserts an employee directly (fixtures). Flows under test go through the API instead. */
export async function createEmployeeRecord(overrides = {}) {
  const { Employee } = await import('../src/modules/employees/employee.model.js');
  const { department, designation } = await getOrg();
  counter += 1;
  return Employee.create({
    employeeCode: `T-${Date.now()}-${counter}`,
    firstName: 'Test',
    lastName: `Person${counter}`,
    workEmail: `emp${counter}.${Date.now()}@senova.test`,
    department: department._id,
    designation: designation._id,
    employmentType: 'full_time',
    joiningDate: new Date('2024-01-15T00:00:00Z'),
    lifecycleStatus: 'active',
    ...overrides,
  });
}

/** An employee record with a linked login holding `roles`, signed in. */
export async function signedInAsEmployee(roles, employeeOverrides = {}) {
  const employee = await createEmployeeRecord(employeeOverrides);
  const session = await signedInAs(roles, { employee: employee._id, email: employee.workEmail, name: employee.fullName });
  return { ...session, employee };
}

/** Creates a user with the given roles and returns a signed-in client. */
export async function signedInAs(roles, overrides = {}) {
  const user = await createTestUser({ roles, ...overrides });
  const c = await client();
  const res = await c.login(user.email);
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { user, client: c };
}
