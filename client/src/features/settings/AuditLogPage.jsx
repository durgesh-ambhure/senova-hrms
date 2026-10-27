import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { useAuditLogs } from './api.js';
import { Badge, Card, DataTable, EmptyState, Modal, PageHeader, Pagination } from '../../components/ui/index.js';
import { formatDateTime, humanize } from '../../lib/format.js';

const ENTITY_TYPES = ['User', 'Role', 'CompanySettings'];

function ChangesTable({ changes }) {
  const entries = Object.entries(changes ?? {});
  if (!entries.length) return <p className="text-sm text-slate-500">No field-level changes recorded.</p>;
  const show = (v) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs uppercase text-slate-500">
          <th className="py-1 pr-3">Field</th>
          <th className="py-1 pr-3">Before</th>
          <th className="py-1">After</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {entries.map(([field, { from, to }]) => (
          <tr key={field} className="align-top">
            <td className="py-2 pr-3 font-medium text-slate-800">{humanize(field)}</td>
            <td className="break-all py-2 pr-3 text-slate-500">{show(from)}</td>
            <td className="break-all py-2 text-slate-800">{show(to)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AuditLogPage() {
  const [filters, setFilters] = useState({ page: 1, entityType: '', from: '', to: '' });
  const [detail, setDetail] = useState(null);
  const query = {
    page: filters.page,
    limit: 25,
    sort: '-createdAt',
    entityType: filters.entityType,
    from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : '',
    to: filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : '',
  };
  const logs = useAuditLogs(query);
  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value, page: 1 }));

  const columns = [
    { key: 'createdAt', header: 'When', className: 'whitespace-nowrap', render: (l) => formatDateTime(l.createdAt) },
    { key: 'actorName', header: 'Who', render: (l) => l.actorName ?? <span className="text-slate-400">System</span> },
    { key: 'action', header: 'Action', render: (l) => <Badge tone="brand">{l.action}</Badge> },
    { key: 'summary', header: 'Summary', render: (l) => <span className="line-clamp-2">{l.summary}</span> },
    {
      key: 'details',
      header: <span className="sr-only">Details</span>,
      className: 'text-right',
      render: (l) => (
        <button type="button" onClick={() => setDetail(l)} className="text-sm font-medium text-brand-700 hover:text-brand-900">
          Details
        </button>
      ),
    },
  ];

  const inputCls = 'h-10 rounded-lg border border-slate-300 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sign-ins and administrative changes." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <label className="text-xs font-medium text-slate-600">
            Record type
            <select value={filters.entityType} onChange={set('entityType')} className={`${inputCls} mt-1 block w-full sm:w-48`}>
              <option value="">All</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            From
            <input type="date" value={filters.from} onChange={set('from')} className={`${inputCls} mt-1 block w-full`} />
          </label>
          <label className="text-xs font-medium text-slate-600">
            To
            <input type="date" value={filters.to} onChange={set('to')} min={filters.from || undefined} className={`${inputCls} mt-1 block w-full`} />
          </label>
        </div>
        <DataTable
          caption="Audit log entries"
          columns={columns}
          rows={logs.data?.data}
          isLoading={logs.isLoading}
          isFetching={logs.isFetching}
          error={logs.error}
          onRetry={logs.refetch}
          empty={<EmptyState icon={ScrollText} title="No entries for these filters" />}
        />
        <Pagination meta={logs.data?.meta} onPageChange={(page) => setFilters((f) => ({ ...f, page }))} />
      </Card>
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.summary ?? ''} description={detail ? `${detail.action} · ${formatDateTime(detail.createdAt)}` : ''} size="lg">
        {detail && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Actor</dt>
                <dd className="text-slate-800">{detail.actorName ?? 'System'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Record</dt>
                <dd className="break-all text-slate-800">
                  {detail.entityType} {detail.entityId}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">IP address</dt>
                <dd className="text-slate-800">{detail.ip ?? '—'}</dd>
              </div>
            </dl>
            <ChangesTable changes={detail.changes} />
          </div>
        )}
      </Modal>
    </>
  );
}
