import { User } from '../users/user.model.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { getSettings } from '../company/company.service.js';
import { hasPermission } from '../roles/permissions.js';
import { Employee } from '../employees/employee.model.js';
import { OnboardingTask } from '../onboarding/onboardingTask.model.js';
import { listMyTasks } from '../onboarding/onboarding.service.js';
import { AttendanceRecord } from '../attendance/attendanceRecord.model.js';
import { LeaveRequest } from '../leave/leave.models.js';
import { getMyToday, listCorrections } from '../attendance/attendance.service.js';
import { listRequests } from '../leave/leave.service.js';
import { listTimesheets } from '../timesheets/timesheet.service.js';
import { Application, Interview, JobOffer, JobOpening } from '../recruitment/recruitment.models.js';
import { ACTIVE_STAGES } from '../recruitment/recruitment.rules.js';
import { isRecruitmentStaff } from '../recruitment/recruitment.policy.js';
import { PayrollRun } from '../payroll/payroll.models.js';
import { addDays, parseDateOnly, toDateOnly, todayIn } from '../../shared/dates.js';

/**
 * Permission-filtered dashboard. Each widget is computed only when the actor may see its data,
 * using aggregate counts rather than loading records. Widgets for later modules are added as
 * those modules land; nothing here is hard-coded.
 */
