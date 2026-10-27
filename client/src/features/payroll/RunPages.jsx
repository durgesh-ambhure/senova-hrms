import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import clsx from 'clsx';
import { AlertTriangle, Calculator, CheckCircle2, Download, FileSpreadsheet, Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useAdjustments, useEntries, usePayrollMutations, useRuleSets, useRun, useRuns } from './api.js';
import { EmployeePicker } from '../employees/EmployeePicker.jsx';
import { download } from '../../lib/api.js';
import { RUN_STATUS, RUN_STEPS } from '../../lib/labels.js';
import { formatDateTime, formatINR, formatMonth, localToday } from '../../lib/format.js';
import { Alert, Badge, Button, Card, CardHeader, DataTable, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Select, Textarea, useToast } from '../../components/ui/index.js';

export const RunBadge = ({ status }) => <Badge tone={RUN_STATUS[status].tone}>{RUN_STATUS[status].label}</Badge>;

function NewRunModal({ onClose }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { createRun } = usePayrollMutations();
  const [month, setMonth] = useState(localToday().slice(0, 7));
  const [type, setType] = useState('regular');
  const [reason, setReason] = useState('');
  const submit = async () => {
    try {
      const run = await createRun.mutateAsync({ month, type, reason });
      toast.success(`${formatMonth(month)} payroll created`);
      navigate(`/payroll/runs/${run.id}`);
    } catch (err) {
      toast.error(err.details?.[0]?.message ?? err.message);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="New payroll run"
      description="A regular run covers the whole calendar month (P1). Supplementary runs correct a month that is already finalized."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={createRun.isPending}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Month" type="month" max={localToday().slice(0, 7)} value={month} onChange={(e) => setMonth(e.target.value)} />
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="regular">Regular monthly payroll</option>
          <option value="supplementary">Supplementary (correction)</option>
        </Select>
        {type === 'supplementary' && <Textarea label="What does it correct?" value={reason} onChange={(e) => setReason(e.target.value)} />}
      </div>
    </Modal>
  );
}

export function PayrollRunsPage() {
  const { can } = useAuth();
  const runs = useRuns({});
  const rules = useRuleSets();
  const [creating, setCreating] = useState(false);
  const active = rules.data?.find((r) => r.status === 'active');
  const columns = [
    {
      key: 'month',
      header: 'Payroll',
      render: (r) => (
        <Link to={`/payroll/runs/${r.id}`} className="block">
          <span className="block font-medium text-slate-900 hover:text-brand-700">{formatMonth(r.month)}</span>
          <span className="block text-xs text-slate-500">{r.type === 'regular' ? 'Regular' : `Supplementary #${r.sequence}`}</span>
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <RunBadge status={r.status} />,
    },
    {
      key: 'employees',
      header: 'Employees',
      render: (r) => r.totals.employees,
    },
    {
      key: 'gross',
      header: 'Gross',
      className: 'text-right tabular-nums',
      render: (r) => formatINR(r.totals.gross),
    },
    {
      key: 'net',
      header: 'Net pay',
      className: 'text-right tabular-nums',
      render: (r) => formatINR(r.totals.net),
    },
    {
      key: 'issues',
      header: 'Issues',
      render: (r) => (r.issues.blockers ? <Badge tone="danger">{r.issues.blockers} blocking</Badge> : r.issues.warnings ? <Badge tone="warning">{r.issues.warnings} warnings</Badge> : '—'),
    },
    { key: 'by', header: 'Prepared by', render: (r) => r.preparedByName },
  ];
  return (
    <>
      <PageHeader
        title="Payroll"
        description="Monthly runs: Payroll Admin prepares, HR or Finance approves, a Super Admin finalizes."
        actions={
          can('payroll:process') && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" /> New run
            </Button>
          )
        }
      />
      {rules.data && !active && (
        <div className="mb-4">
          <Alert>
            No active payroll rules. Set up PF, ESI, PT and the salary template in{' '}
            <Link to="/payroll/settings" className="font-medium underline">
              payroll settings
            </Link>{' '}
            first.
          </Alert>
        </div>
      )}
      {active && !active.verification && (
        <div className="mb-4">
          <Alert tone="info">
            <span className="inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Payroll rules v{active.version} are not verified by a payroll professional yet. Runs can be prepared and approved, but not finalized.
            </span>
          </Alert>
        </div>
      )}
      <Card>
        <DataTable caption="Payroll runs" columns={columns} rows={runs.data} isLoading={runs.isLoading} error={runs.error} onRetry={runs.refetch} empty={<EmptyState icon={Calculator} title="No payroll runs yet" />} />
      </Card>
      {creating && <NewRunModal onClose={() => setCreating(false)} />}
    </>
  );
}

function Stepper({ status }) {
  const index = RUN_STEPS.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Run progress">
      {RUN_STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            className={clsx('flex items-center gap-1 rounded-full px-2.5 py-1 font-medium', i < index ? 'bg-accent-50 text-accent-700' : i === index ? 'bg-brand-800 text-white' : 'bg-slate-100 text-slate-500')}
            aria-current={i === index ? 'step' : undefined}
          >
            {i < index && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
            {RUN_STATUS[s].label}
          </span>
          {i < RUN_STEPS.length - 1 && <span className="h-px w-4 bg-slate-300" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function LineSection({ title, lines }) {
  if (!lines.length) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {lines.map((l) => (
            <tr key={l.code}>
              <td className="py-1.5 text-slate-800">
                {l.label}
                {l.basis && <span className="ml-2 text-xs text-slate-500">{l.basis}</span>}
              </td>
              <td className="py-1.5 text-right tabular-nums">{formatINR(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EntryModal({ entry, onClose }) {
  const group = (t) => entry.lines.filter((l) => l.type === t);
  return (
    <Modal open onClose={onClose} title={`${entry.employee.fullName} · ${entry.employee.employeeCode}`} description={`${entry.employee.designation ?? ''} · ${entry.employee.department ?? ''}`} size="lg">
      <div className="space-y-5">
        {entry.blockers.map((b) => (
          <Alert key={b}>{b}</Alert>
        ))}
        {entry.warnings.length > 0 && (
          <Alert tone="info">
            <ul className="list-disc pl-4">
              {entry.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Alert>
        )}
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">Days in month</dt>
            <dd className="font-medium">{entry.inputs.daysInMonth}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Paid days</dt>
            <dd className="font-medium">{entry.inputs.paidDays}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Loss of pay</dt>
            <dd className="font-medium">{entry.inputs.lopDays} days</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Rules</dt>
            <dd className="font-medium">v{entry.ruleVersion}</dd>
          </div>
        </dl>
        <LineSection title="Earnings" lines={group('earning')} />
        <LineSection title="Deductions" lines={group('deduction')} />
        <LineSection title="Rounding" lines={group('rounding')} />
        <div className="flex justify-between rounded-lg bg-brand-50 px-4 py-3 font-semibold text-brand-900">
          <span>Net pay</span>
          <span className="tabular-nums">{formatINR(entry.totals.net)}</span>
        </div>
        <LineSection title="Employer cost (not on payslip)" lines={group('employer')} />
        {entry.inputs.lopDetail.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Loss-of-pay days (source)</h3>
            <ul className="text-sm text-slate-700">
              {entry.inputs.lopDetail.map((d) => (
                <li key={d.date}>
                  {d.date}: {d.units / 2} day · {d.unpaidLeaveUnits ? 'unpaid leave' : ''}
                  {d.unpaidLeaveUnits && d.absenceUnits ? ' + ' : ''}
                  {d.absenceUnits ? 'absence' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
        {entry.inputs.segments.length > 1 && <p className="text-xs text-slate-500">Salary split across revisions: {entry.inputs.segments.map((s) => `#${s.revisionNo} ${s.from}–${s.to}`).join(', ')}</p>}
      </div>
    </Modal>
  );
}

function AdjustmentsCard({ run, editable }) {
  const toast = useToast();
  const q = useAdjustments(run.id);
  const { addAdjustment, removeAdjustment, importTds } = usePayrollMutations();
  const [employee, setEmployee] = useState(null);
  const [kind, setKind] = useState('tds');
  const [labelText, setLabelText] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [bulk, setBulk] = useState(null);
  const add = async (e) => {
    e.preventDefault();
    try {
      await addAdjustment.mutateAsync({
        runId: run.id,
        employeeId: employee?.id,
        kind,
        label: kind === 'tds' ? undefined : labelText,
        amount,
        reason,
      });
      toast.success('Added. Recalculate the run to apply it.');
      setAmount('');
      setLabelText('');
      setReason('');
    } catch (err) {
      toast.error(err.details?.[0]?.message ?? err.message);
    }
  };
  const runImport = async () => {
    const rows = bulk
      .split(/\r?\n/)
      .map((l) => l.split(/[,\t]/).map((x) => x.trim()))
      .filter((r) => r[0] && r[1])
      .map(([employeeCode, amt]) => ({ employeeCode, amount: amt }));
    try {
      await importTds.mutateAsync({ runId: run.id, rows });
      toast.success(`Imported TDS for ${rows.length} employee(s). Recalculate to apply.`);
      setBulk(null);
    } catch (err) {
      toast.error(err.details?.map((d) => d.message).join('; ') ?? err.message);
    }
  };
  return (
    <Card>
      <CardHeader
        title="TDS and adjustments"
        description="TDS comes from your CA or tax tool (P7). One-off earnings and deductions need a reason."
        actions={
          editable && (
            <Button size="sm" variant="secondary" onClick={() => setBulk('')}>
              Import TDS
            </Button>
          )
        }
      />
      {editable && (
        <form onSubmit={add} className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <EmployeePicker label="Employee" value={employee} onChange={setEmployee} />
          </div>
          <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="tds">TDS</option>
            <option value="earning">Earning</option>
            <option value="deduction">Deduction</option>
          </Select>
          {kind !== 'tds' && <Input label="Label" value={labelText} onChange={(e) => setLabelText(e.target.value)} placeholder="e.g. Referral bonus" />}
          <Input label="Amount (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex items-end sm:col-span-6">
            <Button type="submit" size="sm" disabled={!employee || !amount} loading={addAdjustment.isPending}>
              Add
            </Button>
          </div>
        </form>
      )}
      {q.data?.length ? (
        <ul className="divide-y divide-slate-100">
          {q.data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <Badge tone={a.kind === 'deduction' || a.kind === 'tds' ? 'warning' : 'success'}>{a.kind.toUpperCase()}</Badge>
              <span className="flex-1 text-slate-800">
                {a.label} {a.reason && <span className="text-xs text-slate-500">— {a.reason}</span>}
              </span>
              <span className="tabular-nums">{formatINR(a.amount)}</span>
              {editable && (
                <Button variant="ghost" size="sm" aria-label={`Remove ${a.label}`} onClick={() => removeAdjustment.mutateAsync({ runId: run.id, id: a.id }).catch((e) => toast.error(e.message))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-sm text-slate-500">No TDS or adjustments entered.</p>
      )}
      {bulk !== null && (
        <Modal
          open
          onClose={() => setBulk(null)}
          title="Import TDS"
          description="One line per employee: employee code, amount in rupees. Existing TDS for those employees is replaced."
          footer={
            <>
              <Button variant="secondary" onClick={() => setBulk(null)}>
                Cancel
              </Button>
              <Button onClick={runImport} loading={importTds.isPending} disabled={!bulk.trim()}>
                Import
              </Button>
            </>
          }
        >
          <Textarea label="Rows" rows={8} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'SEN-0001, 12500\nSEN-0002, 0'} />
        </Modal>
      )}
    </Card>
  );
}

export function RunDetailPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const toast = useToast();
  const run = useRun(id);
  const [search, setSearch] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const entries = useEntries(id, {
    search: search || undefined,
    issues: issuesOnly ? 'true' : undefined,
  });
  const m = usePayrollMutations();
  const [entry, setEntry] = useState(null);
  const [noteFor, setNoteFor] = useState(null);
  const [note, setNote] = useState('');
  if (run.isLoading) return <PageLoader label="Loading payroll" />;
  if (run.error) return <ErrorState error={run.error} />;
  const r = run.data;
  const editable = ['draft', 'calculated'].includes(r.status) && can('payroll:process');

  const act = async (action, body = {}) => {
    try {
      await m.transition.mutateAsync({ id, action, ...body });
      toast.success(
        {
          submit: 'Sent for review',
          approve: 'Approved',
          finalize: 'Payroll finalized and payslips issued',
          return: 'Returned to the preparer',
          cancel: 'Run cancelled',
        }[action],
      );
      setNoteFor(null);
      setNote('');
    } catch (err) {
      toast.error(err.details?.[0]?.message ?? err.message);
    }
  };
  const calculate = () =>
    m.calculate.mutateAsync(id).then(
      () => toast.success('Calculated'),
      (e) => toast.error(e.message),
    );
  const isPreparer = r.preparedBy === user.id;
  const isApprover = r.approvedBy === user.id;

  const actions = [
    editable && {
      key: 'calc',
      node: (
        <Button onClick={calculate} loading={m.calculate.isPending}>
          <Calculator className="h-4 w-4" aria-hidden="true" /> {r.status === 'draft' ? 'Calculate' : 'Recalculate'}
        </Button>
      ),
    },
    r.status === 'calculated' &&
      can('payroll:process') && {
        key: 'submit',
        node: (
          <Button variant="secondary" onClick={() => act('submit')} disabled={r.issues.blockers > 0}>
            Send for review
          </Button>
        ),
      },
    r.status === 'under_review' &&
      can('payroll:approve') &&
      !isPreparer && {
        key: 'approve',
        node: (
          <Button onClick={() => act('approve')}>
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Approve
          </Button>
        ),
      },
    ['under_review', 'approved'].includes(r.status) &&
      can('payroll:approve') &&
      !isPreparer && {
        key: 'return',
        node: (
          <Button variant="secondary" onClick={() => setNoteFor('return')}>
            Return for changes
          </Button>
        ),
      },
    r.status === 'approved' &&
      can('payroll:finalize') &&
      !isPreparer &&
      !isApprover && {
        key: 'finalize',
        node: (
          <Button onClick={() => setNoteFor('finalize')} disabled={!r.rulesVerified}>
            <Lock className="h-4 w-4" aria-hidden="true" /> Finalize
          </Button>
        ),
      },
    ['draft', 'calculated'].includes(r.status) &&
      can('payroll:process') && {
        key: 'cancel',
        node: (
          <Button variant="ghost" onClick={() => setNoteFor('cancel')}>
            Cancel run
          </Button>
        ),
      },
  ].filter(Boolean);

  const columns = [
    {
      key: 'employee',
      header: 'Employee',
      render: (e) => (
        <button type="button" className="text-left" onClick={() => setEntry(e)}>
          <span className="block font-medium text-slate-900 hover:text-brand-700">{e.employee.fullName}</span>
          <span className="block text-xs text-slate-500">
            {e.employee.employeeCode} · {e.employee.department}
          </span>
        </button>
      ),
    },
    {
      key: 'days',
      header: 'Paid days',
      render: (e) => `${e.inputs.paidDays}/${e.inputs.daysInMonth}`,
    },
    {
      key: 'gross',
      header: 'Gross',
      className: 'text-right tabular-nums',
      render: (e) => formatINR(e.totals.gross),
    },
    {
      key: 'deductions',
      header: 'Deductions',
      className: 'text-right tabular-nums',
      render: (e) => formatINR(e.totals.deductions),
    },
    {
      key: 'net',
      header: 'Net pay',
      className: 'text-right tabular-nums font-medium',
      render: (e) => formatINR(e.totals.net),
    },
    {
      key: 'issues',
      header: 'Issues',
      render: (e) => (e.blockers.length ? <Badge tone="danger">Blocked</Badge> : e.warnings.length ? <Badge tone="warning">{e.warnings.length}</Badge> : ''),
    },
  ];

  return (
    <>
      <PageHeader
        title={`${formatMonth(r.month)} payroll${r.type === 'supplementary' ? ` · supplementary #${r.sequence}` : ''}`}
        description={`Prepared by ${r.preparedByName}${r.approvedByName ? ` · approved by ${r.approvedByName}` : ''}${r.finalizedByName ? ` · finalized by ${r.finalizedByName} ${formatDateTime(r.finalizedAt)}` : ''}`}
        actions={actions.map((a) => (
          <span key={a.key}>{a.node}</span>
        ))}
      />
      <div className="mb-6 space-y-3">
        <Stepper status={r.status === 'cancelled' ? 'draft' : r.status} />
        {r.status === 'cancelled' && <Alert>This run was cancelled.</Alert>}
        {r.returnNote && ['calculated', 'draft'].includes(r.status) && <Alert>Returned for changes: “{r.returnNote}”</Alert>}
        {r.status === 'approved' && !r.rulesVerified && <Alert>Payroll rules v{r.ruleVersion} must be verified by a payroll professional before finalizing (Payroll → Settings).</Alert>}
        {r.status === 'under_review' && isPreparer && <Alert tone="info">You prepared this run, so someone else must approve it.</Alert>}
        {r.reason && <p className="text-sm text-slate-600">Reason: {r.reason}</p>}
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['Employees', r.totals.employees],
          ['Gross', formatINR(r.totals.gross)],
          ['Deductions', formatINR(r.totals.deductions)],
          ['Net pay', formatINR(r.totals.net)],
          ['Employer cost', formatINR(r.totals.employerCost)],
        ].map(([k, val]) => (
          <Card key={k} className="p-4">
            <p className="text-xs text-slate-500">{k}</p>
            <p className="text-lg font-semibold tabular-nums text-slate-900">{val}</p>
          </Card>
        ))}
      </div>
      {r.skipped.length > 0 && (
        <div className="mb-6">
          <Alert tone="info">
            {r.skipped.length} employee(s) skipped: {r.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}.{' '}
            <Link to="/payroll/salaries?missing=true" className="font-medium underline">
              Add salaries
            </Link>
          </Alert>
        </div>
      )}
      {(editable || r.type === 'supplementary') && (
        <div className="mb-6">
          <AdjustmentsCard run={r} editable={editable} />
        </div>
      )}
      <Card>
        <CardHeader
          title="Employees"
          actions={
            <>
              <Button size="sm" variant="secondary" onClick={() => download(`/payroll/runs/${id}/register.csv`, `payroll-register-${r.month}.csv`).catch((e) => toast.error(e.message))}>
                <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> Register CSV
              </Button>
              {r.status === 'finalized' && can('payroll:process') && can('employees:sensitive:read') && (
                <Button size="sm" variant="secondary" onClick={() => download(`/payroll/runs/${id}/bank-advice.csv`, `bank-advice-${r.month}.csv`).catch((e) => toast.error(e.message))}>
                  <Download className="h-4 w-4" aria-hidden="true" /> Bank advice
                </Button>
              )}
            </>
          }
        />
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <input type="search" aria-label="Search employees" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or code" className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm" />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" className="accent-brand-700" checked={issuesOnly} onChange={(e) => setIssuesOnly(e.target.checked)} /> Only with issues
          </label>
        </div>
        <DataTable
          caption="Payroll entries"
          columns={columns}
          rows={entries.data}
          isLoading={entries.isLoading}
          error={entries.error}
          onRetry={entries.refetch}
          empty={<EmptyState icon={Calculator} title={r.status === 'draft' ? 'Not calculated yet' : 'No entries'} />}
        />
      </Card>
      {entry && <EntryModal entry={entry} onClose={() => setEntry(null)} />}
      {noteFor && (
        <Modal
          open
          onClose={() => setNoteFor(null)}
          title={
            {
              return: 'Return for changes',
              finalize: 'Finalize payroll',
              cancel: 'Cancel run',
            }[noteFor]
          }
          description={noteFor === 'finalize' ? 'Finalizing locks this month’s attendance and leave, settles arrears and issues payslips. It cannot be undone; corrections need a supplementary run.' : undefined}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setNoteFor(null)}>
                Back
              </Button>
              <Button variant={noteFor === 'cancel' ? 'danger' : 'primary'} loading={m.transition.isPending} onClick={() => act(noteFor, { note })}>
                {
                  {
                    return: 'Return',
                    finalize: 'Finalize and issue payslips',
                    cancel: 'Cancel run',
                  }[noteFor]
                }
              </Button>
            </>
          }
        >
          <Textarea label={noteFor === 'return' ? 'What needs to change?' : 'Note (optional)'} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} data-autofocus />
        </Modal>
      )}
    </>
  );
}
