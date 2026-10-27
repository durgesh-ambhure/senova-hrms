import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X } from 'lucide-react';
import { useInterviewers, useRecruitmentMutations } from './api.js';
import { useDepartments, useDesignations } from '../employees/api.js';
import { useShifts } from '../time/api.js';
import { EmployeePicker } from '../employees/EmployeePicker.jsx';
import { applyFieldErrors } from '../../lib/api.js';
import { EMPLOYMENT_TYPES, INTERVIEW_MODES, RECOMMENDATIONS, STAGES } from '../../lib/labels.js';
import { addDaysTo, localToday } from '../../lib/format.js';
import { useDebouncedValue } from '../../lib/useDebouncedValue.js';
import { Alert, Button, Input, Modal, Select, Textarea, useToast } from '../../components/ui/index.js';

const footer = (onClose, formId, loading, label) => (
  <>
    <Button variant="secondary" onClick={onClose}>
      Cancel
    </Button>
    <Button type="submit" form={formId} loading={loading}>
      {label}
    </Button>
  </>
);

/** Move an application to another stage. `to` is preselected; rejection asks for a reason. */
export function MoveStageModal({ application, to, onClose }) {
  const toast = useToast();
  const { move } = useRecruitmentMutations();
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const rejecting = to === 'rejected';
  const submit = async (e) => {
    e.preventDefault();
    if (rejecting && note.trim().length < 3) return setError('Give a reason for rejecting');
    try {
      await move.mutateAsync({ id: application.id, to, ...(rejecting ? { reason: note.trim() } : { note: note.trim() }) });
      toast.success(`Moved to ${STAGES[to].label}`);
      onClose();
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    }
  };
  return (
    <Modal open onClose={onClose} title={`${rejecting ? 'Reject' : 'Move to'} ${rejecting ? '' : STAGES[to].label}`.trim()} description={`${application.candidate.fullName ?? ''} · ${application.job.code ?? ''} ${application.job.title ?? ''}`} size="sm" footer={footer(onClose, 'move-form', move.isPending, rejecting ? 'Reject candidate' : 'Move')}>
      <form id="move-form" onSubmit={submit} noValidate>
        <Textarea label={rejecting ? 'Reason (shared internally, not with the candidate)' : 'Note (optional)'} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} error={error} data-autofocus />
      </form>
    </Modal>
  );
}

// Interview scheduling

