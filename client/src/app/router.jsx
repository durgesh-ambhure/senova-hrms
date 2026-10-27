import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from '../components/layout/AppShell.jsx';
import { GuestRoute, ProtectedRoute } from '../features/auth/ProtectedRoute.jsx';
import { LoginPage } from '../features/auth/LoginPage.jsx';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage.jsx';
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage.jsx';
import { DashboardPage } from '../features/dashboard/DashboardPage.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';

// Feature pages are split into their own chunks and loaded on first visit.
const page = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const UsersPage = page(() => import('../features/settings/UsersPage.jsx'), 'UsersPage');
const RolesPage = page(() => import('../features/settings/RolesPage.jsx'), 'RolesPage');
const CompanyPage = page(() => import('../features/settings/CompanyPage.jsx'), 'CompanyPage');
const AuditLogPage = page(() => import('../features/settings/AuditLogPage.jsx'), 'AuditLogPage');
const SecurityPage = page(() => import('../features/account/SecurityPage.jsx'), 'SecurityPage');
const EmployeesPage = page(() => import('../features/employees/EmployeesPage.jsx'), 'EmployeesPage');
const EmployeeFormPage = page(() => import('../features/employees/EmployeeFormPage.jsx'), 'EmployeeFormPage');
const EmployeeProfilePage = page(() => import('../features/employees/EmployeeProfilePage.jsx'), 'EmployeeProfilePage');
const MyProfilePage = page(() => import('../features/employees/EmployeeProfilePage.jsx'), 'MyProfilePage');
const OnboardingPage = page(() => import('../features/onboarding/OnboardingPage.jsx'), 'OnboardingPage');
const AttendancePage = page(() => import('../features/time/AttendancePage.jsx'), 'AttendancePage');
const LeaveRequestsPage = page(() => import('../features/time/LeavePages.jsx'), 'LeaveRequestsPage');
const LeaveBalancesPage = page(() => import('../features/time/LeavePages.jsx'), 'LeaveBalancesPage');
const TimesheetsPage = page(() => import('../features/time/TimesheetsPage.jsx'), 'TimesheetsPage');
const HolidaysPage = page(() => import('../features/time/HolidaysPage.jsx'), 'HolidaysPage');
const PoliciesPage = page(() => import('../features/time/PoliciesPage.jsx'), 'PoliciesPage');
const JobsPage = page(() => import('../features/recruitment/JobPages.jsx'), 'JobsPage');
const JobFormPage = page(() => import('../features/recruitment/JobPages.jsx'), 'JobFormPage');
const JobDetailPage = page(() => import('../features/recruitment/JobPages.jsx'), 'JobDetailPage');
const CandidatesPage = page(() => import('../features/recruitment/CandidatePages.jsx'), 'CandidatesPage');
const CandidateProfilePage = page(() => import('../features/recruitment/CandidatePages.jsx'), 'CandidateProfilePage');
const PipelinePage = page(() => import('../features/recruitment/WorkflowPages.jsx'), 'PipelinePage');
const InterviewsPage = page(() => import('../features/recruitment/WorkflowPages.jsx'), 'InterviewsPage');
const OffersPage = page(() => import('../features/recruitment/WorkflowPages.jsx'), 'OffersPage');
const PayrollRunsPage = page(() => import('../features/payroll/RunPages.jsx'), 'PayrollRunsPage');
const RunDetailPage = page(() => import('../features/payroll/RunPages.jsx'), 'RunDetailPage');
const SalariesPage = page(() => import('../features/payroll/SalaryPages.jsx'), 'SalariesPage');
const SalaryDetailPage = page(() => import('../features/payroll/SalaryPages.jsx'), 'SalaryDetailPage');
const PayslipsPage = page(() => import('../features/payroll/OtherPages.jsx'), 'PayslipsPage');
const PayrollSettingsPage = page(() => import('../features/payroll/OtherPages.jsx'), 'PayrollSettingsPage');
const ReportsPage = page(() => import('../features/payroll/OtherPages.jsx'), 'ReportsPage');
const OrganizationPage = page(() => import('../features/organization/OrganizationPage.jsx'), 'OrganizationPage');

const PAYROLL_READERS = ['payroll:read', 'payroll:process', 'payroll:approve', 'payroll:finalize'];
const RECRUITMENT_ANY = ['recruitment:jobs:manage', 'recruitment:candidates:manage', 'recruitment:interviews:manage', 'recruitment:interviews:feedback', 'recruitment:offers:manage', 'recruitment:offers:approve', 'recruitment:hire'];

