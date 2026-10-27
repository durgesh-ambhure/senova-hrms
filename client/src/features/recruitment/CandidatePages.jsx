import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, CalendarPlus, Download, FileText, Gift, MoreHorizontal, Search, Upload, UserPlus, UserCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { checkDuplicates, useActivity, useCandidate, useCandidateApplications, useCandidates, useInterviews, useJob, useJobs, useOffers, useRecruitmentMutations } from './api.js';
import { FeedbackModal, HireModal, MoveStageModal, OfferModal, ScheduleInterviewModal } from './RecruitmentModals.jsx';
import { applyFieldErrors, download } from '../../lib/api.js';
import { CANDIDATE_SOURCES, INTERVIEW_MODES, OFFER_STATUS, RECOMMENDATIONS, STAGES } from '../../lib/labels.js';
import { formatDate, formatDateTime, formatINR } from '../../lib/format.js';
import { useDebouncedValue } from '../../lib/useDebouncedValue.js';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, DataTable, EmptyState, ErrorState, Input, Menu, Modal, PageHeader, PageLoader, Pagination, Select, Textarea, useToast } from '../../components/ui/index.js';

const StageBadge = ({ stage }) => <Badge tone={STAGES[stage].tone}>{STAGES[stage].label}</Badge>;

const candidateSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(60),
  lastName: z.string().trim().min(1, 'Last name is required').max(60),
  email: z.string().trim().min(1, 'Email is required').pipe(z.email('Enter a valid email address')),
  phone: z.union([z.literal(''), z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number')]),
  currentTitle: z.string().trim().max(120),
  currentCompany: z.string().trim().max(120),
  experienceYears: z.coerce.number().min(0).max(60),
  location: z.string().trim().max(120),
  skills: z.string().max(2000),
  source: z.string(),
  noticePeriodDays: z.union([z.literal(''), z.coerce.number().int().min(0).max(365)]),
  expectedCtc: z.union([z.literal(''), z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Rupees, up to 2 decimals')]),
  linkedInUrl: z.union([z.literal(''), z.url('Enter a full URL')]),
});

function DuplicateList({ matches }) {
  return (
    <ul className="mt-2 space-y-1">
      {matches.map((m) => (
        <li key={m.id}>
          <Link to={`/recruitment/candidates/${m.id}`} className="font-medium underline">
            {m.fullName}
          </Link>{' '}
          <span className="text-xs">({m.matchedOn.join(' & ')} match: {m.email}{m.phone ? `, ${m.phone}` : ''})</span>
        </li>
      ))}
    </ul>
  );
}

export function CandidateFormModal({ candidate, jobId, onClose, onSaved }) {
  const toast = useToast();
  const { canAny } = useAuth();
  const { createCandidate, updateCandidate } = useRecruitmentMutations();
  const mutation = candidate ? updateCandidate : createCandidate;
  const job = useJob(jobId);
  const [matches, setMatches] = useState([]);
  const [confirmPhone, setConfirmPhone] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(candidateSchema),
    defaultValues: candidate
      ? { ...candidate, skills: candidate.skills.join(', '), noticePeriodDays: candidate.noticePeriodDays ?? '', expectedCtc: candidate.expectedCtc ?? '' }
      : { firstName: '', lastName: '', email: '', phone: '', currentTitle: '', currentCompany: '', experienceYears: 0, location: '', skills: '', source: 'linkedin', noticePeriodDays: '', expectedCtc: '', linkedInUrl: '' },
  });
  const check = async () => {
    const { email, phone } = getValues();
    if (!email && !phone) return;
    try {
      setMatches(await checkDuplicates({ email: email || undefined, phone: phone || undefined, excludeId: candidate?.id }));
    } catch {
      /* advisory only */
    }
  };
  const onSubmit = handleSubmit(async ({ skills, noticePeriodDays, expectedCtc, ...v }) => {
    const body = { ...v, skills: skills.split(',').map((s) => s.trim()).filter(Boolean), noticePeriodDays: noticePeriodDays === '' ? null : noticePeriodDays, allowPhoneDuplicate: confirmPhone };
    if (canAny('recruitment:offers:manage', 'recruitment:offers:approve', 'recruitment:hire')) body.expectedCtc = expectedCtc === '' ? null : expectedCtc;
    try {
      const saved = candidate ? await updateCandidate.mutateAsync({ id: candidate.id, ...body }) : await createCandidate.mutateAsync({ ...body, jobId });
      toast.success(candidate ? 'Candidate updated' : `${saved.fullName} added${jobId ? ' to the pipeline' : ''}`);
      onSaved(saved);
    } catch (err) {
      if (err.code === 'DUPLICATE_CANDIDATE') setMatches(err.details);
      else if (!applyFieldErrors(err, setError)) toast.error(err.message);
    }
  });
  const emailDup = matches.some((m) => m.matchedOn.includes('email'));
  const phoneOnly = matches.length > 0 && !emailDup;
  return (
    <Modal
      open
      onClose={onClose}
      title={candidate ? `Edit ${candidate.fullName}` : 'Add candidate'}
      description={job.data ? `Will be added to ${job.data.code} ${job.data.title}` : undefined}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="candidate-form" loading={mutation.isPending} disabled={emailDup || (phoneOnly && !confirmPhone)}>
            {candidate ? 'Save' : 'Add candidate'}
          </Button>
        </>
      }
    >
      <form id="candidate-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        {matches.length > 0 && (
          <div className="sm:col-span-2">
            <Alert tone={emailDup ? 'danger' : 'info'}>
              <span className="inline-flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {emailDup ? 'This candidate already exists' : 'Someone with this phone number already exists'}
              </span>
              <DuplicateList matches={matches} />
              {phoneOnly && <Checkbox className="mt-2" label="This is a different person — save anyway" checked={confirmPhone} onChange={(e) => setConfirmPhone(e.target.checked)} />}
            </Alert>
          </div>
        )}
        <Input label="First name" required error={errors.firstName?.message} {...register('firstName')} />
        <Input label="Last name" required error={errors.lastName?.message} {...register('lastName')} />
        <Input label="Email" type="email" required error={errors.email?.message} {...register('email', { onBlur: check })} />
        <Input label="Phone" type="tel" error={errors.phone?.message} {...register('phone', { onBlur: check })} />
        <Input label="Current title" {...register('currentTitle')} />
        <Input label="Current company" {...register('currentCompany')} />
        <Input label="Experience (years)" type="number" step="0.5" error={errors.experienceYears?.message} {...register('experienceYears')} />
        <Input label="Location" {...register('location')} />
        <Input label="Skills" className="sm:col-span-2" hint="Comma-separated" {...register('skills')} />
        <Select label="Source" {...register('source')}>
          {Object.entries(CANDIDATE_SOURCES).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Input label="Notice period (days)" type="number" error={errors.noticePeriodDays?.message} {...register('noticePeriodDays')} />
        {canAny('recruitment:offers:manage', 'recruitment:offers:approve', 'recruitment:hire') && <Input label="Expected CTC (₹ / year)" inputMode="decimal" hint="Confidential" error={errors.expectedCtc?.message} {...register('expectedCtc')} />}
        <Input label="LinkedIn URL" error={errors.linkedInUrl?.message} {...register('linkedInUrl')} />
      </form>
    </Modal>
  );
}

