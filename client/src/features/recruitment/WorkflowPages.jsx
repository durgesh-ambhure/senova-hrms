import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CalendarClock, Gift } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useInterviews, useJobs, useOffers } from './api.js';
import { FeedbackModal } from './RecruitmentModals.jsx';
import { PipelineBoard } from './PipelineBoard.jsx';
import { INTERVIEW_MODES, OFFER_STATUS, RECOMMENDATIONS } from '../../lib/labels.js';
import { formatDate, formatDateTime, formatINR } from '../../lib/format.js';
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, PageHeader, Select, TabPanel, Tabs } from '../../components/ui/index.js';

export function PipelinePage() {
  const jobs = useJobs({ status: 'open', page: 1, limit: 100 });
  const [params, setParams] = useSearchParams();
  const job = params.get('job') ?? '';
  return (
    <>
      <PageHeader title="Pipeline" description="Applications across open jobs, by stage." />
      <Card className="mb-4 p-4">
        <Select label="Job" value={job} onChange={(e) => setParams(e.target.value ? { job: e.target.value } : {})} className="max-w-md">
          <option value="">All jobs</option>
          {jobs.data?.data.map((j) => (
            <option key={j.id} value={j.id}>
              {j.code} · {j.title}
            </option>
          ))}
        </Select>
      </Card>
      <PipelineBoard key={job} jobId={job || undefined} />
    </>
  );
}

export function InterviewsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const staff = can('recruitment:interviews:manage') || can('recruitment:candidates:manage');
  const tabs = [{ value: 'mine', label: 'My interviews' }, ...(staff ? [{ value: 'all', label: 'All interviews' }] : [])];
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'mine';
  const q = useInterviews({ scope: tab });
  const [feedbackFor, setFeedbackFor] = useState(null);
  const now = new Date();
  const columns = [
    { key: 'when', header: 'When', className: 'whitespace-nowrap', render: (i) => formatDateTime(i.scheduledAt) },
    {
      key: 'candidate',
      header: 'Candidate',
      render: (i) => (
        <Link to={`/recruitment/candidates/${i.candidate.id}`} className="block">
          <span className="block font-medium text-slate-900 hover:text-brand-700">{i.candidate.fullName}</span>
          <span className="block text-xs text-slate-500">
            {i.job.code} · {i.job.title}
          </span>
        </Link>
      ),
    },
    { key: 'round', header: 'Round', render: (i) => `${i.title} · ${INTERVIEW_MODES[i.mode]}` },
    { key: 'panel', header: 'Panel', render: (i) => i.interviewers.map((u) => u.name).join(', ') },
    {
      key: 'feedback',
      header: 'Feedback',
      render: (i) =>
        i.feedback.length ? (
          <span>
            {i.feedbackSummary.averageRating}/5 · {Object.entries(i.feedbackSummary.recommendations).map(([k, n]) => `${n} ${RECOMMENDATIONS[k]}`).join(', ')}
          </span>
        ) : i.myFeedback ? (
          'Submitted'
        ) : (
          <span className="text-slate-400">{i.feedbackPending} pending</span>
        ),
    },
    { key: 'status', header: 'Status', render: (i) => <Badge tone={i.status === 'completed' ? 'success' : i.status === 'scheduled' ? 'brand' : 'neutral'}>{i.status.replace('_', ' ')}</Badge> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (i) =>
        i.isInterviewer && !['cancelled', 'no_show'].includes(i.status) && new Date(i.scheduledAt) <= now ? (
          <Button size="sm" variant={i.myFeedback ? 'ghost' : 'primary'} onClick={() => setFeedbackFor(i)}>
            {i.myFeedback ? 'Edit feedback' : 'Give feedback'}
          </Button>
        ) : null,
    },
  ];
  return (
    <>
      <PageHeader title="Interviews" description="Your interview schedule. Feedback opens once an interview starts." />
      <Tabs label="Interview sections" tabs={tabs} value={tab} onChange={(v) => setParams({ tab: v })} />
      <TabPanel value={tab}>
        <Card>
          <DataTable caption="Interviews" columns={columns} rows={q.data} isLoading={q.isLoading} error={q.error} onRetry={q.refetch} empty={<EmptyState icon={CalendarClock} title="No interviews" />} />
        </Card>
      </TabPanel>
      {feedbackFor && <FeedbackModal interview={feedbackFor} onClose={() => setFeedbackFor(null)} />}
    </>
  );
}

export function OffersPage() {
  const { can, user } = useAuth();
  const [status, setStatus] = useState(can('recruitment:offers:approve') && !can('recruitment:offers:manage') ? 'pending_approval' : '');
  const q = useOffers({ status: status || undefined });
  const columns = [
    {
      key: 'candidate',
      header: 'Candidate',
      render: (o) => (
        <Link to={`/recruitment/candidates/${o.candidate.id}`} className="block">
          <span className="block font-medium text-slate-900 hover:text-brand-700">{o.candidate.fullName}</span>
          <span className="block text-xs text-slate-500">
            {o.job.code} · {o.designation.title}
          </span>
        </Link>
      ),
    },
    { key: 'ctc', header: 'Annual CTC', className: 'whitespace-nowrap', render: (o) => formatINR(o.compensation.annualCtc) },
    { key: 'joining', header: 'Joining', className: 'whitespace-nowrap', render: (o) => formatDate(o.proposedJoiningDate) },
    { key: 'prepared', header: 'Prepared by', render: (o) => o.preparedByName },
    {
      key: 'status',
      header: 'Status',
      render: (o) => (
        <div>
          <Badge tone={OFFER_STATUS[o.status].tone}>{OFFER_STATUS[o.status].label}</Badge>
          {o.status === 'pending_approval' && o.preparedByName === user.name && <p className="mt-0.5 text-xs text-slate-500">Needs another approver</p>}
        </div>
      ),
    },
    { key: 'open', header: <span className="sr-only">Open</span>, className: 'text-right', render: (o) => <Link to={`/recruitment/candidates/${o.candidate.id}`} className="text-sm font-medium text-brand-700">Open</Link> },
  ];
  return (
    <>
      <PageHeader title="Offers" description="Compensation is confidential: only offer managers and approvers see this page." />
      <Card>
        <CardHeader
          title="All offers"
          actions={
            <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm">
              <option value="">All statuses</option>
              {Object.entries(OFFER_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          }
        />
        <DataTable caption="Offers" columns={columns} rows={q.data} isLoading={q.isLoading} error={q.error} onRetry={q.refetch} empty={<EmptyState icon={Gift} title="No offers" />} />
      </Card>
    </>
  );
}
