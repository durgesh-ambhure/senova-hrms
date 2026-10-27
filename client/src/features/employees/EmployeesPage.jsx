import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Search, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useDepartments, useDesignations, useEmployees } from './api.js';
import { Badge, Card, DataTable, EmptyState, PageHeader, Pagination, buttonClass } from '../../components/ui/index.js';
import { useDebouncedValue } from '../../lib/useDebouncedValue.js';
import { EMPLOYMENT_TYPES, LIFECYCLE } from '../../lib/labels.js';
import { formatDate, initials } from '../../lib/format.js';

const selectCls = 'h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

export function LifecycleBadge({ status }) {
  const s = LIFECYCLE[status] ?? { label: status, tone: 'neutral' };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function EmployeesPage() {
  const { can } = useAuth();
  const canAll = can('employees:read:all');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebouncedValue(search.trim());
  const departments = useDepartments();
  const designations = useDesignations();

  const query = {
    page: Number(params.get('page') ?? 1),
    limit: 20,
    sort: params.get('sort') ?? 'fullName',
    search: debounced,
    department: params.get('department') ?? '',
    designation: params.get('designation') ?? '',
    employmentType: params.get('employmentType') ?? '',
    status: params.get('status') ?? '',
    includeArchived: canAll && params.get('includeArchived') === 'true' ? 'true' : '',
  };
  const employees = useEmployees(query);

  const setParam = (key, value) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    });

  const columns = [
    {
      key: 'fullName',
      header: 'Employee',
      sortable: true,
      render: (e) => (
        <Link to={`/employees/${e.id}`} className="group flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{initials(e.fullName)}</span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-slate-900 group-hover:text-brand-700">{e.fullName}</span>
            <span className="block truncate text-xs text-slate-500">{e.workEmail}</span>
          </span>
        </Link>
      ),
    },
    { key: 'employeeCode', header: 'Code', sortable: true, className: 'whitespace-nowrap tabular-nums' },
    {
      key: 'department',
      header: 'Department · Designation',
      render: (e) => (
        <div>
          <p className="text-slate-800">{e.department?.name}</p>
          <p className="text-xs text-slate-500">{e.designation?.title}</p>
        </div>
      ),
    },
    { key: 'reportingManager', header: 'Manager', render: (e) => e.reportingManager?.fullName ?? <span className="text-slate-400">—</span> },
    { key: 'employmentType', header: 'Type', render: (e) => EMPLOYMENT_TYPES[e.employmentType] },
    { key: 'joiningDate', header: 'Joined', sortable: true, className: 'whitespace-nowrap', render: (e) => formatDate(e.joiningDate) },
    {
      key: 'status',
      header: 'Status',
      render: (e) => (
        <div className="flex flex-wrap gap-1">
          <LifecycleBadge status={e.lifecycleStatus} />
          {e.archived && <Badge>Archived</Badge>}
        </div>
      ),
    },
  ];

  const filtered = Boolean(query.search || query.department || query.designation || query.employmentType || query.status);

  return (
    <>
      <PageHeader
        title={canAll ? 'Employees' : 'My team'}
        description={canAll ? 'Everyone in the company directory.' : 'People who report to you, directly or indirectly.'}
        actions={
          can('employees:manage') && (
            <Link to="/employees/new" className={buttonClass()}>
              <UserPlus className="h-4 w-4" aria-hidden="true" /> Add employee
            </Link>
          )
        }
      />
      <Card>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_repeat(4,1fr)]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setParam('page', '');
              }}
              placeholder="Search name, code or email"
              aria-label="Search employees"
              className={`${selectCls} w-full pl-9`}
            />
          </div>
          <select aria-label="Filter by department" value={query.department} onChange={(e) => setParam('department', e.target.value)} className={selectCls}>
            <option value="">All departments</option>
            {departments.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select aria-label="Filter by designation" value={query.designation} onChange={(e) => setParam('designation', e.target.value)} className={selectCls}>
            <option value="">All designations</option>
            {designations.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <select aria-label="Filter by employment type" value={query.employmentType} onChange={(e) => setParam('employmentType', e.target.value)} className={selectCls}>
            <option value="">All types</option>
            {Object.entries(EMPLOYMENT_TYPES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select aria-label="Filter by status" value={query.status} onChange={(e) => setParam('status', e.target.value)} className={selectCls}>
            <option value="">All statuses</option>
            {Object.entries(LIFECYCLE).map(([v, { label }]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          {canAll && (
            <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2 lg:col-span-5">
              <input type="checkbox" checked={query.includeArchived === 'true'} onChange={(e) => setParam('includeArchived', e.target.checked ? 'true' : '')} className="accent-brand-700" />
              Include archived records
            </label>
          )}
        </div>
        <DataTable
          caption="Employees"
          columns={columns}
          rows={employees.data?.data}
          isLoading={employees.isLoading}
          isFetching={employees.isFetching}
          error={employees.error}
          onRetry={employees.refetch}
          sort={query.sort}
          onSortChange={(s) => setParam('sort', s)}
          empty={
            <EmptyState
              icon={Users}
              title={filtered ? 'No employees match these filters' : canAll ? 'No employees yet' : 'No one reports to you yet'}
              description={filtered ? 'Try a different search or clear the filters.' : canAll ? 'Add your first employee to build the directory.' : undefined}
            />
          }
        />
        <Pagination meta={employees.data?.meta} onPageChange={(p) => setParam('page', String(p))} />
      </Card>
    </>
  );
}
