/**
 * Creates the first Super Admin in any environment (including production) by sending an
 * invitation link — no password is ever passed on the command line.
 *   node --env-file=.env scripts/create-admin.js "Full Name" admin@company.com
 */
import { env } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/db/connection.js';
import { ensureDefaultRoles } from '../src/modules/roles/role.service.js';
import { getSettings } from '../src/modules/company/company.service.js';
import { sendInvite } from '../src/modules/auth/auth.service.js';
import { User } from '../src/modules/users/user.model.js';
import { SUPER_ADMIN } from '../src/modules/roles/permissions.js';

const [name, rawEmail] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: node --env-file=.env scripts/create-admin.js "Full Name" admin@company.com');
  process.exit(1);
}

await connectDatabase(env.MONGODB_URI);
await ensureDefaultRoles();
await getSettings();

if (await User.exists({ email })) {
  console.error(`A user with email ${email} already exists.`);
} else {
  const user = await User.create({ name, email, roles: [SUPER_ADMIN], status: 'invited' });
  await sendInvite(user);
  console.log(`Invitation sent to ${email}. The link expires in 72 hours.`);
}

await disconnectDatabase();
