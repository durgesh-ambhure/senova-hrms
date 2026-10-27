/**
 * Non-production demo data: departments, designations, default checklists, a small reporting
 * hierarchy and one login per role (HR Admin, Manager, Employee, Recruiter, Payroll Admin).
 * Demo logins share SEED_ADMIN_PASSWORD. Runs only when no employees exist yet.
 */
import { Department } from '../src/modules/organization/department.model.js';
import { Designation } from '../src/modules/organization/designation.model.js';
import { Employee } from '../src/modules/employees/employee.model.js';
import { EmploymentEvent } from '../src/modules/employees/employmentEvent.model.js';
import { OnboardingTemplate } from '../src/modules/onboarding/onboardingTemplate.model.js';
import { User } from '../src/modules/users/user.model.js';
import { getSettings } from '../src/modules/company/company.service.js';
import { nextSequence } from '../src/db/counter.model.js';
import { addDays, addMonths, parseDateOnly, todayIn } from '../src/shared/dates.js';
import { hashPassword } from '../src/shared/security/password.js';

const DEPARTMENTS = [
  ['Human Resources', 'HR'],
  ['Engineering', 'ENG'],
  ['Finance', 'FIN'],
  ['Sales', 'SAL'],
  ['Operations', 'OPS'],
];
const DESIGNATIONS = [
  ['Intern', 1],
  ['Associate', 2],
  ['Software Engineer', 3],
  ['Senior Software Engineer', 4],
  ['HR Executive', 3],
  ['Accountant', 3],
  ['Sales Executive', 3],
  ['Engineering Manager', 6],
  ['HR Manager', 6],
  ['Head of Operations', 8],
];

const ONBOARDING = {
  name: 'Standard onboarding',
  kind: 'onboarding',
  description: 'Default joining formalities for new employees.',
  tasks: [
    { title: 'Upload identity proof (PAN / passport)', assigneeType: 'employee', dueOffsetDays: -3, documentCategory: 'identity' },
    { title: 'Upload address proof', assigneeType: 'employee', dueOffsetDays: -3, documentCategory: 'address_proof' },
    { title: 'Upload cancelled cheque or bank statement', assigneeType: 'employee', dueOffsetDays: 0, documentCategory: 'bank_proof' },
    { title: 'Upload highest education certificate', assigneeType: 'employee', dueOffsetDays: 7, documentCategory: 'education' },
    { title: 'Issue appointment letter', assigneeType: 'hr', dueOffsetDays: 0, documentCategory: null },
    { title: 'Create email account and system access', assigneeType: 'hr', dueOffsetDays: -1, documentCategory: null },
    { title: 'Assign onboarding buddy and 30-60-90 day plan', assigneeType: 'manager', dueOffsetDays: 3, documentCategory: null },
    { title: 'Complete induction and policy acknowledgement', assigneeType: 'employee', dueOffsetDays: 7, documentCategory: null },
  ],
};
const OFFBOARDING = {
  name: 'Standard offboarding',
  kind: 'offboarding',
  description: 'Exit formalities before the last working day.',
  tasks: [
    { title: 'Knowledge transfer and handover', assigneeType: 'manager', dueOffsetDays: -5, documentCategory: null },
    { title: 'Return laptop, ID card and other assets', assigneeType: 'employee', dueOffsetDays: 0, documentCategory: null },
    { title: 'Revoke system access', assigneeType: 'hr', dueOffsetDays: 0, documentCategory: null },
    { title: 'Exit interview', assigneeType: 'hr', dueOffsetDays: -2, documentCategory: null },
    { title: 'Issue relieving letter', assigneeType: 'hr', dueOffsetDays: 1, documentCategory: null },
  ],
};

// name, dept, designation, manager index, months since joining (negative = future), type, login role
const PEOPLE = [
  ['Ananya Rao', 'OPS', 'Head of Operations', null, 40, 'full_time', null],
  ['Kavita Menon', 'HR', 'HR Manager', 0, 30, 'full_time', 'hr_admin'],
  ['Vikram Singh', 'ENG', 'Engineering Manager', 0, 26, 'full_time', 'manager'],
  ['Rohan Gupta', 'ENG', 'Senior Software Engineer', 2, 18, 'full_time', 'employee'],
  ['Sneha Kulkarni', 'ENG', 'Software Engineer', 2, 4, 'full_time', null],
  ['Arjun Nair', 'ENG', 'Intern', 3, 2, 'intern', null],
  ['Farah Khan', 'FIN', 'Accountant', 0, 14, 'full_time', 'payroll_admin'],
  ['Deepak Joshi', 'SAL', 'Sales Executive', 0, 9, 'contract', null],
  ['Ishita Bose', 'HR', 'HR Executive', 1, 11, 'full_time', 'recruiter'],
  ['Neha Patil', 'ENG', 'Software Engineer', 2, -0.5, 'full_time', null],
];

export async function seedDemoData({ password, domain }) {
  if (await Employee.exists({})) {
    console.log('Demo data already present — skipped.');
    return;
  }
  const settings = await getSettings();
  const today = todayIn(settings.timezone);

  const depts = {};
  for (const [name, code] of DEPARTMENTS) depts[code] = await Department.create({ name, code });
  const desigs = {};
  for (const [title, level] of DESIGNATIONS) desigs[title] = await Designation.create({ title, level });
  await OnboardingTemplate.create([ONBOARDING, OFFBOARDING]);

  const created = [];
  const passwordHash = await hashPassword(password);
  for (const [name, dept, title, managerIdx, months, type, role] of PEOPLE) {
    const [firstName, lastName] = name.split(' ');
    const joining = months >= 1 ? addMonths(today, -Math.round(months)) : addDays(today, Math.round(-months * 30));
    const workEmail = `${firstName}.${lastName}@${domain}`.toLowerCase();
    const seq = await nextSequence('employeeCode');
    const onProbation = months > 0 && months < 6;
    const emp = await Employee.create({
      employeeCode: `${settings.employeeCodePrefix}-${String(seq).padStart(4, '0')}`,
      firstName,
      lastName,
      workEmail,
      phone: `+91 98${String(10000000 + seq * 7919).slice(0, 8)}`,
      department: depts[dept]._id,
      designation: desigs[title]._id,
      reportingManager: managerIdx === null ? null : created[managerIdx]._id,
      employmentType: type,
      workLocation: dept === 'SAL' ? 'Mumbai' : 'Pune',
      joiningDate: parseDateOnly(joining),
      lifecycleStatus: months > 0 ? 'active' : 'pre_joining',
      probation: onProbation || months <= 0 ? { status: 'on_probation', endDate: parseDateOnly(addMonths(joining, 6)) } : { status: 'confirmed', confirmedOn: parseDateOnly(addMonths(joining, 6)) },
    });
    await EmploymentEvent.create({ employee: emp._id, type: 'created', effectiveDate: parseDateOnly(joining), to: emp.lifecycleStatus, actorName: 'Seed' });
    created.push(emp);
    if (role) {
      await User.create({ name, email: workEmail, roles: [role], status: 'active', employee: emp._id, passwordHash, passwordChangedAt: new Date() });
      console.log(`  demo login (${role}): ${workEmail}`);
    }
  }
  await Department.updateOne({ _id: depts.ENG._id }, { head: created[2]._id });
  await Department.updateOne({ _id: depts.HR._id }, { head: created[1]._id });
  console.log(`Seeded ${created.length} demo employees. Demo logins use SEED_ADMIN_PASSWORD.`);
}
