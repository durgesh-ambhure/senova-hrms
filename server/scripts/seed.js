/**
 * Development seed. Idempotent: creates system roles, company settings, a Super Admin and
 * (once) realistic demo organization data with one login per role — see scripts/seed-demo.js.
 * Refuses to run in production. Credentials come from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 */
import { env } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/db/connection.js';
import { ensureDefaultRoles } from '../src/modules/roles/role.service.js';
import { getSettings } from '../src/modules/company/company.service.js';
import { User } from '../src/modules/users/user.model.js';
import { SUPER_ADMIN } from '../src/modules/roles/permissions.js';
import { hashPassword, passwordSchema } from '../src/shared/security/password.js';
import { seedDemoData } from './seed-demo.js';
import { seedTimeData } from './seed-time.js';
import { seedRecruitmentData } from './seed-recruitment.js';
import { seedPayrollData } from './seed-payroll.js';

if (env.isProduction) {
  console.error('Refusing to seed a production database. Create the first Super Admin with scripts/create-admin.js.');
  process.exit(1);
}

const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) {
  console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in server/.env before seeding.');
  process.exit(1);
}
const strength = passwordSchema.safeParse(password);
if (!strength.success) {
  console.error(`SEED_ADMIN_PASSWORD: ${strength.error.issues[0].message}`);
  process.exit(1);
}

await connectDatabase(env.MONGODB_URI);
await ensureDefaultRoles();
await getSettings();

const existing = await User.findOne({ email });
if (existing) {
  console.log(`Super Admin ${email} already exists — left unchanged.`);
} else {
  await User.create({
    name: 'Super Admin',
    email,
    roles: [SUPER_ADMIN],
    status: 'active',
    passwordHash: await hashPassword(password),
    passwordChangedAt: new Date(),
  });
  console.log(`Created Super Admin ${email}.`);
}

await seedDemoData({ password, domain: email.split('@')[1] });
await seedTimeData();
await seedRecruitmentData();
await seedPayrollData();

await disconnectDatabase();