function InterviewerPicker({ value, onChange, error }) {
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term.trim(), 250);
  const q = useInterviewers(search);
  const options = (q.data ?? []).filter((u) => !value.some((v) => v.id === u.id));
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-slate-700">Interviewers</span>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {value.map((u) => (
          <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800">
            {u.name}
            <button type="button" onClick={() => onChange(value.filter((v) => v.id !== u.id))} aria-label={`Remove ${u.name}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        aria-label="Search interviewers"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search people who can interview"
        className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
      {term && (
        <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-200 bg-white" role="listbox" aria-label="Interviewer results">
          {options.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No matches</li>}
          {options.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  onChange([...value, u]);
                  setTerm('');
                }}
              >
                {u.name} <span className="text-xs text-slate-500">{u.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}

const scheduleSchema = z.object({
  title: z.string().trim().min(2, 'Give the round a name').max(120),
  mode: z.enum(['in_person', 'video', 'phone']),
  date: z.iso.date('Choose a date'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Choose a time'),
  durationMinutes: z.coerce.number().int().min(15).max(480),
  location: z.string().trim().max(300),
  interviewers: z.array(z.object({ id: z.string(), name: z.string() })).min(1, 'Add at least one interviewer'),
});

export function ScheduleInterviewModal({ application, interview, onClose }) {
  const toast = useToast();
  const { schedule, updateInterview } = useRecruitmentMutations();
  const mutation = interview ? updateInterview : schedule;
  const local = interview ? new Date(interview.scheduledAt) : null;
  const pad = (n) => String(n).padStart(2, '0');
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(scheduleSchema),
    defaultValues: interview
      ? { title: interview.title, mode: interview.mode, date: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`, time: `${pad(local.getHours())}:${pad(local.getMinutes())}`, durationMinutes: interview.durationMinutes, location: interview.location, interviewers: interview.interviewers }
      : { title: 'Technical round', mode: 'video', date: addDaysTo(localToday(), 2), time: '11:00', durationMinutes: 60, location: '', interviewers: [] },
  });
  const onSubmit = handleSubmit(async ({ date, time, interviewers, ...v }) => {
    // The browser's local time; the API stores the instant and the scheduler's time zone.
    const scheduledAt = new Date(`${date}T${time}:00`).toISOString();
    const body = { ...v, scheduledAt, interviewerIds: interviewers.map((u) => u.id), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    try {
      if (interview) {
        delete body.timezone;
        await updateInterview.mutateAsync({ id: interview.id, ...body });
      } else await schedule.mutateAsync({ applicationId: application.id, ...body });
      toast.success(interview ? 'Interview updated' : 'Interview scheduled');
      onClose();
    } catch (err) {
      const fieldMap = { interviewerIds: 'interviewers', scheduledAt: 'date' };
      if (Array.isArray(err.details)) err.details.forEach((d) => setError(fieldMap[d.path] ?? d.path, { message: d.message }));
      else toast.error(err.message);
    }
  });
  return (
    <Modal open onClose={onClose} title={interview ? 'Reschedule interview' : 'Schedule interview'} description={application ? `${application.candidate.fullName} · ${application.job.code}` : interview?.candidate.fullName} size="lg" footer={footer(onClose, 'schedule-form', mutation.isPending, interview ? 'Save' : 'Schedule')}>
      <form id="schedule-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Round" required error={errors.title?.message} {...register('title')} />
        <Select label="Mode" {...register('mode')}>
          {Object.entries(INTERVIEW_MODES).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Input label="Date" type="date" min={localToday()} error={errors.date?.message} {...register('date')} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start (your time)" type="time" error={errors.time?.message} {...register('time')} />
          <Input label="Minutes" type="number" step="15" error={errors.durationMinutes?.message} {...register('durationMinutes')} />
        </div>
        <Input label="Location or meeting link" className="sm:col-span-2" {...register('location')} />
        <div className="sm:col-span-2">
          <Controller control={control} name="interviewers" render={({ field }) => <InterviewerPicker value={field.value} onChange={field.onChange} error={errors.interviewers?.message} />} />
        </div>
      </form>
    </Modal>
  );
}

// Feedback

const feedbackSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Rate 1–5').max(5),
  recommendation: z.enum(['strong_yes', 'yes', 'no', 'strong_no'], { message: 'Choose a recommendation' }),
  strengths: z.string().trim().max(2000),
  concerns: z.string().trim().max(2000),
  notes: z.string().trim().max(4000),
});

export function FeedbackModal({ interview, onClose }) {
  const toast = useToast();
  const { feedback } = useRecruitmentMutations();
  const mine = interview.myFeedback;
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(feedbackSchema), defaultValues: { rating: mine?.rating ?? '', recommendation: mine?.recommendation ?? '', strengths: mine?.strengths ?? '', concerns: mine?.concerns ?? '', notes: mine?.notes ?? '' } });
  const onSubmit = handleSubmit(async (v) => {
    try {
      await feedback.mutateAsync({ id: interview.id, ...v });
      toast.success('Feedback submitted');
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
  });
  return (
    <Modal open onClose={onClose} title={`Feedback: ${interview.title}`} description={`${interview.candidate.fullName} · ${interview.job.code} ${interview.job.title}`} size="lg" footer={footer(onClose, 'feedback-form', feedback.isPending, mine ? 'Update feedback' : 'Submit feedback')}>
      <form id="feedback-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Select label="Overall rating" required error={errors.rating?.message} {...register('rating')}>
          <option value="">Choose…</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} — {['', 'Poor', 'Below bar', 'Meets bar', 'Strong', 'Exceptional'][n]}
            </option>
          ))}
        </Select>
        <Select label="Recommendation" required error={errors.recommendation?.message} {...register('recommendation')}>
          <option value="">Choose…</option>
          {Object.entries(RECOMMENDATIONS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Textarea label="Strengths" className="sm:col-span-2" {...register('strengths')} />
        <Textarea label="Concerns" className="sm:col-span-2" {...register('concerns')} />
        <Textarea label="Other notes" className="sm:col-span-2" {...register('notes')} />
        <p className="text-xs text-slate-500 sm:col-span-2">You'll see other interviewers' feedback after submitting yours.</p>
      </form>
    </Modal>
  );
}