export function CandidatesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const addTo = params.get('addTo');
  const [adding, setAdding] = useState(Boolean(addTo));
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim());
  const [page, setPage] = useState(1);
  const [source, setSource] = useState('');
  const q = useCandidates({ search: debounced || undefined, source: source || undefined, page, limit: 20 });
  const columns = [
    {
      key: 'name',
      header: 'Candidate',
      render: (c) => (
        <Link to={`/recruitment/candidates/${c.id}`} className="block">
          <span className="block font-medium text-slate-900 hover:text-brand-700">{c.fullName}</span>
          <span className="block text-xs text-slate-500">{c.email}</span>
        </Link>
      ),
    },
    { key: 'current', header: 'Current role', render: (c) => [c.currentTitle, c.currentCompany].filter(Boolean).join(' · ') || '—' },
    { key: 'exp', header: 'Experience', render: (c) => `${c.experienceYears} yrs` },
    { key: 'skills', header: 'Skills', render: (c) => <span className="line-clamp-1">{c.skills.join(', ')}</span> },
    {
      key: 'apps',
      header: 'Applications',
      render: (c) => (
        <div className="flex flex-wrap gap-1">
          {c.applications.map((a) => (
            <Badge key={a.id} tone={STAGES[a.stage].tone}>
              {a.job.code}: {STAGES[a.stage].label}
            </Badge>
          ))}
          {!c.applications.length && <span className="text-slate-400">—</span>}
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Candidates"
        description="Everyone in your talent pool. Duplicates are detected by email and phone."
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlus className="h-4 w-4" aria-hidden="true" /> Add candidate
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input type="search" aria-label="Search candidates" placeholder="Search name, email, phone, company or skill" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="h-10 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm" />
          </div>
          <select aria-label="Filter by source" value={source} onChange={(e) => (setSource(e.target.value), setPage(1))} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm sm:w-48">
            <option value="">All sources</option>
            {Object.entries(CANDIDATE_SOURCES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <DataTable caption="Candidates" columns={columns} rows={q.data?.data} isLoading={q.isLoading} isFetching={q.isFetching} error={q.error} onRetry={q.refetch} empty={<EmptyState icon={UserPlus} title="No candidates found" />} />
        <Pagination meta={q.data?.meta} onPageChange={setPage} />
      </Card>
      {adding && (
        <CandidateFormModal
          jobId={addTo ?? undefined}
          onClose={() => (setAdding(false), addTo && setParams({}))}
          onSaved={(c) => navigate(`/recruitment/candidates/${c.id}`)}
        />
      )}
    </>
  );
}

// Profile

function FilesCard({ candidate, canManage }) {
  const toast = useToast();
  const { uploadFile } = useRecruitmentMutations();
  const input = useRef(null);
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error('Files must be 10 MB or smaller');
    const form = new FormData();
    form.append('kind', 'resume');
    form.append('file', file);
    try {
      await uploadFile.mutateAsync({ id: candidate.id, form });
      toast.success('Resume uploaded');
    } catch (err) {
      toast.error(err.details?.[0]?.message ?? err.message);
    }
  };
  return (
    <Card>
      <CardHeader
        title="Resume & files"
        actions={
          canManage && (
            <>
              <Button size="sm" variant="secondary" onClick={() => input.current?.click()} loading={uploadFile.isPending}>
                <Upload className="h-4 w-4" aria-hidden="true" /> Upload
              </Button>
              <input ref={input} type="file" accept=".pdf,.docx,.png,.jpg,.jpeg" className="sr-only" aria-label="Upload resume" onChange={onFile} />
            </>
          )
        }
      />
      {candidate.files.length === 0 ? (
        <EmptyState icon={FileText} title="No resume yet" description={canManage ? 'PDF, Word (.docx), JPEG or PNG up to 10 MB.' : undefined} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {candidate.files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <FileText className="h-5 w-5 text-slate-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{f.fileName}</p>
                <p className="text-xs text-slate-500">
                  {f.kind.replace('_', ' ')} · {formatDateTime(f.createdAt)}
                </p>
              </div>
              <Button size="sm" variant="ghost" aria-label={`Download ${f.fileName}`} onClick={() => download(`/recruitment/candidates/${candidate.id}/files/${f.id}`, f.fileName).catch((e) => toast.error(e.message))}>
                <Download className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OfferRow({ offer, application, job, onEdit, onHire }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const { offerAction } = useRecruitmentMutations();
  const [noteFor, setNoteFor] = useState(null);
  const [note, setNote] = useState('');
  const canManage = can('recruitment:offers:manage');
  const canApprove = can('recruitment:offers:approve') && offer.preparedByName !== user.name;
  const act = async (action, body = {}) => {
    try {
      await offerAction.mutateAsync({ id: offer.id, action, ...body });
      toast.success('Offer updated');
      setNoteFor(null);
      setNote('');
    } catch (err) {
      toast.error(err.details?.[0]?.message ?? err.message);
    }
  };
  const items = [
    { label: 'Edit', onSelect: onEdit, hidden: !canManage || !['draft', 'rejected'].includes(offer.status) },
    { label: 'Submit for approval', onSelect: () => act('submit'), hidden: !canManage || !['draft', 'rejected'].includes(offer.status) },
    { label: 'Approve', onSelect: () => act('approve'), hidden: !canApprove || offer.status !== 'pending_approval' },
    { label: 'Request changes…', onSelect: () => setNoteFor('reject'), hidden: !canApprove || offer.status !== 'pending_approval' },
    { label: 'Mark as sent', onSelect: () => act('send'), hidden: !canManage || offer.status !== 'approved' },
    { label: 'Candidate accepted', onSelect: () => act('accept'), hidden: !canManage || offer.status !== 'sent' },
    { label: 'Candidate declined…', onSelect: () => setNoteFor('decline'), hidden: !canManage || offer.status !== 'sent' },
    { label: 'Withdraw…', danger: true, onSelect: () => setNoteFor('withdraw'), hidden: !canManage || !['draft', 'pending_approval', 'approved', 'sent'].includes(offer.status) },
  ];
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
      <Gift className="h-5 w-5 text-slate-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-900">
          Offer v{offer.version} · {formatINR(offer.compensation.annualCtc)} CTC
        </p>
        <p className="text-xs text-slate-500">
          {offer.designation.title} · joining {formatDate(offer.proposedJoiningDate)} · prepared by {offer.preparedByName}
          {offer.approval?.decidedByName && ` · ${offer.status === 'rejected' ? 'changes requested' : 'approved'} by ${offer.approval.decidedByName}${offer.approval.note ? ` (“${offer.approval.note}”)` : ''}`}
        </p>
      </div>
      <Badge tone={OFFER_STATUS[offer.status].tone}>{OFFER_STATUS[offer.status].label}</Badge>
      {offer.status === 'accepted' && application.stage === 'hired' && !application.employee && can('recruitment:hire') && can('employees:manage') && (
        <Button size="sm" onClick={onHire}>
          <UserCheck className="h-4 w-4" aria-hidden="true" /> Convert to employee
        </Button>
      )}
      <Menu
        label={`Actions for offer v${offer.version}`}
        items={items}
        trigger={(props) => (
          <button type="button" className="rounded p-1.5 text-slate-500 hover:bg-slate-100" {...props}>
            <MoreHorizontal className="h-4 w-4" />
          </button>
        )}
      />
      {noteFor && (
        <Modal
          open
          onClose={() => setNoteFor(null)}
          title={{ reject: 'Request changes', decline: 'Candidate declined', withdraw: 'Withdraw offer' }[noteFor]}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setNoteFor(null)}>
                Cancel
              </Button>
              <Button variant={noteFor === 'reject' ? 'primary' : 'danger'} loading={offerAction.isPending} onClick={() => act(noteFor, { note })}>
                Confirm
              </Button>
            </>
          }
        >
          <Textarea label={noteFor === 'reject' ? 'What should change?' : 'Note'} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} data-autofocus />
          {job && noteFor !== 'reject' && <p className="mt-2 text-xs text-slate-500">The application returns to “Selected” so you can make a revised offer or reject.</p>}
        </Modal>
      )}
    </li>
  );
}

function ApplicationCard({ app, candidate, interviews, offers }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const job = useJob(app.job.id);
  const [dialog, setDialog] = useState(null);
  const appInterviews = interviews.filter((i) => i.application === app.id);
  const appOffers = offers.filter((o) => o.application === app.id);
  const openOffer = appOffers.some((o) => ['draft', 'pending_approval', 'approved', 'sent'].includes(o.status));
  const accepted = appOffers.find((o) => o.status === 'accepted');
  const full = { ...app, candidate: { fullName: candidate.fullName } };

  return (
    <Card>
      <CardHeader
        title={
          <Link to={`/recruitment/jobs/${app.job.id}`} className="hover:text-brand-700">
            {app.job.code} · {app.job.title}
          </Link>
        }
        description={`Applied ${formatDate(app.createdAt)} · in stage since ${formatDate(app.stageChangedAt)}`}
        actions={
          <>
            <StageBadge stage={app.stage} />
            {app.employee && (
              <Link to={`/employees/${app.employee}`} className="text-sm font-medium text-brand-700">
                Employee profile
              </Link>
            )}
            {can('recruitment:interviews:manage') && ['shortlisted', 'interview'].includes(app.stage) && (
              <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'schedule' })}>
                <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Schedule
              </Button>
            )}
            {can('recruitment:offers:manage') && ['selected', 'offer'].includes(app.stage) && !openOffer && (
              <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'offer' })}>
                <Gift className="h-4 w-4" aria-hidden="true" /> Prepare offer
              </Button>
            )}
            {can('recruitment:candidates:manage') && app.allowedMoves?.length > 0 && (
              <Menu
                label={`Move ${app.job.code}`}
                items={app.allowedMoves.map((to) => ({ label: to === 'rejected' ? 'Reject…' : `Move to ${STAGES[to].label}`, danger: to === 'rejected', onSelect: () => setDialog({ kind: 'move', to }) }))}
                trigger={(props) => (
                  <Button size="sm" variant="secondary" {...props}>
                    Move
                  </Button>
                )}
              />
            )}
          </>
        }
      />
      {app.rejectionReason && app.stage === 'rejected' && <p className="px-5 pt-3 text-sm text-red-700">Rejected: {app.rejectionReason}</p>}
      {appInterviews.length > 0 && (
        <ul className="divide-y divide-slate-100 border-b border-slate-100">
          {appInterviews.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">
                  {i.title} · {INTERVIEW_MODES[i.mode]}
                </p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(i.scheduledAt)} · {i.interviewers.map((u) => u.name).join(', ')}
                </p>
                {i.feedback.length > 0 && (
                  <p className="mt-1 text-xs text-slate-600">
                    Avg {i.feedbackSummary.averageRating}/5 · {i.feedback.map((f) => `${f.interviewerName}: ${RECOMMENDATIONS[f.recommendation]}`).join(' · ')}
                  </p>
                )}
              </div>
              <Badge tone={i.status === 'completed' ? 'success' : i.status === 'scheduled' ? 'brand' : 'neutral'}>{i.status.replace('_', ' ')}</Badge>
              {i.isInterviewer && i.status !== 'cancelled' && new Date(i.scheduledAt) <= new Date() && (
                <Button size="sm" onClick={() => setDialog({ kind: 'feedback', interview: i })}>
                  {i.myFeedback ? 'Edit feedback' : 'Give feedback'}
                </Button>
              )}
              {can('recruitment:interviews:manage') && i.status === 'scheduled' && (
                <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'reschedule', interview: i })}>
                  Reschedule
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {appOffers.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {appOffers.map((o) => (
            <OfferRow key={o.id} offer={o} application={app} job={job.data} onEdit={() => setDialog({ kind: 'offer', offer: o })} onHire={() => setDialog({ kind: 'hire', offer: o })} />
          ))}
        </ul>
      )}
      {dialog?.kind === 'move' && <MoveStageModal application={{ ...full, job: app.job }} to={dialog.to} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'schedule' && <ScheduleInterviewModal application={{ ...full, job: app.job }} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'reschedule' && <ScheduleInterviewModal interview={dialog.interview} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'feedback' && <FeedbackModal interview={dialog.interview} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'offer' && <OfferModal application={app} offer={dialog.offer} job={job.data} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'hire' && <HireModal application={app} offer={dialog.offer ?? accepted} job={job.data} onClose={() => setDialog(null)} onHired={(res) => navigate(`/employees/${res.employeeId}`)} />}
    </Card>
  );
}