/** Route-level permission checks mirror the API's; they only decide what to render. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>
      {/* Reachable signed in or out: an admin may open an invite link meant for a new account. */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/account/security" element={<SecurityPage />} />
          <Route
            path="/profile"
            element={
              <ProtectedRoute anyOf={['self:profile']}>
                <MyProfilePage />
              </ProtectedRoute>
            }
          />
          <Route path="/employees">
            <Route
              index
              element={
                <ProtectedRoute anyOf={['employees:read:all', 'employees:read:team']}>
                  <EmployeesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="new"
              element={
                <ProtectedRoute anyOf={['employees:manage']}>
                  <EmployeeFormPage />
                </ProtectedRoute>
              }
            />
            {/* Record-level access is decided by the API (all / team / self). */}
            <Route path=":id" element={<EmployeeProfilePage />} />
            <Route
              path=":id/edit"
              element={
                <ProtectedRoute anyOf={['employees:manage']}>
                  <EmployeeFormPage />
                </ProtectedRoute>
              }
            />
          </Route>
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute anyOf={['onboarding:manage', 'self:onboarding']}>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/attendance"
            element={
              <ProtectedRoute anyOf={['self:attendance', 'attendance:read:all', 'attendance:read:team', 'attendance:manage']}>
                <AttendancePage />
              </ProtectedRoute>
            }
          />
          <Route path="/leave">
            <Route index element={<Navigate to="/leave/requests" replace />} />
            <Route
              path="requests"
              element={
                <ProtectedRoute anyOf={['self:leave', 'leave:manage', 'leave:approve:team']}>
                  <LeaveRequestsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="balances"
              element={
                <ProtectedRoute anyOf={['self:leave', 'leave:manage', 'leave:approve:team']}>
                  <LeaveBalancesPage />
                </ProtectedRoute>
              }
            />
          </Route>
          <Route
            path="/timesheets"
            element={
              <ProtectedRoute anyOf={['self:timesheets', 'timesheets:manage', 'timesheets:approve:team']}>
                <TimesheetsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/recruitment">
            <Route index element={<Navigate to="/recruitment/jobs" replace />} />
            <Route
              path="jobs"
              element={
                <ProtectedRoute anyOf={RECRUITMENT_ANY}>
                  <JobsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="jobs/new"
              element={
                <ProtectedRoute anyOf={['recruitment:jobs:manage']}>
                  <JobFormPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="jobs/:id"
              element={
                <ProtectedRoute anyOf={RECRUITMENT_ANY}>
                  <JobDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="jobs/:id/edit"
              element={
                <ProtectedRoute anyOf={['recruitment:jobs:manage']}>
                  <JobFormPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="candidates"
              element={
                <ProtectedRoute anyOf={['recruitment:candidates:manage']}>
                  <CandidatesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="candidates/:id"
              element={
                <ProtectedRoute anyOf={RECRUITMENT_ANY}>
                  <CandidateProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="applications"
              element={
                <ProtectedRoute anyOf={RECRUITMENT_ANY}>
                  <PipelinePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="interviews"
              element={
                <ProtectedRoute anyOf={RECRUITMENT_ANY}>
                  <InterviewsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="offers"
              element={
                <ProtectedRoute anyOf={['recruitment:offers:manage', 'recruitment:offers:approve', 'recruitment:hire']}>
                  <OffersPage />
                </ProtectedRoute>
              }
            />
          </Route>
          <Route path="/payroll">
            <Route index element={<Navigate to="/payroll/runs" replace />} />
            <Route
              path="runs"
              element={
                <ProtectedRoute anyOf={PAYROLL_READERS}>
                  <PayrollRunsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="runs/:id"
              element={
                <ProtectedRoute anyOf={PAYROLL_READERS}>
                  <RunDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="payslips"
              element={
                <ProtectedRoute anyOf={['self:payslips', 'payslips:read:all']}>
                  <PayslipsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="salaries"
              element={
                <ProtectedRoute anyOf={['payroll:read', 'payroll:salary:manage']}>
                  <SalariesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="salaries/:employeeId"
              element={
                <ProtectedRoute anyOf={['payroll:read', 'payroll:salary:manage']}>
                  <SalaryDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="settings"
              element={
                <ProtectedRoute anyOf={['payroll:read', 'payroll:rules:manage', 'payroll:finalize', 'payroll:salary:manage']}>
                  <PayrollSettingsPage />
                </ProtectedRoute>
              }
            />
          </Route>
          <Route
            path="/reports"
            element={
              <ProtectedRoute anyOf={['reports:payroll', 'payroll:read']}>
                <ReportsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/settings">
            <Route index element={<Navigate to="/settings/company" replace />} />
            <Route
              path="users"
              element={
                <ProtectedRoute anyOf={['users:read']}>
                  <UsersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="roles"
              element={
                <ProtectedRoute anyOf={['roles:read']}>
                  <RolesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="company"
              element={
                <ProtectedRoute anyOf={['company:read']}>
                  <CompanyPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="audit-log"
              element={
                <ProtectedRoute anyOf={['audit:read']}>
                  <AuditLogPage />
                </ProtectedRoute>
              }
            />
            <Route path="holidays" element={<HolidaysPage />} />
            <Route
              path="policies"
              element={
                <ProtectedRoute anyOf={['company:manage', 'attendance:manage', 'leave:manage']}>
                  <PoliciesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="organization"
              element={
                <ProtectedRoute anyOf={['organization:manage']}>
                  <OrganizationPage />
                </ProtectedRoute>
              }
            />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
