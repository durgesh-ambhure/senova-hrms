import { Link } from 'react-router';
import { Activity, Banknote, CalendarClock, CheckSquare, ClipboardList, Clock, DoorOpen, KeyRound, MailCheck, Palmtree, UserCheck, UserX, UsersRound } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useDashboard } from '../settings/api.js';
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageLoader } from '../../components/ui/index.js';
import { formatDate, formatDateTime, formatINR, formatMonth, formatTime } from '../../lib/format.js';
import { RUN_STATUS } from '../../lib/labels.js';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function StatTile({ icon: Icon, label, value, tone, to }) {
  const body = (
    <div className="flex items-center gap-4 p-5">
      <div className={`rounded-lg p-2.5 ${tone}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm text-slate-500">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      </div>
    </div>
  );
  return <Card className="transition-shadow hover:shadow-md">{to ? <Link to={to}>{body}</Link> : body}</Card>;
}

export function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useDashboard();

  if (isLoading) return <PageLoader label="Loading dashboard" />;
  if (error) return <ErrorState error={error} onRetry={refetch} title="Could not load the dashboard" />;

  const { userAccounts, recentActivity, headcount, upcomingJoiners, onboarding, myTasks, myAttendance, attendanceToday, approvals, recruitment, myInterviews, payroll } = data.widgets;
  const approvalItems = approvals
    ? [
        approvals.leave !== undefined && {
          label: 'Leave requests',
          count: approvals.leave,
          to: '/leave/requests?tab=approvals',
        },
        approvals.attendanceCorrections !== undefined && {
          label: 'Attendance corrections',
          count: approvals.attendanceCorrections,
          to: '/attendance?tab=approvals',
        },
        approvals.timesheets !== undefined && {
          label: 'Timesheets',
          count: approvals.timesheets,
          to: '/timesheets?tab=approvals',
        },
      ].filter(Boolean)
    : [];
  const firstName = user.name.split(' ')[0];

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-brand-900 px-6 py-7 text-white sm:px-8">
        <div aria-hidden="true" className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-accent-500/25 blur-3xl" />
        <p className="relative text-sm text-brand-200">{data.company.displayName}</p>
        <h1 className="relative mt-1 text-2xl font-semibold tracking-tight">
          {greeting()}, {firstName}
        </h1>
        <p className="relative mt-1 text-sm text-brand-100">{data.user.lastLoginAt ? `Signed in ${formatDateTime(data.user.lastLoginAt)}` : 'Welcome to Senova HRMS.'}</p>
      </div>

      {(myAttendance || approvalItems.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-3">
          {myAttendance && (
            <Card className={approvalItems.length ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="flex items-center gap-4">
                  <div className="rounded-lg bg-accent-50 p-2.5 text-accent-700">
                    <Clock className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">
                      Today · {myAttendance.shift.name} {myAttendance.shift.startTime}–{myAttendance.shift.endTime}
                    </p>
                    <p className="font-semibold text-slate-900">
                      {myAttendance.checkOut
                        ? `Checked out at ${formatTime(myAttendance.checkOut)}`
                        : myAttendance.checkIn
                          ? `Checked in at ${formatTime(myAttendance.checkIn)}`
                          : myAttendance.day?.holiday
                            ? `Holiday — ${myAttendance.day.holiday.name}`
                            : myAttendance.day?.weeklyOff
                              ? 'Weekly off'
                              : 'Not checked in yet'}
                    </p>
                  </div>
                </div>
                <Link to="/attendance" className="text-sm font-medium text-brand-700 hover:text-brand-900">
                  {myAttendance.checkIn && !myAttendance.checkOut ? 'Check out' : myAttendance.checkIn ? 'View attendance' : 'Check in'}
                </Link>
              </div>
            </Card>
          )}
          {approvalItems.length > 0 && (
            <Card>
              <CardHeader title="Waiting for your approval" />
              <ul className="divide-y divide-slate-100">
                {approvalItems.map((a) => (
                  <li key={a.label}>
                    <Link to={a.to} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-slate-50">
                      <span className="flex items-center gap-2 text-slate-700">
                        <CheckSquare className="h-4 w-4 text-brand-600" aria-hidden="true" />
                        {a.label}
                      </span>
                      <span className={`font-semibold tabular-nums ${a.count ? 'text-amber-700' : 'text-slate-400'}`}>{a.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {payroll && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-4">
              <div className="rounded-lg bg-brand-50 p-2.5 text-brand-700">
                <Banknote className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Payroll</p>
                {payroll.latestRun ? (
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                    {formatMonth(payroll.latestRun.month)} <Badge tone={RUN_STATUS[payroll.latestRun.status].tone}>{RUN_STATUS[payroll.latestRun.status].label}</Badge>
                    {payroll.latestRun.employees > 0 && (
                      <span className="text-sm font-normal text-slate-600">
                        {payroll.latestRun.employees} employees · net {formatINR(payroll.latestRun.netPaise / 100)}
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="font-semibold text-slate-900">No payroll run yet</p>
                )}
                {payroll.awaitingMe > 0 && <p className="text-sm text-amber-700">{payroll.awaitingMe} run(s) waiting for you</p>}
              </div>
            </div>
            <Link to={payroll.latestRun ? `/payroll/runs/${payroll.latestRun.id}` : '/payroll/runs'} className="text-sm font-medium text-brand-700 hover:text-brand-900">
              Open payroll
            </Link>
          </div>
        </Card>
      )}

      {(recruitment || myInterviews) && (
        <div className="grid gap-6 lg:grid-cols-3">
          {recruitment && (
            <Card className={myInterviews ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <CardHeader
                title="Hiring"
                description={`${recruitment.openJobs} open job${recruitment.openJobs === 1 ? '' : 's'}${recruitment.offersAwaitingApproval ? ` · ${recruitment.offersAwaitingApproval} offer(s) awaiting your approval` : ''}`}
                actions={
                  <Link to="/recruitment/applications" className="text-sm font-medium text-brand-700 hover:text-brand-900">
                    Open pipeline
                  </Link>
                }
              />
              <dl className="grid grid-cols-3 gap-4 p-5 sm:grid-cols-6">
                {Object.entries(recruitment.pipeline).map(([stage, count]) => (
                  <div key={stage}>
                    <dt className="text-xs capitalize text-slate-500">{stage}</dt>
                    <dd className="text-xl font-semibold tabular-nums text-slate-900">{count}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
          {myInterviews && (
            <Card>
              <CardHeader
                title="My interviews"
                description={myInterviews.awaitingFeedback ? `${myInterviews.awaitingFeedback} waiting for your feedback` : undefined}
                actions={
                  <Link to="/recruitment/interviews" className="text-sm font-medium text-brand-700">
                    All
                  </Link>
                }
              />
              <ul className="divide-y divide-slate-100">
                {myInterviews.upcoming.map((i) => (
                  <li key={i.id} className="px-5 py-3 text-sm">
                    <p className="font-medium text-slate-900">{i.candidate}</p>
                    <p className="text-xs text-slate-500">
                      {i.title} · {formatDateTime(i.scheduledAt)}
                    </p>
                  </li>
                ))}
                {!myInterviews.upcoming.length && <li className="px-5 py-3 text-sm text-slate-500">Nothing scheduled</li>}
              </ul>
            </Card>
          )}
        </div>
      )}

      {attendanceToday && (
        <section aria-label="Attendance today" className="grid gap-4 sm:grid-cols-2">
          <StatTile icon={Clock} label="Checked in today" value={attendanceToday.present} tone="bg-emerald-50 text-emerald-700" to="/attendance?tab=team" />
          <StatTile icon={Palmtree} label="On leave today" value={attendanceToday.onLeave} tone="bg-brand-50 text-brand-700" to="/attendance?tab=team" />
        </section>
      )}

      {(headcount || onboarding || myTasks) && (
        <section aria-label="People" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {headcount && <StatTile icon={UsersRound} label="Active employees" value={headcount.active} tone="bg-brand-50 text-brand-700" to="/employees?status=active" />}
          {headcount && <StatTile icon={CalendarClock} label="Joining soon" value={headcount.preJoining} tone="bg-accent-50 text-accent-700" to="/employees?status=pre_joining" />}
          {headcount && <StatTile icon={DoorOpen} label="On notice" value={headcount.noticePeriod} tone="bg-amber-50 text-amber-700" to="/employees?status=notice_period" />}
          {onboarding && <StatTile icon={ClipboardList} label="Onboarding in progress" value={onboarding.employeesInProgress} tone="bg-slate-100 text-slate-700" to="/onboarding?tab=progress" />}
          {myTasks && !onboarding && <StatTile icon={ClipboardList} label="Tasks waiting on you" value={myTasks.pending} tone="bg-accent-50 text-accent-700" to="/onboarding?tab=mine" />}
        </section>
      )}

      {(upcomingJoiners || onboarding) && (
        <div className="grid gap-6 lg:grid-cols-3">
          {upcomingJoiners && (
            <Card className={onboarding ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <CardHeader title="Upcoming joiners" description="Pre-joining employees in the next 60 days." />
              {upcomingJoiners.length ? (
                <ul className="divide-y divide-slate-100">
                  {upcomingJoiners.map((j) => (
                    <li key={j.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <Link to={`/employees/${j.id}`} className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900 hover:text-brand-700">{j.fullName}</p>
                        <p className="text-xs text-slate-500">
                          {j.employeeCode} · {j.department}
                        </p>
                      </Link>
                      <span className="shrink-0 text-sm text-slate-600">{formatDate(j.joiningDate)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No one joining soon" />
              )}
            </Card>
          )}
          {onboarding && (
            <Card>
              <CardHeader title="Onboarding" />
              <dl className="space-y-3 p-5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-600">Open HR tasks</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">{onboarding.pendingHrTasks}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-600">Overdue tasks</dt>
                  <dd className={`font-semibold tabular-nums ${onboarding.overdueTasks ? 'text-red-600' : 'text-slate-900'}`}>{onboarding.overdueTasks}</dd>
                </div>
                {myTasks && (
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Waiting on you</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">{myTasks.pending}</dd>
                  </div>
                )}
                <Link to="/onboarding?tab=progress" className="inline-block pt-1 font-medium text-brand-700 hover:text-brand-900">
                  View progress
                </Link>
              </dl>
            </Card>
          )}
        </div>
      )}

      {userAccounts && (
        <section aria-label="User accounts" className="grid gap-4 sm:grid-cols-3">
          <StatTile icon={UserCheck} label="Active accounts" value={userAccounts.active} tone="bg-emerald-50 text-emerald-700" to="/settings/users?status=active" />
          <StatTile icon={MailCheck} label="Pending invitations" value={userAccounts.invited} tone="bg-amber-50 text-amber-700" to="/settings/users?status=invited" />
          <StatTile icon={UserX} label="Disabled accounts" value={userAccounts.disabled} tone="bg-slate-100 text-slate-600" to="/settings/users?status=disabled" />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {recentActivity && (
          <Card className="lg:col-span-2">
            <CardHeader
              title="Recent activity"
              description="Latest audited actions across the system."
              actions={
                <Link to="/settings/audit-log" className="text-sm font-medium text-brand-700 hover:text-brand-900">
                  View all
                </Link>
              }
            />
            {recentActivity.length ? (
              <ul className="divide-y divide-slate-100">
                {recentActivity.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                    <Activity className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-800">{a.summary}</p>
                      <p className="text-xs text-slate-500">
                        {a.actorName ?? 'System'} · {formatDateTime(a.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No activity yet" />
            )}
          </Card>
        )}

        <Card className={recentActivity ? '' : 'lg:col-span-3'}>
          <CardHeader title="Your account" />
          <div className="space-y-3 p-5 text-sm">
            <p className="text-slate-600">
              Signed in as <span className="font-medium text-slate-900">{user.email}</span>
            </p>
            <Link to="/account/security" className="inline-flex items-center gap-2 font-medium text-brand-700 hover:text-brand-900">
              <KeyRound className="h-4 w-4" aria-hidden="true" /> Change password
            </Link>
          </div>
        </Card>
      </div>

      {!userAccounts && !recentActivity && !headcount && !myTasks && !myAttendance && (
        <Card>
          <EmptyState title="Your workspace is being set up" description="Attendance, leave, timesheets and payslips will appear here as those modules are rolled out." />
        </Card>
      )}
    </div>
  );
}