// Offers

const money = z.union([z.literal(''), z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Rupees, up to 2 decimals')]);
const offerSchema = z
  .object({
    departmentId: z.string().min(1, 'Choose a department'),
    designationId: z.string().min(1, 'Choose a designation'),
    employmentType: z.string().min(1),
    workLocation: z.string().trim().max(120),
    proposedJoiningDate: z.iso.date('Choose a joining date'),
    probationMonths: z.coerce.number().int().min(0).max(24),
    expiresOn: z.union([z.literal(''), z.iso.date()]),
    annualCtc: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter the annual CTC in rupees'),
    fixed: money,
    variable: money,
    joiningBonus: money,
    notes: z.string().trim().max(1000),
  })
  .refine((v) => Number(v.fixed || 0) + Number(v.variable || 0) <= Number(v.annualCtc), { path: ['fixed'], message: 'Fixed + variable cannot exceed the annual CTC' });

export function OfferModal({ application, offer, job, onClose }) {
  const toast = useToast();
  const { createOffer, updateOffer } = useRecruitmentMutations();
  const departments = useDepartments();
  const designations = useDesignations();
  const mutation = offer ? updateOffer : createOffer;
  const s = (v) => (v === null || v === undefined || v === 0 ? '' : String(v));
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(offerSchema) });
  useEffect(() => {
    reset(
      offer
        ? { departmentId: offer.department.id, designationId: offer.designation.id, employmentType: offer.employmentType, workLocation: offer.workLocation, proposedJoiningDate: offer.proposedJoiningDate, probationMonths: offer.probationMonths, expiresOn: offer.expiresOn ?? '', annualCtc: s(offer.compensation.annualCtc), fixed: s(offer.compensation.fixed), variable: s(offer.compensation.variable), joiningBonus: s(offer.compensation.joiningBonus), notes: offer.compensation.notes }
        : { departmentId: job?.department?.id ?? '', designationId: job?.designation?.id ?? '', employmentType: job?.employmentType ?? 'full_time', workLocation: job?.workLocation ?? '', proposedJoiningDate: addDaysTo(localToday(), 30), probationMonths: 6, expiresOn: addDaysTo(localToday(), 7), annualCtc: '', fixed: '', variable: '', joiningBonus: '', notes: '' },
    );
  }, [offer, job, reset]);
  const onSubmit = handleSubmit(async ({ annualCtc, fixed, variable, joiningBonus, notes, expiresOn, ...v }) => {
    const body = { ...v, expiresOn: expiresOn || null, compensation: { annualCtc, fixed: fixed || '0', variable: variable || '0', joiningBonus: joiningBonus || '0', notes } };
    try {
      if (offer) await updateOffer.mutateAsync({ id: offer.id, ...body });
      else await createOffer.mutateAsync({ applicationId: application.id, ...body });
      toast.success(offer ? 'Offer updated' : 'Offer drafted. Submit it for approval when ready.');
      onClose();
    } catch (err) {
      if (!applyFieldErrors(err, setError)) toast.error(err.message);
    }
  });
  return (
    <Modal open onClose={onClose} title={offer ? `Edit offer v${offer.version}` : 'Prepare offer'} description="Amounts are annual, in rupees. The detailed salary structure is set up in payroll." size="lg" footer={footer(onClose, 'offer-form', mutation.isPending, offer ? 'Save offer' : 'Save draft')}>
      <form id="offer-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Select label="Department" error={errors.departmentId?.message} {...register('departmentId')}>
          <option value="">Choose…</option>
          {departments.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select label="Designation" error={errors.designationId?.message} {...register('designationId')}>
          <option value="">Choose…</option>
          {designations.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </Select>
        <Select label="Employment type" {...register('employmentType')}>
          {Object.entries(EMPLOYMENT_TYPES).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Input label="Work location" {...register('workLocation')} />
        <Input label="Proposed joining date" type="date" min={localToday()} error={errors.proposedJoiningDate?.message} {...register('proposedJoiningDate')} />
        <Input label="Probation (months)" type="number" error={errors.probationMonths?.message} {...register('probationMonths')} />
        <Input label="Annual CTC (₹)" inputMode="decimal" required error={errors.annualCtc?.message} {...register('annualCtc')} />
        <Input label="Offer expires on" type="date" {...register('expiresOn')} />
        <Input label="Fixed pay (₹ / year)" inputMode="decimal" error={errors.fixed?.message} {...register('fixed')} />
        <Input label="Variable pay (₹ / year)" inputMode="decimal" error={errors.variable?.message} {...register('variable')} />
        <Input label="Joining bonus (₹)" inputMode="decimal" error={errors.joiningBonus?.message} {...register('joiningBonus')} />
        <Textarea label="Notes" className="sm:col-span-2" rows={2} {...register('notes')} />
      </form>
    </Modal>
  );
}

// Hiring

const hireSchema = z.object({
  workEmail: z.string().trim().min(1, 'Work email is required').pipe(z.email('Enter a valid email')),
  joiningDate: z.iso.date('Choose the joining date'),
  shiftId: z.string(),
  manager: z.object({ id: z.string(), fullName: z.string() }).nullable(),
});

export function HireModal({ application, offer, job, onClose, onHired }) {
  const toast = useToast();
  const { hire } = useRecruitmentMutations();
  const shifts = useShifts();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(hireSchema), defaultValues: { workEmail: '', joiningDate: offer?.proposedJoiningDate ?? '', shiftId: '', manager: job?.hiringManager ?? null } });
  const onSubmit = handleSubmit(async ({ manager, shiftId, ...v }) => {
    try {
      const res = await hire.mutateAsync({ applicationId: application.id, ...v, reportingManagerId: manager?.id ?? null, shiftId: shiftId || null });
      toast.success(`Created employee ${res.employeeCode}${res.jobFilled ? ' · job marked filled' : ''}`);
      onHired(res);
    } catch (err) {
      if (!applyFieldErrors(err, setError, ['workEmail', 'joiningDate'])) toast.error(err.message);
    }
  });
  return (
    <Modal open onClose={onClose} title="Convert to employee" description="Creates the employee record from the accepted offer. The candidate's history is kept and linked." size="lg" footer={footer(onClose, 'hire-form', hire.isPending, 'Create employee')}>
      <form id="hire-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Alert tone="info">
          Department, designation, type, location and probation come from offer v{offer?.version}. Personal email and phone come from the candidate profile.
        </Alert>
        <div />
        <Input label="Work email" type="email" required error={errors.workEmail?.message} {...register('workEmail')} />
        <Input label="Joining date" type="date" error={errors.joiningDate?.message} {...register('joiningDate')} />
        <Controller control={control} name="manager" render={({ field }) => <EmployeePicker label="Reporting manager" value={field.value} onChange={field.onChange} hint="Defaults to the hiring manager" />} />
        <Select label="Shift" {...register('shiftId')}>
          <option value="">Company default</option>
          {shifts.data
            ?.filter((x) => !x.isDefault)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </Select>
      </form>
    </Modal>
  );
}
