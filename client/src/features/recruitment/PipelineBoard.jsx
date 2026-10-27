import { useState } from 'react';
import { Link } from 'react-router';
import { CalendarClock, MoreHorizontal } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useApplications } from './api.js';
import { MoveStageModal } from './RecruitmentModals.jsx';
import { ACTIVE_STAGE_KEYS, STAGES } from '../../lib/labels.js';
import { formatDateTime } from '../../lib/format.js';
import { ErrorState, Menu, PageLoader } from '../../components/ui/index.js';

/** Kanban of active applications for one job (or all jobs). Moves go through validated menus. */
export function PipelineBoard({ jobId, search }) {
  const { can } = useAuth();
  const canMove = can('recruitment:candidates:manage');
  const q = useApplications({ job: jobId, search: search || undefined, limit: 100 });
  const [moving, setMoving] = useState(null);
  if (q.isLoading) return <PageLoader label="Loading pipeline" />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const apps = q.data.data;
  const closed = apps.filter((a) => !ACTIVE_STAGE_KEYS.includes(a.stage));

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-3" role="list" aria-label="Pipeline">
        {ACTIVE_STAGE_KEYS.map((stage) => {
          const items = apps.filter((a) => a.stage === stage);
          return (
            <section key={stage} role="listitem" aria-label={`${STAGES[stage].label}: ${items.length}`} className="w-64 shrink-0 rounded-xl bg-slate-100/80 p-2">
              <h3 className="flex items-center justify-between px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {STAGES[stage].label}
                <span className="rounded-full bg-white px-2 py-0.5 text-slate-700">{items.length}</span>
              </h3>
              <ul className="mt-1 space-y-2">
                {items.map((a) => (
                  <li key={a.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-card">
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/recruitment/candidates/${a.candidate.id}`} className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900 hover:text-brand-700">{a.candidate.fullName}</p>
                        <p className="truncate text-xs text-slate-500">{a.candidate.currentTitle || '—'}{a.candidate.currentCompany ? ` · ${a.candidate.currentCompany}` : ''}</p>
                      </Link>
                      {canMove && a.allowedMoves.length > 0 && (
                        <Menu
                          label={`Move ${a.candidate.fullName}`}
                          items={a.allowedMoves.map((to) => ({ label: to === 'rejected' ? 'Reject…' : `Move to ${STAGES[to].label}`, danger: to === 'rejected', onSelect: () => setMoving({ application: a, to }) }))}
                          trigger={(props) => (
                            <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" {...props}>
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          )}
                        />
                      )}
                    </div>
                    {!jobId && <p className="mt-1 text-xs text-brand-700">{a.job.code} {a.job.title}</p>}
                    {a.interviews?.next && (
                      <p className="mt-1.5 flex items-center gap-1 text-xs text-accent-700">
                        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {formatDateTime(a.interviews.next)}
                      </p>
                    )}
                  </li>
                ))}
                {items.length === 0 && <li className="px-2 py-4 text-center text-xs text-slate-400">No one here</li>}
              </ul>
            </section>
          );
        })}
      </div>
      {closed.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Closed: {closed.filter((a) => a.stage === 'hired').length} hired · {closed.filter((a) => a.stage === 'rejected').length} rejected · {closed.filter((a) => a.stage === 'withdrawn').length} withdrawn
        </p>
      )}
      {moving && <MoveStageModal application={moving.application} to={moving.to} onClose={() => setMoving(null)} />}
    </>
  );
}
