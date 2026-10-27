import clsx from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Spinner } from './Spinner.jsx';
import { EmptyState, ErrorState } from './States.jsx';

/**
 * Server-driven table. `sort` uses the API convention ("name" / "-name").
 * columns: [{ key, header, render?(row), sortable?, className? }]
 */
export function DataTable({ columns, rows, rowKey = 'id', isLoading, isFetching, error, onRetry, sort, onSortChange, empty, caption }) {
  const toggleSort = (key) => onSortChange?.(sort === key ? `-${key}` : key);

  return (
    <div className="relative">
      {isFetching && !isLoading && (
        <div className="absolute right-3 top-3 text-brand-600" aria-hidden="true">
          <Spinner className="h-4 w-4" />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-slate-50">
            <tr>
              {columns.map((col) => {
                const active = sort === col.key || sort === `-${col.key}`;
                const Icon = !active ? ArrowUpDown : sort.startsWith('-') ? ArrowDown : ArrowUp;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={clsx('whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500', col.className)}
                    aria-sort={active ? (sort.startsWith('-') ? 'descending' : 'ascending') : undefined}
                  >
                    {col.sortable ? (
                      <button type="button" onClick={() => toggleSort(col.key)} className="inline-flex items-center gap-1 uppercase hover:text-slate-800">
                        {col.header}
                        <Icon className={clsx('h-3.5 w-3.5', !active && 'opacity-40')} aria-hidden="true" />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {!isLoading &&
              !error &&
              rows?.map((row) => (
                <tr key={row[rowKey]} className="hover:bg-slate-50/70">
                  {columns.map((col) => (
                    <td key={col.key} className={clsx('px-4 py-3 align-middle text-slate-700', col.className)}>
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {isLoading && (
        <div className="flex justify-center py-12 text-brand-700">
          <Spinner className="h-6 w-6" label="Loading" />
        </div>
      )}
      {error && !isLoading && <ErrorState error={error} onRetry={onRetry} />}
      {!isLoading && !error && rows?.length === 0 && (empty ?? <EmptyState title="Nothing here yet" />)}
    </div>
  );
}

export function Pagination({ meta, onPageChange }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600" aria-label="Pagination">
      <p>
        Showing <span className="font-medium text-slate-900">{from}</span>–<span className="font-medium text-slate-900">{to}</span> of{' '}
        <span className="font-medium text-slate-900">{meta.total}</span>
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-40"
          onClick={() => onPageChange(meta.page - 1)}
          disabled={meta.page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-2">
          Page {meta.page} of {meta.totalPages}
        </span>
        <button
          type="button"
          className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-40"
          onClick={() => onPageChange(meta.page + 1)}
          disabled={meta.page >= meta.totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
