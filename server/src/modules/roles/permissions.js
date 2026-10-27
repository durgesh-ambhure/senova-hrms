/**
 * Permission catalog. Keys follow `resource:action[:scope]`.
 *   :all  → any record          :team → records of the actor's direct/indirect reports
 *   self:* → the actor's own records only
 * Scoped permissions are resolved against the actual record in each module's policy.
 * Permissions for later phases are declared now so roles are stable as modules land.
 */
export const PERMISSIONS = [
  // Administration
  { key: 'users:read', module: 'Administration', label: 'View user accounts' },
  { key: 'users:manage', module: 'Administration', label: 'Create, edit and disable user accounts' },
  { key: 'roles:read', module: 'Administration', label: 'View roles and permissions' },
  { key: 'roles:manage', module: 'Administration', label: 'Create and edit roles' },
  { key: 'company:read', module: 'Administration', label: 'View company settings' },
  { key: 'company:manage', module: 'Administration', label: 'Edit company settings and policies' },
  { key: 'audit:read', module: 'Administration', label: 'View audit logs' },

  // Employees & onboarding
  { key: 'employees:read:all', module: 'Employees', label: 'View all employee profiles' },
  { key: 'employees:read:team', module: 'Employees', label: "View team members' profiles" },
  { key: 'employees:manage', module: 'Employees', label: 'Create, edit and archive employees' },
  { key: 'employees:sensitive:read', module: 'Employees', label: 'View bank, identity and compensation details' },
  { key: 'organization:manage', module: 'Employees', label: 'Manage departments, designations and holidays' },
  { key: 'documents:manage', module: 'Employees', label: 'Upload and verify employee documents' },
  { key: 'onboarding:manage', module: 'Employees', label: 'Manage onboarding and offboarding' },

  // Attendance, leave, timesheets
  { key: 'attendance:read:all', module: 'Time', label: 'View all attendance' },
  { key: 'attendance:read:team', module: 'Time', label: 'View team attendance' },
  { key: 'attendance:manage', module: 'Time', label: 'Administer attendance, shifts and corrections' },
  { key: 'attendance:approve:team', module: 'Time', label: "Approve team members' attendance corrections" },
  { key: 'leave:approve:team', module: 'Time', label: "Approve team members' leave" },
  { key: 'leave:manage', module: 'Time', label: 'Administer leave types, balances and requests' },
  { key: 'timesheets:approve:team', module: 'Time', label: "Approve team members' timesheets" },
  { key: 'timesheets:manage', module: 'Time', label: 'Administer timesheets and projects' },

  // Recruitment
  { key: 'recruitment:jobs:manage', module: 'Recruitment', label: 'Manage job openings' },
  { key: 'recruitment:candidates:manage', module: 'Recruitment', label: 'Manage candidates and applications' },
  { key: 'recruitment:interviews:manage', module: 'Recruitment', label: 'Schedule interviews' },
  { key: 'recruitment:interviews:feedback', module: 'Recruitment', label: 'Give feedback on assigned interviews' },
  { key: 'recruitment:offers:manage', module: 'Recruitment', label: 'Prepare offers' },
  { key: 'recruitment:offers:approve', module: 'Recruitment', label: 'Approve offers' },
  { key: 'recruitment:hire', module: 'Recruitment', label: 'Convert hired candidates to employees' },

  // Payroll
  { key: 'payroll:salary:manage', module: 'Payroll', label: 'Manage salary structures and revisions' },
  { key: 'payroll:rules:manage', module: 'Payroll', label: 'Edit payroll rule settings (PF, ESI, PT, salary template)' },
  { key: 'payroll:read', module: 'Payroll', label: 'View payroll runs' },
  { key: 'payroll:process', module: 'Payroll', label: 'Prepare and calculate payroll' },
  { key: 'payroll:approve', module: 'Payroll', label: 'Approve payroll runs' },
  { key: 'payroll:finalize', module: 'Payroll', label: 'Finalize and lock payroll runs' },
  { key: 'payslips:read:all', module: 'Payroll', label: 'View and download all payslips' },

  // Reports
  { key: 'reports:hr', module: 'Reports', label: 'HR reports' },
  { key: 'reports:payroll', module: 'Reports', label: 'Payroll reports' },

  // Self-service
  { key: 'self:profile', module: 'Self-service', label: 'View and update own profile' },
  { key: 'self:attendance', module: 'Self-service', label: 'Own attendance' },
  { key: 'self:leave', module: 'Self-service', label: 'Own leave' },
  { key: 'self:timesheets', module: 'Self-service', label: 'Own timesheets' },
  { key: 'self:payslips', module: 'Self-service', label: 'Own payslips' },
  { key: 'self:onboarding', module: 'Self-service', label: 'Own onboarding tasks' },
];

