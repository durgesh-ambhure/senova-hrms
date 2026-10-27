import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, FolderKanban, Plus, Send, Trash2, Archive, ArchiveRestore } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useMyWeek, useProjects, useTimesheetMutations, useTimesheetReport, useTimesheets } from './api.js';
import { REQUEST_STATUS } from '../../lib/labels.js';
import { addDaysTo, formatDayShort, formatMinutes, localToday, mondayOf } from '../../lib/format.js';
import { Alert, Badge, Button, Card, CardHeader, DataTable, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Pagination, TabPanel, Tabs, Textarea, useToast } from '../../components/ui/index.js';

const cellCls = 'h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50';
const toRows = (entries) => entries.map((e, i) => ({ key: `${i}-${e.id ?? ''}`, date: e.date, projectId: e.project.id, task: e.task, hours: String(e.minutes / 60), note: e.note }));

function WeekEditor() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(localToday()));
  const q = useMyWeek(weekStart);
  const sheet = q.data;
  // Remount the grid whenever the saved timesheet changes, so local edits start from server data.
  const version = sheet ? `${weekStart}:${sheet.status}:${sheet.history.length}:${sheet.totalMinutes}:${sheet.entries.length}` : weekStart;
  return <WeekGrid key={version} weekStart={weekStart} setWeekStart={setWeekStart} q={q} />;
}

