import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, Download, FileText, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useHistoryReport, useMonthReport, usePayrollMutations, usePayslip, usePayslips, useRuleSets } from './api.js';
import { SalaryHistory } from './SalaryPages.jsx';
import { EmployeePicker } from '../employees/EmployeePicker.jsx';
import { download } from '../../lib/api.js';
import { formatDateTime, formatINR, formatMonth, localToday } from '../../lib/format.js';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, DataTable, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Select, TabPanel, Tabs, Textarea, useToast } from '../../components/ui/index.js';

// Payslips

function PayslipModal({ id, onClose }) {
  const toast = useToast();
  const q = usePayslip(id);
  const p = q.data;
  return (
    <Modal
      open
      onClose={onClose}
      title={p ? `Payslip · ${formatMonth(p.month)}${p.runType === 'supplementary' ? ' (supplementary)' : ''}` : 'Payslip'}
      description={p ? `${p.employee.fullName} · ${p.employee.employeeCode}` : undefined}
      size="lg"
      footer={
        p && (
          <Button onClick={() => download(`/payroll/payslips/${p.id}/pdf`, `payslip-${p.month}-${p.employee.employeeCode}.pdf`).catch((e) => toast.error(e.message))}>
            <Download className="h-4 w-4" aria-hidden="true" /> Download PDF
          </Button>
        )
      }
    >
      {!p ? (
        <PageLoader />
      ) : (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            Paid days {p.paidDays} of {p.daysInMonth} · loss of pay {p.lopDays}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {['earning', 'deduction'].map((t) => (
              <div key={t}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t === 'earning' ? 'Earnings' : 'Deductions'}</h3>
                <ul className="divide-y divide-slate-100">
                  {p.lines
                    .filter((l) => l.type === t)
                    .map((l) => (
                      <li key={l.code} className="flex justify-between py-1.5">
                        <span>{l.label}</span>
                        <span className="tabular-nums">{formatINR(l.amount)}</span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex justify-between rounded-lg bg-brand-50 px-4 py-3 font-semibold text-brand-900">
            <span>Net pay</span>
            <span className="tabular-nums">{formatINR(p.totals.net)}</span>
          </div>
          <p className="text-xs text-slate-500">
            Year to date from {formatMonth(p.ytd.from)}: gross {formatINR(p.ytd.gross)} · TDS {formatINR(p.ytd.tds)} · net {formatINR(p.ytd.net)}
          </p>
        </div>
      )}
    </Modal>
  );
}

export function PayslipsPage() {
  const { can, user } = useAuth();
  const all = can('payslips:read:all');
  const [tab, setTab] = useState(user.employee ? 'mine' : 'all');
  const [employee, setEmployee] = useState(null);
  const [open, setOpen] = useState(null);
  const q = usePayslips(tab === 'mine' ? {} : { employee: employee?.id }, tab === 'mine' || Boolean(employee));
  const tabs = [
    ...(user.employee
      ? [
          { value: 'mine', label: 'My payslips' },
          { value: 'salary', label: 'My salary' },
        ]
      : []),
    ...(all ? [{ value: 'all', label: 'Everyone' }] : []),
  ];
  const columns = [
    {
      key: 'month',
      header: 'Month',
      render: (p) => (
        <span className="font-medium text-slate-900">
          {formatMonth(p.month)}
          {p.runType === 'supplementary' && <Badge className="ml-2">Supplementary</Badge>}
        </span>
      ),
    },
    ...(tab === 'all'
      ? [
          {
            key: 'employee',
            header: 'Employee',
            render: (p) => p.employee.fullName,
          },
        ]
      : []),
    {
      key: 'days',
      header: 'Paid days',
      render: (p) => `${p.paidDays}/${p.daysInMonth}`,
    },
    {
      key: 'gross',
      header: 'Gross',
      className: 'text-right tabular-nums',
      render: (p) => formatINR(p.totals.gross),
    },
    {
      key: 'net',
      header: 'Net pay',
      className: 'text-right tabular-nums font-medium',
      render: (p) => formatINR(p.totals.net),
    },
    {
      key: 'open',
      header: <span className="sr-only">Open</span>,
      className: 'text-right',
      render: (p) => (
        <Button size="sm" variant="secondary" onClick={() => setOpen(p.id)}>
          View
        </Button>
      ),
    },
  ];
  return (
    <>
      <PageHeader title="Payslips" description="Issued when a payroll is finalized. Each payslip is a fixed record of what was paid." />
      {tabs.length > 1 && <Tabs label="Payslip sections" tabs={tabs} value={tab} onChange={setTab} />}
      <TabPanel value={tab}>
        {tab === 'salary' ? (
          <SalaryHistory employeeId="me" />
        ) : (
          <Card>
            {tab === 'all' && (
              <div className="max-w-sm border-b border-slate-100 p-4">
                <EmployeePicker label="Employee" value={employee} onChange={setEmployee} />
              </div>
            )}
            {tab === 'all' && !employee ? (
              <EmptyState icon={FileText} title="Choose an employee" />
            ) : (
              <DataTable caption="Payslips" columns={columns} rows={q.data} isLoading={q.isLoading} error={q.error} onRetry={q.refetch} empty={<EmptyState icon={FileText} title="No payslips yet" />} />
            )}
          </Card>
        )}
      </TabPanel>
      {open && <PayslipModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

// Settings

const emptySlab = { from: '', to: '', monthly: '', february: '' };
const s = (v) => (v === null || v === undefined ? '' : String(v));

function RuleEditor({ rules, onClose }) {
  const toast = useToast();
  const { createRules, updateRules } = usePayrollMutations();
  const isDraft = rules?.status === 'draft';
  const [f, setF] = useState(() => ({
    effectiveFrom: rules?.effectiveFrom ?? localToday().slice(0, 7),
    basic: s(rules?.template.basicPercentOfGross ?? 50),
    hra: s(rules?.template.hraPercentOfBasic ?? 40),
    pfEnabled: rules?.pf.enabled ?? false,
    pfEmployee: s(rules?.pf.employeePercent),
    pfEmployer: s(rules?.pf.employerPercent),
    eps: s(rules?.pf.epsPercent),
    pfCeiling: s(rules?.pf.wageCeiling),
    epsCeiling: s(rules?.pf.epsCeiling),
    esiEnabled: rules?.esi.enabled ?? false,
    esiEmployee: s(rules?.esi.employeePercent),
    esiEmployer: s(rules?.esi.employerPercent),
    esiLimit: s(rules?.esi.wageLimit),
    ptEnabled: rules?.pt.enabled ?? false,
    ptState: rules?.pt.state ?? 'MH',
    slabs: rules?.pt.slabs.length
      ? rules.pt.slabs.map((x) => ({
          from: s(x.from),
          to: s(x.to),
          monthly: s(x.monthly),
          february: s(x.february),
        }))
      : [emptySlab],
    gratuity: s(rules?.gratuity.percentOfBasic ?? 0),
    includeAbsence: rules?.lop.includeAbsence ?? true,
    notes: rules?.notes ?? '',
  }));
  const set = (k) => (e) =>
    setF((x) => ({
      ...x,
      [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }));
  const n = (v) => (v === '' ? '0' : v);
  const save = async () => {
    const body = {
      effectiveFrom: f.effectiveFrom,
      template: {
        basicPercentOfGross: n(f.basic),
        hraPercentOfBasic: n(f.hra),
      },
      pf: {
        enabled: f.pfEnabled,
        employeePercent: n(f.pfEmployee),
        employerPercent: n(f.pfEmployer),
        epsPercent: n(f.eps),
        wageCeiling: n(f.pfCeiling),
        epsCeiling: n(f.epsCeiling),
      },
      esi: {
        enabled: f.esiEnabled,
        employeePercent: n(f.esiEmployee),
        employerPercent: n(f.esiEmployer),
        wageLimit: n(f.esiLimit),
      },
      pt: {
        enabled: f.ptEnabled,
        state: f.ptState,
        slabs: f.slabs
          .filter((x) => x.from !== '' || x.monthly !== '')
          .map((x) => ({
            from: n(x.from),
            to: x.to === '' ? null : x.to,
            monthly: n(x.monthly),
            february: x.february === '' ? null : x.february,
          })),
      },
      gratuity: { percentOfBasic: n(f.gratuity) },
      lop: { includeAbsence: f.includeAbsence },
      notes: f.notes,
    };
    try {
      if (isDraft) await updateRules.mutateAsync({ id: rules.id, ...body });
      else await createRules.mutateAsync(body);
      toast.success('Draft saved. Activate it when ready.');
      onClose();
    } catch (err) {
      toast.error(err.details?.map((d) => d.message).join('; ') ?? err.message);
    }
  };
  const slabField = (i, k) => (e) =>
    setF((x) => ({
      ...x,
      slabs: x.slabs.map((sl, j) => (j === i ? { ...sl, [k]: e.target.value } : sl)),
    }));
  return (
    <Modal
      open
      onClose={onClose}
      title={isDraft ? `Edit draft v${rules.version}` : 'New rule set (draft)'}
      description="Enter the figures your CA or payroll consultant has confirmed. Rates in %, amounts in ₹ per month."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={createRules.isPending || updateRules.isPending}>
            Save draft
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="First payroll month" type="month" value={f.effectiveFrom} onChange={set('effectiveFrom')} />
          <Input label="Basic % of gross" inputMode="decimal" value={f.basic} onChange={set('basic')} />
          <Input label="HRA % of basic" inputMode="decimal" value={f.hra} onChange={set('hra')} />
        </div>
        <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-800">Provident fund (P4)</legend>
          <Checkbox label="PF applies" checked={f.pfEnabled} onChange={set('pfEnabled')} />
          {f.pfEnabled && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Employee %" inputMode="decimal" value={f.pfEmployee} onChange={set('pfEmployee')} />
              <Input label="Employer %" inputMode="decimal" value={f.pfEmployer} onChange={set('pfEmployer')} />
              <Input label="of which pension (EPS) %" inputMode="decimal" value={f.eps} onChange={set('eps')} />
              <Input label="PF wage ceiling (₹)" inputMode="decimal" value={f.pfCeiling} onChange={set('pfCeiling')} />
              <Input label="EPS wage ceiling (₹)" inputMode="decimal" value={f.epsCeiling} onChange={set('epsCeiling')} />
            </div>
          )}
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-800">ESI (P5)</legend>
          <Checkbox label="ESI applies" checked={f.esiEnabled} onChange={set('esiEnabled')} />
          {f.esiEnabled && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Employee %" inputMode="decimal" value={f.esiEmployee} onChange={set('esiEmployee')} />
              <Input label="Employer %" inputMode="decimal" value={f.esiEmployer} onChange={set('esiEmployer')} />
              <Input label="Gross wage limit (₹)" inputMode="decimal" value={f.esiLimit} onChange={set('esiLimit')} />
            </div>
          )}
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-800">Professional tax (P6)</legend>
          <Checkbox label="Professional tax applies" checked={f.ptEnabled} onChange={set('ptEnabled')} />
          {f.ptEnabled && (
            <>
              <Input label="State" value={f.ptState} onChange={set('ptState')} className="max-w-32" />
              <div className="space-y-2">
                {f.slabs.map((sl, i) => (
                  <div key={i} className="grid grid-cols-[repeat(4,1fr)_auto] items-end gap-2">
                    <Input label={i === 0 ? 'Gross from (₹)' : undefined} aria-label={`Slab ${i + 1} from`} value={sl.from} onChange={slabField(i, 'from')} />
                    <Input label={i === 0 ? 'to (₹, blank = no limit)' : undefined} aria-label={`Slab ${i + 1} to`} value={sl.to} onChange={slabField(i, 'to')} />
                    <Input label={i === 0 ? 'PT per month (₹)' : undefined} aria-label={`Slab ${i + 1} monthly`} value={sl.monthly} onChange={slabField(i, 'monthly')} />
                    <Input label={i === 0 ? 'February (₹, optional)' : undefined} aria-label={`Slab ${i + 1} February`} value={sl.february} onChange={slabField(i, 'february')} />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove slab ${i + 1}`}
                      onClick={() =>
                        setF((x) => ({
                          ...x,
                          slabs: x.slabs.filter((_, j) => j !== i),
                        }))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="secondary" size="sm" onClick={() => setF((x) => ({ ...x, slabs: [...x.slabs, emptySlab] }))}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Add slab
                </Button>
              </div>
            </>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Gratuity provision % of basic (P8)" inputMode="decimal" hint="Employer cost inside CTC; 0 = not provisioned" value={f.gratuity} onChange={set('gratuity')} />
          <Checkbox label="Unexplained absence counts as loss of pay" checked={f.includeAbsence} onChange={set('includeAbsence')} />
        </div>
        <Textarea label="Notes (source of these figures)" value={f.notes} onChange={set('notes')} />
      </div>
    </Modal>
  );
}

export function PayrollSettingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const q = useRuleSets();
  const { activateRules, verifyRules } = usePayrollMutations();
  const [editing, setEditing] = useState(null);
  const [verifying, setVerifying] = useState(null);
  const [reference, setReference] = useState('');
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const draft = q.data.find((r) => r.status === 'draft');
  return (
    <>
      <PageHeader
        title="Payroll settings"
        description="Versioned rules for PF, ESI, professional tax and the salary template. Active versions are locked; changes create a new version."
        actions={
          can('payroll:rules:manage') &&
          !draft && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" aria-hidden="true" /> New version
            </Button>
          )
        }
      />
      <div className="mb-6">
        <Alert tone="info">
          <span className="inline-flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" /> Senova applies these figures; it does not know the law. Have them confirmed by your CA before finalizing real payroll, then record the confirmation here.
          </span>
        </Alert>
      </div>
      {q.data.length === 0 && (
        <Card>
          <EmptyState title="No payroll rules yet" description="Create the first version to start defining salaries." />
        </Card>
      )}
      <div className="space-y-4">
        {q.data.map((r) => (
          <Card key={r.id}>
            <CardHeader
              title={`Version ${r.version} · from ${formatMonth(r.effectiveFrom)}`}
              description={r.notes || undefined}
              actions={
                <>
                  <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status === 'active' ? 'Active' : 'Draft'}</Badge>
                  {r.verification ? (
                    <Badge tone="success">
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Verified
                    </Badge>
                  ) : (
                    <Badge tone="warning">Not verified</Badge>
                  )}
                  {r.status === 'draft' && can('payroll:rules:manage') && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          activateRules.mutateAsync(r.id).then(
                            () => toast.success('Activated'),
                            (e) => toast.error(e.message),
                          )
                        }
                      >
                        Activate
                      </Button>
                    </>
                  )}
                  {can('payroll:finalize') && !r.verification && (
                    <Button size="sm" variant="secondary" onClick={() => setVerifying(r)}>
                      Record verification
                    </Button>
                  )}
                </>
              }
            />
            <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">Salary template</dt>
                <dd>
                  Basic {r.template.basicPercentOfGross}% of gross · HRA {r.template.hraPercentOfBasic}% of basic
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">PF</dt>
                <dd>{r.pf.enabled ? `${r.pf.employeePercent}% / ${r.pf.employerPercent}% (EPS ${r.pf.epsPercent}%) up to ${formatINR(r.pf.wageCeiling)}` : 'Off'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">ESI</dt>
                <dd>{r.esi.enabled ? `${r.esi.employeePercent}% / ${r.esi.employerPercent}% up to ${formatINR(r.esi.wageLimit)} gross` : 'Off'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Professional tax</dt>
                <dd>{r.pt.enabled ? `${r.pt.state}: ${r.pt.slabs.length} slab(s)` : 'Off'}</dd>
              </div>
            </dl>
            {r.verification && (
              <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                Verified by {r.verification.verifiedByName} on {formatDateTime(r.verification.verifiedAt)}: “{r.verification.reference}”
              </p>
            )}
          </Card>
        ))}
      </div>
      {editing && <RuleEditor rules={editing === 'new' ? q.data[0] && { ...q.data[0], status: 'copy' } : editing} onClose={() => setEditing(null)} />}
      {verifying && (
        <Modal
          open
          onClose={() => setVerifying(null)}
          title={`Verify rules v${verifying.version}`}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setVerifying(null)}>
                Cancel
              </Button>
              <Button
                disabled={reference.trim().length < 5}
                loading={verifyRules.isPending}
                onClick={() =>
                  verifyRules.mutateAsync({ id: verifying.id, reference }).then(
                    () => (toast.success('Verification recorded'), setVerifying(null), setReference('')),
                    (e) => toast.error(e.message),
                  )
                }
              >
                Record
              </Button>
            </>
          }
        >
          <Textarea label="Who confirmed these values, and how?" hint='e.g. "ABC & Co (CA), email of 12 Oct 2026"' value={reference} onChange={(e) => setReference(e.target.value)} />
        </Modal>
      )}
    </>
  );
}

// Reports

const lastMonths = (n) => {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i += 1) {
    const x = new Date(Date.UTC(d.getFullYear(), d.getMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
};

const LINE_TYPE = { earning: 'Earning', deduction: 'Deduction', employer: 'Employer cost', rounding: 'Rounding' };
const BAR = '#3459ad'; // validated against the light surface (dataviz validator)

function HistoryTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-overlay">
      <p className="font-semibold text-slate-900">{formatMonth(p.month)}</p>
      <p className="text-slate-600">Net pay {formatINR(p.net)}</p>
      <p className="text-slate-600">Employer cost {formatINR(p.employerCost)}</p>
      <p className="text-slate-500">{p.employees} employees</p>
    </div>
  );
}

export function ReportsPage() {
  const months = lastMonths(12);
  const [month, setMonth] = useState(months[1]);
  const report = useMonthReport(month);
  const history = useHistoryReport(months.at(-1), months[0]);
  const [view, setView] = useState('chart');
  const r = report.data;
  return (
    <>
      <PageHeader
        title="Payroll reports"
        description="Finalized payroll only: what was actually paid."
        actions={
          <Select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-48">
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </Select>
        }
      />
      {report.isLoading ? (
        <PageLoader />
      ) : report.error ? (
        <ErrorState error={report.error} />
      ) : (
        <div className="space-y-6">
          {r.finalizedRuns === 0 && (
            <Alert tone="info">
              Nothing finalized for {formatMonth(month)} yet
              {r.regularRunStatus ? ` (regular run is ${r.regularRunStatus.replace('_', ' ')})` : ''}.
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ['Employees paid', r.totals.employees],
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
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="By component" />
              <DataTable
                caption="Payroll by component"
                rowKey="code"
                columns={[
                  { key: 'label', header: 'Component' },
                  { key: 'type', header: 'Type', render: (c) => LINE_TYPE[c.type] ?? c.type },
                  {
                    key: 'amount',
                    header: 'Amount',
                    className: 'text-right tabular-nums',
                    render: (c) => formatINR(c.amount),
                  },
                ]}
                rows={r.components}
                empty={<EmptyState title="No data" />}
              />
            </Card>
            <Card>
              <CardHeader title="By department" />
              <DataTable
                caption="Payroll by department"
                rowKey="department"
                columns={[
                  { key: 'department', header: 'Department' },
                  { key: 'employees', header: 'People' },
                  {
                    key: 'gross',
                    header: 'Gross',
                    className: 'text-right tabular-nums',
                    render: (d) => formatINR(d.gross),
                  },
                  {
                    key: 'employerCost',
                    header: 'Employer cost',
                    className: 'text-right tabular-nums',
                    render: (d) => formatINR(d.employerCost),
                  },
                ]}
                rows={r.departments}
                empty={<EmptyState title="No data" />}
              />
            </Card>
          </div>
        </div>
      )}
      <Card className="mt-6">
        <CardHeader
          title="Net pay by month"
          description="Last 12 months, finalized payroll"
          actions={
            <Tabs
              label="History view"
              value={view}
              onChange={setView}
              tabs={[
                { value: 'chart', label: 'Chart' },
                { value: 'table', label: 'Table' },
              ]}
            />
          }
        />
        <div className="p-5">
          {history.isLoading ? (
            <PageLoader />
          ) : !history.data?.length ? (
            <EmptyState title="No finalized payroll in this period" />
          ) : view === 'chart' ? (
            <div className="h-64" role="img" aria-label="Bar chart of net pay per month; switch to the table view for exact values">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={history.data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tickFormatter={(m) => formatMonth(m).slice(0, 3)} tick={{ fill: '#64748b', fontSize: 12 }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                  <YAxis tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`} tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} width={56} />
                  <Tooltip content={<HistoryTooltip />} cursor={{ fill: '#f1f5f9' }} />
                  <Bar dataKey="net" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <DataTable
              caption="Net pay by month"
              rowKey="month"
              columns={[
                {
                  key: 'month',
                  header: 'Month',
                  render: (h) => formatMonth(h.month),
                },
                { key: 'employees', header: 'Employees' },
                {
                  key: 'gross',
                  header: 'Gross',
                  className: 'text-right tabular-nums',
                  render: (h) => formatINR(h.gross),
                },
                {
                  key: 'net',
                  header: 'Net pay',
                  className: 'text-right tabular-nums',
                  render: (h) => formatINR(h.net),
                },
                {
                  key: 'employerCost',
                  header: 'Employer cost',
                  className: 'text-right tabular-nums',
                  render: (h) => formatINR(h.employerCost),
                },
              ]}
              rows={history.data}
            />
          )}
        </div>
      </Card>
    </>
  );
}