export const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));
export const WILDCARD = '*';

const SELF = PERMISSIONS.filter((p) => p.key.startsWith('self:')).map((p) => p.key);

export const SUPER_ADMIN = 'super_admin';

/** Default system roles. Seeded into MongoDB; super_admin is immutable. */
export const DEFAULT_ROLES = [
  {
    key: SUPER_ADMIN,
    name: 'Super Admin',
    description: 'Full system administration, including users, roles, company configuration and audit logs.',
    permissions: [WILDCARD],
  },
  {
    key: 'hr_admin',
    name: 'HR Admin',
    description: 'Employee lifecycle, onboarding, recruitment, leave and attendance administration.',
    permissions: [
      'users:read',
      'roles:read',
      'company:read',
      'employees:read:all',
      'employees:manage',
      'employees:sensitive:read',
      'organization:manage',
      'documents:manage',
      'onboarding:manage',
      'attendance:read:all',
      'attendance:manage',
      'leave:manage',
      'timesheets:manage',
      'recruitment:jobs:manage',
      'recruitment:candidates:manage',
      'recruitment:interviews:manage',
      'recruitment:offers:manage',
      'recruitment:offers:approve',
      'recruitment:hire',
      'reports:hr',
      // DECISIONS P10: HR / Finance head approves payroll prepared by the Payroll Admin.
      'payroll:read',
      'payroll:approve',
      'reports:payroll',
      ...SELF,
    ],
  },
  {
    key: 'payroll_admin',
    name: 'Payroll Admin',
    description: 'Salary structures, payroll processing, payslips and payroll reports. Approval only when granted.',
    permissions: [
      'company:read',
      'employees:read:all',
      'employees:sensitive:read',
      'attendance:read:all',
      'payroll:salary:manage',
      'payroll:rules:manage',
      'payroll:read',
      'payroll:process',
      'payslips:read:all',
      'reports:payroll',
      ...SELF,
    ],
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Team information, attendance, leave and timesheet approvals, assigned interview feedback.',
    permissions: [
      'company:read',
      'employees:read:team',
      'attendance:read:team',
      'attendance:approve:team',
      'leave:approve:team',
      'timesheets:approve:team',
      'recruitment:interviews:feedback',
      ...SELF,
    ],
  },
  {
    key: 'recruiter',
    name: 'Recruiter',
    description: 'Job openings, candidates, applications, interviews and offers within assigned permissions.',
    permissions: [
      'company:read',
      'recruitment:jobs:manage',
      'recruitment:candidates:manage',
      'recruitment:interviews:manage',
      'recruitment:interviews:feedback',
      'recruitment:offers:manage',
      ...SELF,
    ],
  },
  {
    key: 'employee',
    name: 'Employee',
    description: 'Self-service: own profile, attendance, leave, timesheets, payslips and onboarding tasks.',
    permissions: ['company:read', ...SELF],
  },
];

export function hasPermission(permissions, required) {
  return permissions.has(WILDCARD) || permissions.has(required);
}
