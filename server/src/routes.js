import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes.js';
import { userRouter } from './modules/users/user.routes.js';
import { roleRouter } from './modules/roles/role.routes.js';
import { companyRouter } from './modules/company/company.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { departmentRouter, designationRouter } from './modules/organization/organization.routes.js';
import { employeeRouter } from './modules/employees/employee.routes.js';
import { documentRouter } from './modules/documents/document.routes.js';
import { onboardingRouter } from './modules/onboarding/onboarding.routes.js';
import { holidayRouter } from './modules/holidays/holiday.routes.js';
import { attendanceRouter, shiftRouter } from './modules/attendance/attendance.routes.js';
import { leaveRouter } from './modules/leave/leave.routes.js';
import { timesheetRouter } from './modules/timesheets/timesheet.routes.js';
import { recruitmentRouter } from './modules/recruitment/recruitment.routes.js';
import { payrollRouter } from './modules/payroll/payroll.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';

/** Every authenticated business module is mounted here under /api/v1. */
export function createApiRouter() {
  const router = Router();
  router.use('/auth', authRouter);
  router.use('/users', userRouter);
  router.use('/roles', roleRouter);
  router.use('/company', companyRouter);
  router.use('/audit-logs', auditRouter);
  router.use('/departments', departmentRouter);
  router.use('/designations', designationRouter);
  router.use('/employees', employeeRouter);
  router.use('/documents', documentRouter);
  router.use('/onboarding', onboardingRouter);
  router.use('/holidays', holidayRouter);
  router.use('/shifts', shiftRouter);
  router.use('/attendance', attendanceRouter);
  router.use('/leave', leaveRouter);
  router.use('/timesheets', timesheetRouter);
  router.use('/recruitment', recruitmentRouter);
  router.use('/payroll', payrollRouter);
  router.use('/dashboard', dashboardRouter);
  return router;
}