function ActivityCard({ candidateId }) {
  const toast = useToast();
  const q = useActivity(candidateId, true);
  const { addNote } = useRecruitmentMutations();
  const [note, setNote] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    try {
      await addNote.mutateAsync({ id: candidateId, body: note.trim() });
      setNote('');
    } catch (err) {
      toast.error(err.message);
    }
  };
  return (
    <Card>
      <CardHeader title="Activity" />
      <form onSubmit={submit} className="flex gap-2 border-b border-slate-100 p-4">
        <input aria-label="Add a note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Add a note for the hiring team" className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm" />
        <Button type="submit" size="sm" disabled={!note.trim()} loading={addNote.isPending}>
          Add
        </Button>
      </form>
      {q.isLoading ? (
        <PageLoader />
      ) : (
        <ol className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
          {q.data?.map((a) => (
            <li key={a.id} className="px-5 py-3 text-sm">
              <p className="text-slate-800">{a.body}</p>
              <p className="text-xs text-slate-500">
                {a.type} · {a.actorName ?? 'System'} · {formatDateTime(a.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function AddToJobModal({ candidate, existingJobIds, onClose }) {
  const toast = useToast();
  const jobs = useJobs({ status: 'open', limit: 100, page: 1 });
  const { apply } = useRecruitmentMutations();
  const [jobId, setJobId] = useState('');
  const options = jobs.data?.data.filter((j) => !existingJobIds.includes(j.id)) ?? [];
  return (
    <Modal
      open
      onClose={onClose}
      title={`Add ${candidate.fullName} to a job`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!jobId} loading={apply.isPending} onClick={() => apply.mutateAsync({ candidateId: candidate.id, jobId }).then(() => (toast.success('Added to pipeline'), onClose()), (e) => toast.error(e.message))}>
            Add
          </Button>
        </>
      }
    >
      <Select label="Open job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
        <option value="">Choose…</option>
        {options.map((j) => (
          <option key={j.id} value={j.id}>
            {j.code} · {j.title}
          </option>
        ))}
      </Select>
    </Modal>
  );
}

export function CandidateProfilePage() {
  const { id } = useParams();
  const { can, canAny } = useAuth();
  const c = useCandidate(id);
  const apps = useCandidateApplications(id);
  const interviews = useInterviews({ scope: 'all', candidate: id });
  const offers = useOffers({ candidate: id }, canAny('recruitment:offers:manage', 'recruitment:offers:approve', 'recruitment:hire'));
  const [dialog, setDialog] = useState(null);
  if (c.isLoading) return <PageLoader label="Loading candidate" />;
  if (c.error) return <ErrorState error={c.error} title={c.error.status === 404 ? 'Candidate not found' : undefined} />;
  const cand = c.data;
  const full = cand.accessLevel === 'full';
  const isRecruiter = can('recruitment:candidates:manage');

  return (
    <>
      <PageHeader
        title={cand.fullName}
        description={[cand.currentTitle, cand.currentCompany, cand.location].filter(Boolean).join(' · ') || undefined}
        actions={
          isRecruiter && (
            <>
              <Button variant="secondary" onClick={() => setDialog('edit')}>
                Edit
              </Button>
              {!cand.employee && <Button onClick={() => setDialog('add')}>Add to job</Button>}
            </>
          )
        }
      />
      {!full && (
        <div className="mb-6">
          <Alert tone="info">You see this candidate as an interviewer or hiring manager. Contact details and compensation are hidden.</Alert>
        </div>
      )}
      {cand.employee && (
        <div className="mb-6">
          <Alert tone="success">
            Hired —{' '}
            <Link to={`/employees/${cand.employee}`} className="font-medium underline">
              open the employee profile
            </Link>
            .
          </Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Profile" />
            <dl className="space-y-3 p-5 text-sm">
              {full && (
                <>
                  <div>
                    <dt className="text-xs text-slate-500">Email</dt>
                    <dd className="text-slate-900">{cand.email}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Phone</dt>
                    <dd className="text-slate-900">{cand.phone || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Source</dt>
                    <dd className="text-slate-900">{CANDIDATE_SOURCES[cand.source]}</dd>
                  </div>
                </>
              )}
              <div>
                <dt className="text-xs text-slate-500">Experience</dt>
                <dd className="text-slate-900">{cand.experienceYears} years</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Notice period</dt>
                <dd className="text-slate-900">{cand.noticePeriodDays !== null && cand.noticePeriodDays !== undefined ? `${cand.noticePeriodDays} days` : '—'}</dd>
              </div>
              {'expectedCtc' in cand && (
                <div>
                  <dt className="text-xs text-slate-500">Expected CTC (confidential)</dt>
                  <dd className="text-slate-900">{formatINR(cand.expectedCtc)}</dd>
                </div>
              )}
              <div>
                <dt className="mb-1 text-xs text-slate-500">Skills</dt>
                <dd className="flex flex-wrap gap-1">
                  {cand.skills.map((s) => (
                    <Badge key={s}>{s}</Badge>
                  ))}
                </dd>
              </div>
            </dl>
          </Card>
          <FilesCard candidate={cand} canManage={isRecruiter} />
        </div>
        <div className="space-y-6 lg:col-span-2">
          {apps.isLoading ? (
            <PageLoader />
          ) : apps.data?.items.length === 0 ? (
            <Card>
              <EmptyState title="Not in any pipeline" description={isRecruiter ? 'Use “Add to job” to start.' : undefined} />
            </Card>
          ) : (
            apps.data?.items.map((a) => <ApplicationCard key={a.id} app={a} candidate={cand} interviews={interviews.data ?? []} offers={offers.data ?? []} />)
          )}
          {full && <ActivityCard candidateId={id} />}
        </div>
      </div>
      {dialog === 'edit' && <CandidateFormModal candidate={cand} onClose={() => setDialog(null)} onSaved={() => setDialog(null)} />}
      {dialog === 'add' && <AddToJobModal candidate={cand} existingJobIds={apps.data?.items.map((a) => a.job.id) ?? []} onClose={() => setDialog(null)} />}
    </>
  );
}

