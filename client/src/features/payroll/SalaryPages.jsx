import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { previewSalary, useEmployeeSalary, usePayrollMutations, useSalaries } from './api.js';
import { useDebouncedValue } from '../../lib/useDebouncedValue.js';
import { formatDate, formatINR, localToday } from '../../lib/format.js';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, DataTable, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Pagination, Textarea, useToast } from '../../components/ui/index.js';

export function BreakdownTable({ breakdown }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Monthly salary breakdown</caption>
      <tbody className="divide-y divide-slate-100">
        {breakdown.components.map((c) => (
          <tr key={c.code}>
            <td className="py-1.5 text-slate-700">{c.label}</td>
            <td className="py-1.5 text-right tabular-nums">{formatINR(c.monthly)}</td>
          </tr>
        ))}
        <tr className="font-semibold">
          <td className="py-1.5">Gross per month</td>
          <td className="py-1.5 text-right tabular-nums">{formatINR(breakdown.gross)}</td>
        </tr>
        <tr className="text-slate-500">
          <td className="py-1.5">
            Employer PF{breakdown.employer.esi ? ' + ESI' : ''}
            {breakdown.employer.gratuity ? ' + gratuity' : ''}
          </td>
          <td className="py-1.5 text-right tabular-nums">{formatINR(breakdown.employer.pf + breakdown.employer.esi + breakdown.employer.gratuity)}</td>
        </tr>
        <tr className="text-slate-500">
          <td className="py-1.5">CTC per month</td>
          <td className="py-1.5 text-right tabular-nums">{formatINR(breakdown.ctcMonthly)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function RevisionModal({ employee, onClose }) {
  const toast = useToast();
  const { addRevision } = usePayrollMutations();
  const [form, setForm] = useState({
    effectiveFrom: localToday(),
    annualCtc: '',
    basicPercentOfGross: '',
    hraPercentOfBasic: '',
    pfApplicable: true,
    pfOnFullWage: false,
    reason: '',
  });
  const [preview, setPreview] = useState(null);
  const key = useDebouncedValue(JSON.stringify(form), 400);
  const set = (k) => (e) =>
    setForm((f) => ({
      ...f,
      [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }));
  const body = (f) => ({
    effectiveFrom: f.effectiveFrom,
    annualCtc: f.annualCtc,
    basicPercentOfGross: f.basicPercentOfGross === '' ? null : f.basicPercentOfGross,
    hraPercentOfBasic: f.hraPercentOfBasic === '' ? null : f.hraPercentOfBasic,
    pfApplicable: f.pfApplicable,
    pfOnFullWage: f.pfOnFullWage,
    reason: f.reason,
  });
  useEffect(() => {
    const f = JSON.parse(key);
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(f.annualCtc)) return;
    const { reason: _r, ...b } = body(f);
    previewSalary(b).then(
      (p) => setPreview({ ok: true, ...p }),
      (err) =>
        setPreview({
          ok: false,
          message: err.details?.[0]?.message ?? err.message,
        }),
    );
  }, [key]);
  const save = async () => {
    try {
      await addRevision.mutateAsync({ employeeId: employee.id, ...body(form) });
      toast.success(form.effectiveFrom < localToday() ? 'Revision saved. Arrears for paid months will appear in the next payroll run.' : 'Revision saved');
      onClose();
    } catch (err) {
      toast.error(err.details?.[0]?.message ?? err.message);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`New salary revision for ${employee.fullName}`}
      description="Basic and HRA follow the company template unless you override them (P3)."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={addRevision.isPending} disabled={!preview?.ok || !preview.breakdown.valid}>
            Save revision
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <Input label="Effective from" type="date" min={employee.joiningDate} value={form.effectiveFrom} onChange={set('effectiveFrom')} hint="A past date creates arrears for months already paid (P12)" />
          <Input label="Annual CTC (₹)" inputMode="decimal" value={form.annualCtc} onChange={set('annualCtc')} required />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Basic % of gross" inputMode="decimal" placeholder="Template" value={form.basicPercentOfGross} onChange={set('basicPercentOfGross')} />
            <Input label="HRA % of basic" inputMode="decimal" placeholder="Template" value={form.hraPercentOfBasic} onChange={set('hraPercentOfBasic')} />
          </div>
          <Checkbox label="PF applies" checked={form.pfApplicable} onChange={set('pfApplicable')} />
          <Checkbox label="PF on full wage (employee opted in above the ceiling)" checked={form.pfOnFullWage} onChange={set('pfOnFullWage')} disabled={!form.pfApplicable} />
          <Textarea label="Reason" rows={2} value={form.reason} onChange={set('reason')} />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">
            Monthly breakdown
            {preview?.ok ? ` (rules v${preview.ruleVersion})` : ''}
          </h3>
          {!preview && <p className="text-sm text-slate-500">Enter a CTC to see the breakdown.</p>}
          {preview && !preview.ok && <Alert>{preview.message}</Alert>}
          {preview?.ok && (
            <>
              {!preview.breakdown.valid && <Alert>{preview.breakdown.problem}</Alert>}
              <BreakdownTable breakdown={preview.breakdown} />
              {preview.breakdown.esiApplicable && <p className="mt-2 text-xs text-slate-500">Within the ESI wage limit.</p>}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Salary history for one employee. Used on the salary page and the employee profile. */
export function SalaryHistory({ employeeId }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const q = useEmployeeSalary(employeeId);
  const { deleteRevision } = usePayrollMutations();
  const [adding, setAdding] = useState(false);
  if (q.isLoading) return <PageLoader label="Loading salary" />;
  if (q.error) return <ErrorState error={q.error} />;
  const { employee, revisions, currentRevision } = q.data;
  // Nobody revises their own pay; the API enforces this too.
  const canManage = can('payroll:salary:manage') && employeeId !== 'me' && employeeId !== user.employee;
  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New revision
          </Button>
        </div>
      )}
      {revisions.length === 0 ? (
        <Card>
          <EmptyState icon={Wallet} title="No salary defined" description={canManage ? 'Add the joining salary to include this employee in payroll.' : undefined} />
        </Card>
      ) : (
        revisions.map((r) => (
          <Card key={r.id}>
            <CardHeader
              title={`${formatINR(r.annualCtc)} per year`}
              description={`Revision #${r.revisionNo} · effective ${formatDate(r.effectiveFrom)}${r.reason ? ` · ${r.reason}` : ''} · by ${r.createdByName}`}
              actions={
                <>
                  {r.id === currentRevision && <Badge tone="success">Current</Badge>}
                  {r.pfOnFullWage && <Badge>PF on full wage</Badge>}
                  {!r.pfApplicable && <Badge>No PF</Badge>}
                  {canManage && !r.arrearsSettled && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete revision ${r.revisionNo}`}
                      onClick={() =>
                        deleteRevision
                          .mutateAsync({
                            employeeId: employee.id,
                            revisionId: r.id,
                          })
                          .then(
                            () => toast.success('Revision deleted'),
                            (e) => toast.error(e.message),
                          )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </>
              }
            />
            <div className="p-5">
              <BreakdownTable breakdown={r.breakdown} />
            </div>
          </Card>
        ))
      )}
      {adding && <RevisionModal employee={employee} onClose={() => setAdding(false)} />}
    </div>
  );
}

export function SalariesPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim());
  const [page, setPage] = useState(1);
  const missing = params.get('missing') === 'true';
  const q = useSalaries({
    search: debounced || undefined,
    missing: missing ? 'true' : undefined,
    page,
    limit: 20,
  });
  const columns = [
    {
      key: 'employee',
      header: 'Employee',
      render: (r) => (
        <Link to={`/payroll/salaries/${r.employee.id}`} className="block">
          <span className="block font-medium text-slate-900 hover:text-brand-700">{r.employee.fullName}</span>
          <span className="block text-xs text-slate-500">
            {r.employee.employeeCode} · {r.employee.designation}
          </span>
        </Link>
      ),
    },
    {
      key: 'department',
      header: 'Department',
      render: (r) => r.employee.department,
    },
    {
      key: 'ctc',
      header: 'Annual CTC',
      className: 'text-right tabular-nums',
      render: (r) => (r.annualCtc === null ? <Badge tone="warning">Not set</Badge> : formatINR(r.annualCtc)),
    },
    {
      key: 'from',
      header: 'Effective from',
      className: 'whitespace-nowrap',
      render: (r) => formatDate(r.effectiveFrom),
    },
    { key: 'revisions', header: 'Revisions', render: (r) => r.revisionCount },
  ];
  return (
    <>
      <PageHeader title="Salaries" description="Effective-dated salary structures. Confidential: visible to payroll staff only." />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <input type="search" aria-label="Search employees" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} placeholder="Search name or code" className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm" />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" className="accent-brand-700" checked={missing} onChange={(e) => setParams(e.target.checked ? { missing: 'true' } : {})} /> Only without a salary
          </label>
        </div>
        <DataTable
          caption="Salaries"
          rowKey="key"
          columns={columns}
          rows={q.data?.data.map((r) => ({ ...r, key: r.employee.id }))}
          isLoading={q.isLoading}
          error={q.error}
          onRetry={q.refetch}
          empty={<EmptyState icon={Wallet} title="No employees found" />}
        />
        <Pagination meta={q.data?.meta} onPageChange={setPage} />
      </Card>
    </>
  );
}

export function SalaryDetailPage() {
  const { employeeId } = useParams();
  const q = useEmployeeSalary(employeeId);
  return (
    <>
      <PageHeader title={q.data ? `${q.data.employee.fullName} · salary` : 'Salary'} description={q.data ? `${q.data.employee.employeeCode} · joined ${formatDate(q.data.employee.joiningDate)}` : undefined} />
      <SalaryHistory employeeId={employeeId} />
    </>
  );
}