export async function getSummary(req) {
  const { auth } = req;
  const can = (p) => hasPermission(auth.permissions, p);
  const company = await getSettings();
  const widgets = {};

  if (can('users:read')) {
    const counts = await User.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    const byStatus = Object.fromEntries(counts.map((c) => [c._id, c.count]));
    widgets.userAccounts = {
      active: byStatus.active ?? 0,
      invited: byStatus.invited ?? 0,
      disabled: byStatus.disabled ?? 0,
    };
  }

  const today = todayIn(company.timezone);

  if (can('employees:read:all')) {
    const counts = await Employee.aggregate([{ $match: { archivedAt: null } }, { $group: { _id: '$lifecycleStatus', count: { $sum: 1 } } }]);
    const by = Object.fromEntries(counts.map((c) => [c._id, c.count]));
    const upcoming = await Employee.find(
      { archivedAt: null, lifecycleStatus: 'pre_joining', joiningDate: { $lte: parseDateOnly(addDays(today, 60)) } },
      { fullName: 1, employeeCode: 1, joiningDate: 1, department: 1 },
    )
      .sort({ joiningDate: 1 })
      .limit(5)
      .populate('department', 'name')
      .lean();
    widgets.headcount = { active: by.active ?? 0, preJoining: by.pre_joining ?? 0, noticePeriod: by.notice_period ?? 0 };
    widgets.upcomingJoiners = upcoming.map((e) => ({
      id: String(e._id),
      fullName: e.fullName,
      employeeCode: e.employeeCode,
      joiningDate: toDateOnly(e.joiningDate),
      department: e.department?.name ?? null,
    }));
  }

  if (can('onboarding:manage')) {
    const [row] = await OnboardingTask.aggregate([
      { $match: { kind: 'onboarding', status: 'pending' } },
      {
        $group: {
          _id: null,
          employees: { $addToSet: '$employee' },
          pendingHr: { $sum: { $cond: [{ $eq: ['$assigneeType', 'hr'] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $lt: ['$dueDate', parseDateOnly(today)] }, 1, 0] } },
        },
      },
    ]);
    widgets.onboarding = { employeesInProgress: row?.employees.length ?? 0, pendingHrTasks: row?.pendingHr ?? 0, overdueTasks: row?.overdue ?? 0 };
  }

  if (auth.user.employee) {
    widgets.myTasks = { pending: (await listMyTasks(req)).length };
  }

  if (can('attendance:read:all')) {
    const day = parseDateOnly(today);
    const [present, onLeave] = await Promise.all([
      AttendanceRecord.countDocuments({ date: day, checkIn: { $ne: null } }),
      LeaveRequest.countDocuments({ status: { $in: ['approved', 'cancellation_requested'] }, 'slots.date': day }),
    ]);
    widgets.attendanceToday = { present, onLeave };
  }

  const approvals = {};
  if (can('leave:manage') || can('leave:approve:team')) {
    approvals.leave = (await listRequests(req, { scope: 'approvals', page: 1, limit: 1 })).meta.total;
  }
  if (can('attendance:manage') || can('attendance:approve:team')) {
    approvals.attendanceCorrections = (await listCorrections(req, { scope: 'approvals', status: 'pending' })).length;
  }
  if (can('timesheets:manage') || can('timesheets:approve:team')) {
    approvals.timesheets = (await listTimesheets(req, { scope: 'approvals', page: 1, limit: 1 })).meta.total;
  }
  if (Object.keys(approvals).length) widgets.approvals = approvals;

  if (auth.user.employee && can('self:attendance')) {
    const mine = await getMyToday(req);
    widgets.myAttendance = { date: mine.date, checkIn: mine.record?.checkIn ?? null, checkOut: mine.record?.checkOut ?? null, day: mine.day, shift: mine.shift };
  }

  if (isRecruitmentStaff(req)) {
    const [openJobs, stages] = await Promise.all([
      JobOpening.countDocuments({ status: 'open' }),
      Application.aggregate([{ $match: { stage: { $in: ACTIVE_STAGES } } }, { $group: { _id: '$stage', count: { $sum: 1 } } }]),
    ]);
    const byStage = Object.fromEntries(stages.map((x) => [x._id, x.count]));
    widgets.recruitment = { openJobs, pipeline: Object.fromEntries(ACTIVE_STAGES.map((st) => [st, byStage[st] ?? 0])) };
    if (can('recruitment:offers:approve')) {
      widgets.recruitment.offersAwaitingApproval = await JobOffer.countDocuments({ status: 'pending_approval', preparedBy: { $ne: auth.user._id } });
    }
  }

  if (can('recruitment:interviews:feedback')) {
    const upcoming = await Interview.find({ interviewers: auth.user._id, status: 'scheduled', scheduledAt: { $gte: new Date(Date.now() - 2 * 3600_000) } })
      .sort({ scheduledAt: 1 })
      .limit(5)
      .populate('candidate', 'fullName')
      .populate('job', 'code title')
      .lean();
    const awaitingFeedback = await Interview.countDocuments({ interviewers: auth.user._id, status: 'scheduled', scheduledAt: { $lt: new Date() }, 'feedback.interviewer': { $ne: auth.user._id } });
    if (upcoming.length || awaitingFeedback) {
      widgets.myInterviews = {
        awaitingFeedback,
        upcoming: upcoming.map((i) => ({ id: String(i._id), title: i.title, scheduledAt: i.scheduledAt, candidate: i.candidate?.fullName, job: i.job ? `${i.job.code} ${i.job.title}` : null })),
      };
    }
  }

  if (['payroll:read', 'payroll:process', 'payroll:approve', 'payroll:finalize'].some(can)) {
    const month = today.slice(0, 7);
    const [current, waiting] = await Promise.all([
      PayrollRun.findOne({ type: 'regular', status: { $ne: 'cancelled' } }).sort({ month: -1 }).lean(),
      PayrollRun.find({ status: { $in: ['under_review', 'approved'] } }, { month: 1, type: 1, status: 1, preparedBy: 1, approvedBy: 1 }).lean(),
    ]);
    const me = String(auth.user._id);
    widgets.payroll = {
      latestRun: current ? { id: String(current._id), month: current.month, status: current.status, netPaise: current.totals.netPaise, employees: current.totals.employees } : null,
      currentMonth: month,
      awaitingMe: waiting.filter((r) => (r.status === 'under_review' && can('payroll:approve') && String(r.preparedBy) !== me) || (r.status === 'approved' && can('payroll:finalize') && String(r.preparedBy) !== me && String(r.approvedBy) !== me)).length,
    };
  }

  if (can('audit:read')) {
    const items = await AuditLog.find({}, { action: 1, summary: 1, actorName: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .limit(8)
      .lean();
    widgets.recentActivity = items.map((a) => ({
      id: String(a._id),
      action: a.action,
      summary: a.summary,
      actorName: a.actorName,
      createdAt: a.createdAt,
    }));
  }

  return {
    company: { displayName: company.displayName, timezone: company.timezone },
    user: { name: auth.user.name, lastLoginAt: auth.user.lastLoginAt },
    widgets,
  };
}