function WeekGrid({ weekStart, setWeekStart, q }) {
  const toast = useToast();
  const projects = useProjects();
  const m = useTimesheetMutations();
  const sheet = q.data;
  const [rows, setRows] = useState(() => (sheet ? toRows(sheet.entries) : []));
  const [errors, setErrors] = useState([]);

  const editable = sheet && ['draft', 'rejected'].includes(sheet.status);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysTo(weekStart, i)), [weekStart]);
  const isCurrentWeek = weekStart === mondayOf(localToday());
  const totals = days.map((d) => rows.filter((r) => r.date === d).reduce((s, r) => s + (Number(r.hours) || 0), 0));
  const dirty = sheet && JSON.stringify(toRows(sheet.entries).map(({ key: _k, ...r }) => r)) !== JSON.stringify(rows.map(({ key: _k, ...r }) => r));

  const update = (key, field, value) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const addRow = () => setRows((rs) => [...rs, { key: `new-${Date.now()}`, date: days[Math.min(rs.length, 4)], projectId: projects.data?.[0]?.id ?? '', task: '', hours: '8', note: '' }]);

  const validate = () => {
    const problems = [];
    rows.forEach((r, i) => {
      const h = Number(r.hours);
      if (!r.projectId) problems.push(`Row ${i + 1}: choose a project`);
      if (!(h > 0 && h <= 24)) problems.push(`Row ${i + 1}: hours must be between 0 and 24`);
    });
    totals.forEach((t, i) => t > 24 && problems.push(`${formatDayShort(days[i])}: more than 24 hours`));
    setErrors(problems);
    return problems.length === 0;
  };

  const save = async () => {
    if (!validate()) return false;
    try {
      await m.save.mutateAsync({ weekStart, entries: rows.map((r) => ({ date: r.date, projectId: r.projectId, task: r.task, minutes: Math.round(Number(r.hours) * 60), note: r.note })) });
      toast.success('Timesheet saved');
      return true;
    } catch (err) {
      setErrors(err.details?.map((d) => d.message) ?? [err.message]);
      return false;
    }
  };
  const submit = async () => {
    if (dirty && !(await save())) return;
    try {
      await m.submit.mutateAsync(weekStart);
      toast.success('Submitted for approval');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Card>
      <CardHeader
        title={`Week of ${formatDayShort(weekStart)}`}
        description={sheet ? `${formatMinutes(Math.round(totals.reduce((a, b) => a + b, 0) * 60))} logged` : undefined}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setWeekStart((w) => addDaysTo(w, -7))} aria-label="Previous week">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setWeekStart((w) => addDaysTo(w, 7))} disabled={isCurrentWeek} aria-label="Next week">
              <ChevronRight className="h-4 w-4" />
            </Button>
            {sheet && <Badge tone={REQUEST_STATUS[sheet.status].tone}>{REQUEST_STATUS[sheet.status].label}</Badge>}
          </div>
        }
      />
      {q.isLoading ? (
        <PageLoader label="Loading timesheet" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : (
        <div className="space-y-4 p-5">
          {sheet.status === 'rejected' && sheet.comment && <Alert>Returned by {sheet.decidedByName}: “{sheet.comment}”. Fix and resubmit.</Alert>}
          {sheet.status === 'approved' && <Alert tone="success">Approved by {sheet.decidedByName}.</Alert>}
          {errors.length > 0 && (
            <Alert>
              <ul className="list-disc pl-4">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="grid grid-cols-7 gap-2 text-center text-xs">
            {days.map((d, i) => (
              <div key={d} className={`rounded-lg px-1 py-2 ${totals[i] > 0 ? 'bg-brand-50 text-brand-800' : 'bg-slate-50 text-slate-500'}`}>
                <div className="font-medium">{formatDayShort(d).split(',')[0]}</div>
                <div className="tabular-nums">{totals[i] ? `${totals[i]}h` : '—'}</div>
              </div>
            ))}
          </div>
          {rows.length === 0 ? (
            <EmptyState title="No time logged this week" description={editable ? 'Add a row for each project and day you worked on.' : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <caption className="sr-only">Timesheet entries</caption>
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-1 py-2">Day</th>
                    <th className="px-1 py-2">Project</th>
                    <th className="px-1 py-2">Task</th>
                    <th className="w-24 px-1 py-2">Hours</th>
                    <th className="px-1 py-2">Note</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.key}>
                      <td className="px-1 py-1">
                        <select aria-label={`Row ${i + 1} day`} className={cellCls} value={r.date} disabled={!editable} onChange={(e) => update(r.key, 'date', e.target.value)}>
                          {days.map((d) => (
                            <option key={d} value={d}>
                              {formatDayShort(d)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <select aria-label={`Row ${i + 1} project`} className={cellCls} value={r.projectId} disabled={!editable} onChange={(e) => update(r.key, 'projectId', e.target.value)}>
                          <option value="">Choose…</option>
                          {projects.data?.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.code} · {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <input aria-label={`Row ${i + 1} task`} className={cellCls} value={r.task} maxLength={120} disabled={!editable} onChange={(e) => update(r.key, 'task', e.target.value)} />
                      </td>
                      <td className="px-1 py-1">
                        <input aria-label={`Row ${i + 1} hours`} className={cellCls} type="number" min="0.25" max="24" step="0.25" value={r.hours} disabled={!editable} onChange={(e) => update(r.key, 'hours', e.target.value)} />
                      </td>
                      <td className="px-1 py-1">
                        <input aria-label={`Row ${i + 1} note`} className={cellCls} value={r.note} maxLength={300} disabled={!editable} onChange={(e) => update(r.key, 'note', e.target.value)} />
                      </td>
                      <td className="px-1 py-1">
                        {editable && (
                          <Button variant="ghost" size="sm" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {editable && (
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="secondary" size="sm" onClick={addRow} disabled={!projects.data?.length}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Add row
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={save} disabled={!dirty} loading={m.save.isPending}>
                  Save draft
                </Button>
                <Button onClick={submit} disabled={!rows.length} loading={m.submit.isPending}>
                  <Send className="h-4 w-4" aria-hidden="true" /> Submit
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ReviewModal({ sheet, onClose }) {
  const toast = useToast();
  const { decide } = useTimesheetMutations();
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  const submit = async (decision) => {
    if (decision === 'rejected' && comment.trim().length < 3) return setError('Tell the employee what to fix');
    try {
      await decide.mutateAsync({ id: sheet.id, decision, comment: comment.trim() });
      toast.success(decision === 'approved' ? 'Timesheet approved' : 'Timesheet returned');
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${sheet.employee.fullName} · week of ${formatDayShort(sheet.weekStart)}`}
      description={`${formatMinutes(sheet.totalMinutes)} logged`}
      size="lg"
      footer={
        <>
          <Button variant="danger" onClick={() => submit('rejected')} loading={decide.isPending}>
            Return for changes
          </Button>
          <Button onClick={() => submit('approved')} loading={decide.isPending}>
            Approve
          </Button>
        </>
      }
    >
      <table className="mb-4 w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="py-1">Day</th>
            <th className="py-1">Project</th>
            <th className="py-1">Task</th>
            <th className="py-1 text-right">Hours</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sheet.entries.map((e) => (
            <tr key={e.id}>
              <td className="py-1.5">{formatDayShort(e.date)}</td>
              <td className="py-1.5">{e.project.code}</td>
              <td className="py-1.5">{e.task || '—'}</td>
              <td className="py-1.5 text-right tabular-nums">{formatMinutes(e.minutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Textarea label="Comment (required to return)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} error={error} />
    </Modal>
  );
}

function SheetsTable({ scope }) {
  const [page, setPage] = useState(1);
  const q = useTimesheets({ scope, page, limit: 20 });
  const [reviewing, setReviewing] = useState(null);
  const columns = [
    ...(scope !== 'mine' ? [{ key: 'employee', header: 'Employee', render: (t) => <span className="font-medium text-slate-900">{t.employee.fullName}</span> }] : []),
    { key: 'week', header: 'Week', className: 'whitespace-nowrap', render: (t) => `${formatDayShort(t.weekStart)} – ${formatDayShort(t.weekEnd)}` },
    { key: 'total', header: 'Hours', render: (t) => formatMinutes(t.totalMinutes) },
    { key: 'status', header: 'Status', render: (t) => <Badge tone={REQUEST_STATUS[t.status].tone}>{REQUEST_STATUS[t.status].label}</Badge> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (t) =>
        scope === 'approvals' && (
          <Button size="sm" variant="secondary" onClick={() => setReviewing(t)}>
            Review
          </Button>
        ),
    },
  ];
  return (
    <Card>
      <DataTable caption="Timesheets" columns={columns} rows={q.data?.data} isLoading={q.isLoading} error={q.error} onRetry={q.refetch} empty={<EmptyState title={scope === 'approvals' ? 'Nothing waiting for approval' : 'No timesheets'} />} />
      <Pagination meta={q.data?.meta} onPageChange={setPage} />
      {reviewing && <ReviewModal sheet={reviewing} onClose={() => setReviewing(null)} />}
    </Card>
  );
}

function ReportTab() {
  const [range, setRange] = useState(() => ({ from: addDaysTo(mondayOf(localToday()), -28), to: localToday() }));
  const [status, setStatus] = useState('approved');
  const q = useTimesheetReport({ ...range, status }, range.to >= range.from);
  const total = (q.data ?? []).reduce((s, r) => s + r.minutes, 0);
  const columns = [
    { key: 'employee', header: 'Employee', render: (r) => r.employee.fullName },
    { key: 'project', header: 'Project', render: (r) => `${r.project.code} · ${r.project.name}` },
    { key: 'minutes', header: 'Hours', className: 'text-right tabular-nums', render: (r) => formatMinutes(r.minutes) },
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
        <Input label="From" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        <Input label="To" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        <label className="text-sm font-medium text-slate-700">
          Include
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1.5 block h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm">
            <option value="approved">Approved only</option>
            <option value="submitted">Awaiting approval</option>
          </select>
        </label>
        <p className="ml-auto text-sm text-slate-600">
          Total <span className="font-semibold text-slate-900">{formatMinutes(total)}</span>
        </p>
      </div>
      <DataTable caption="Hours by employee and project" rowKey="key" columns={columns} rows={q.data?.map((r) => ({ ...r, key: `${r.employee.id}-${r.project.id}` }))} isLoading={q.isLoading} error={q.error} onRetry={q.refetch} empty={<EmptyState title="No hours in this period" />} />
    </Card>
  );
}

function ProjectsTab() {
  const toast = useToast();
  const q = useProjects(true);
  const m = useTimesheetMutations();
  const [form, setForm] = useState(null);
  const save = async () => {
    try {
      if (form.id) await m.updateProject.mutateAsync(form);
      else await m.createProject.mutateAsync(form);
      toast.success('Project saved');
      setForm(null);
    } catch (err) {
      toast.error(err.details?.[0]?.message ?? err.message);
    }
  };
  const columns = [
    { key: 'name', header: 'Project', render: (p) => <span className="font-medium text-slate-900">{p.name}</span> },
    { key: 'code', header: 'Code', render: (p) => <Badge>{p.code}</Badge> },
    { key: 'status', header: 'Status', render: (p) => <Badge tone={p.status === 'active' ? 'success' : 'neutral'}>{p.status === 'active' ? 'Active' : 'Archived'}</Badge> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right whitespace-nowrap',
      render: (p) => (
        <>
          <Button variant="ghost" size="sm" onClick={() => setForm({ id: p.id, name: p.name, code: p.code, description: p.description })}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${p.status === 'active' ? 'Archive' : 'Restore'} ${p.name}`}
            onClick={() => m.updateProject.mutateAsync({ id: p.id, status: p.status === 'active' ? 'archived' : 'active' }).then(() => toast.success('Saved'), (e) => toast.error(e.message))}
          >
            {p.status === 'active' ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
          </Button>
        </>
      ),
    },
  ];
  return (
    <Card>
      <div className="flex justify-end border-b border-slate-100 p-4">
        <Button size="sm" onClick={() => setForm({ name: '', code: '', description: '' })}>
          <Plus className="h-4 w-4" aria-hidden="true" /> New project
        </Button>
      </div>
      <DataTable caption="Projects" columns={columns} rows={q.data} isLoading={q.isLoading} error={q.error} onRetry={q.refetch} empty={<EmptyState icon={FolderKanban} title="No projects yet" />} />
      {form && (
        <Modal
          open
          onClose={() => setForm(null)}
          title={form.id ? 'Edit project' : 'New project'}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setForm(null)}>
                Cancel
              </Button>
              <Button onClick={save} loading={m.createProject.isPending || m.updateProject.isPending}>
                Save
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} hint="2–12 letters, digits or hyphens" required />
            <Textarea label="Description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </Modal>
      )}
    </Card>
  );
}

export function TimesheetsPage() {
  const { can, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const canSelf = Boolean(user.employee) && can('self:timesheets');
  const canApprove = can('timesheets:manage') || can('timesheets:approve:team');
  const tabs = [
    ...(canSelf ? [{ value: 'mine', label: 'My timesheet' }, { value: 'history', label: 'My history' }] : []),
    ...(canApprove ? [{ value: 'approvals', label: 'Approvals' }] : []),
    ...(canSelf || canApprove ? [{ value: 'report', label: 'Report' }] : []),
    ...(can('timesheets:manage') ? [{ value: 'projects', label: 'Projects' }] : []),
  ];
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : tabs[0]?.value;
  return (
    <>
      <PageHeader title="Timesheets" description="Log weekly hours by project; managers approve or return them." />
      {!tabs.length ? (
        <Alert tone="info">Your account isn't linked to an employee profile.</Alert>
      ) : (
        <>
          <Tabs label="Timesheet sections" tabs={tabs} value={tab} onChange={(v) => setParams({ tab: v })} />
          <TabPanel value={tab}>
            {tab === 'mine' && <WeekEditor />}
            {tab === 'history' && <SheetsTable scope="mine" />}
            {tab === 'approvals' && <SheetsTable scope="approvals" />}
            {tab === 'report' && <ReportTab />}
            {tab === 'projects' && <ProjectsTab />}
          </TabPanel>
        </>
      )}
    </>
  );
}
