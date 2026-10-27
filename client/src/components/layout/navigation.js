import {
  Building,
  Building2,
  CalendarDays,
  ClipboardCheck,
  Clock,
  LayoutDashboard,
  Palmtree,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  UserRound,
  Users,
  UsersRound,
  Wallet,
  Briefcase,
  Contact,
  KanbanSquare,
  CalendarClock,
  Gift,
  Banknote,
  FileText,
  IndianRupee,
  Settings2,
  BarChart3,
} from 'lucide-react';

/**
 * Sidebar structure. An item shows when the user holds any `anyOf` permission and none of
 * `noneOf` (usability only — the API authorizes every request). Modules are added per phase.
 */
export const NAVIGATION = [
  {
    section: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      {
        to: '/profile',
        label: 'My profile',
        icon: UserRound,
        anyOf: ['self:profile'],
      },
    ],
  },
  {
    section: 'People',
    items: [
      {
        to: '/employees',
        label: 'Employees',
        icon: UsersRound,
        anyOf: ['employees:read:all'],
      },
      {
        to: '/employees',
        label: 'My team',
        icon: UsersRound,
        anyOf: ['employees:read:team'],
        noneOf: ['employees:read:all'],
      },
      {
        to: '/onboarding',
        label: 'Onboarding',
        icon: ClipboardCheck,
        anyOf: ['onboarding:manage', 'self:onboarding'],
      },
    ],
  },
  {
    section: 'Time',
    items: [
      {
        to: '/attendance',
        label: 'Attendance',
        icon: Clock,
        anyOf: ['self:attendance', 'attendance:read:all', 'attendance:read:team'],
      },
      {
        to: '/leave/requests',
        label: 'Leave',
        icon: Palmtree,
        anyOf: ['self:leave', 'leave:manage', 'leave:approve:team'],
      },
      {
        to: '/leave/balances',
        label: 'Leave balances',
        icon: Wallet,
        anyOf: ['self:leave', 'leave:manage', 'leave:approve:team'],
      },
      {
        to: '/timesheets',
        label: 'Timesheets',
        icon: Timer,
        anyOf: ['self:timesheets', 'timesheets:manage', 'timesheets:approve:team'],
      },
      { to: '/settings/holidays', label: 'Holidays', icon: CalendarDays },
    ],
  },
  {
    section: 'Recruitment',
    items: [
      {
        to: '/recruitment/jobs',
        label: 'Jobs',
        icon: Briefcase,
        anyOf: ['recruitment:jobs:manage', 'recruitment:candidates:manage', 'recruitment:offers:manage', 'recruitment:hire'],
      },
      {
        to: '/recruitment/jobs',
        label: 'My hiring',
        icon: Briefcase,
        anyOf: ['recruitment:interviews:feedback'],
        noneOf: ['recruitment:jobs:manage', 'recruitment:candidates:manage', 'recruitment:offers:manage', 'recruitment:hire'],
      },
      {
        to: '/recruitment/candidates',
        label: 'Candidates',
        icon: Contact,
        anyOf: ['recruitment:candidates:manage'],
      },
      {
        to: '/recruitment/applications',
        label: 'Pipeline',
        icon: KanbanSquare,
        anyOf: ['recruitment:candidates:manage'],
      },
      {
        to: '/recruitment/interviews',
        label: 'Interviews',
        icon: CalendarClock,
        anyOf: ['recruitment:interviews:manage', 'recruitment:interviews:feedback'],
      },
      {
        to: '/recruitment/offers',
        label: 'Offers',
        icon: Gift,
        anyOf: ['recruitment:offers:manage', 'recruitment:offers:approve', 'recruitment:hire'],
      },
    ],
  },
  {
    section: 'Payroll',
    items: [
      {
        to: '/payroll/runs',
        label: 'Payroll runs',
        icon: Banknote,
        anyOf: ['payroll:read', 'payroll:process', 'payroll:approve', 'payroll:finalize'],
      },
      {
        to: '/payroll/payslips',
        label: 'Payslips',
        icon: FileText,
        anyOf: ['self:payslips', 'payslips:read:all'],
      },
      {
        to: '/payroll/salaries',
        label: 'Salaries',
        icon: IndianRupee,
        anyOf: ['payroll:read', 'payroll:salary:manage'],
      },
      {
        to: '/payroll/settings',
        label: 'Payroll settings',
        icon: Settings2,
        anyOf: ['payroll:rules:manage', 'payroll:finalize'],
      },
      {
        to: '/reports',
        label: 'Reports',
        icon: BarChart3,
        anyOf: ['reports:payroll', 'payroll:read'],
      },
    ],
  },
  {
    section: 'Administration',
    items: [
      {
        to: '/settings/organization',
        label: 'Organization',
        icon: Building,
        anyOf: ['organization:manage'],
      },
      {
        to: '/settings/policies',
        label: 'Time & leave policies',
        icon: SlidersHorizontal,
        anyOf: ['company:manage', 'attendance:manage', 'leave:manage'],
      },
      {
        to: '/settings/users',
        label: 'Users',
        icon: Users,
        anyOf: ['users:read'],
      },
      {
        to: '/settings/roles',
        label: 'Roles & permissions',
        icon: ShieldCheck,
        anyOf: ['roles:read'],
      },
      {
        to: '/settings/company',
        label: 'Company',
        icon: Building2,
        anyOf: ['company:manage'],
      },
      {
        to: '/settings/audit-log',
        label: 'Audit log',
        icon: ScrollText,
        anyOf: ['audit:read'],
      },
    ],
  },
];

export function visibleNavigation(canAny) {
  return NAVIGATION.map((s) => ({
    ...s,
    items: s.items.filter((i) => (!i.anyOf || canAny(...i.anyOf)) && !(i.noneOf && canAny(...i.noneOf))),
  })).filter((s) => s.items.length);
}

/** Labels for breadcrumb segments. Record IDs show as "Profile". */
export const BREADCRUMB_LABELS = {
  dashboard: 'Dashboard',
  settings: 'Settings',
  users: 'Users',
  roles: 'Roles & permissions',
  company: 'Company',
  'audit-log': 'Audit log',
  organization: 'Organization',
  account: 'My account',
  security: 'Security',
  employees: 'Employees',
  new: 'New',
  edit: 'Edit',
  onboarding: 'Onboarding',
  profile: 'My profile',
  attendance: 'Attendance',
  leave: 'Leave',
  requests: 'Requests',
  balances: 'Balances',
  timesheets: 'Timesheets',
  holidays: 'Holidays',
  policies: 'Time & leave policies',
  recruitment: 'Recruitment',
  jobs: 'Jobs',
  candidates: 'Candidates',
  applications: 'Pipeline',
  interviews: 'Interviews',
  offers: 'Offers',
  payroll: 'Payroll',
  runs: 'Runs',
  payslips: 'Payslips',
  salaries: 'Salaries',
  reports: 'Reports',
};

export const breadcrumbLabel = (segment, humanize) => BREADCRUMB_LABELS[segment] ?? (/^[a-f\d]{24}$/i.test(segment) ? 'Profile' : humanize(segment));
