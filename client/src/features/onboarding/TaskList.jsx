import { useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Circle, CircleSlash, Paperclip, RotateCcw } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useOnboardingMutations } from './api.js';
import { UploadDocumentModal } from '../documents/DocumentsPanel.jsx';
import { ASSIGNEE_TYPES, DOCUMENT_CATEGORIES } from '../../lib/labels.js';
import { formatDate } from '../../lib/format.js';
import { Badge, Button, Modal, Textarea, useToast } from '../../components/ui/index.js';

function NoteModal({ title, confirmLabel, required, onConfirm, onClose, loading }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={loading}
            onClick={() => {
              if (required && note.trim().length < 2) return setError('Add a short note');
              onConfirm(note.trim());
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Textarea label={required ? 'Note' : 'Note (optional)'} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} error={error} data-autofocus />
    </Modal>
  );
}

/**
 * Checklist tasks with the actions the current user may take. The server re-checks every action;
 * `canAct(task)` here only decides which buttons to show.
 */
export function TaskList({ tasks, showEmployee = false, canAct }) {
  const { can } = useAuth();
  const toast = useToast();
  const isHr = can('onboarding:manage');
  const m = useOnboardingMutations();
  const [dialog, setDialog] = useState(null); // { kind: 'complete'|'waive'|'reopen'|'upload', task }

  const run = async (mutation, task, note, message) => {
    try {
      await mutation.mutateAsync({ id: task.id, note });
      toast.success(message);
      setDialog(null);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <ul className="divide-y divide-slate-100">
        {tasks.map((t) => {
          const Icon = t.status === 'completed' ? CheckCircle2 : t.status === 'waived' ? CircleSlash : Circle;
          const actionable = t.status === 'pending' && canAct(t);
          const needsDoc = t.documentCategory && !t.document;
          return (
            <li key={t.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${t.status === 'completed' ? 'text-accent-600' : t.status === 'waived' ? 'text-slate-400' : 'text-slate-300'}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${t.status === 'pending' ? 'text-slate-900' : 'text-slate-500 line-through decoration-slate-300'}`}>{t.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  {showEmployee && (
                    <Link to={`/employees/${t.employee.id}`} className="font-medium text-brand-700 hover:text-brand-900">
                      {t.employee.fullName}
                    </Link>
                  )}
                  <span>{ASSIGNEE_TYPES[t.assigneeType]}</span>
                  <span aria-hidden="true">·</span>
                  <span className={t.overdue ? 'font-medium text-red-600' : ''}>
                    {t.overdue ? 'Overdue — ' : 'Due '}
                    {formatDate(t.dueDate)}
                  </span>
                  {t.documentCategory && (
                    <Badge tone={t.document ? 'success' : 'neutral'}>
                      <Paperclip className="h-3 w-3" aria-hidden="true" />
                      {DOCUMENT_CATEGORIES[t.documentCategory]}
                      {t.document ? ' · uploaded' : ' required'}
                    </Badge>
                  )}
                </p>
                {t.status !== 'pending' && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    {t.status === 'completed' ? 'Completed' : 'Waived'} by {t.completedByName} {t.note && `— “${t.note}”`}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                {actionable && needsDoc && (
                  <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'upload', task: t })}>
                    <Paperclip className="h-4 w-4" aria-hidden="true" /> Upload
                  </Button>
                )}
                {actionable && (
                  <Button size="sm" disabled={needsDoc} title={needsDoc ? 'Upload the document first' : undefined} onClick={() => setDialog({ kind: 'complete', task: t })}>
                    Mark done
                  </Button>
                )}
                {isHr && t.status === 'pending' && (
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'waive', task: t })}>
                    Waive
                  </Button>
                )}
                {isHr && t.status !== 'pending' && (
                  <Button size="sm" variant="ghost" aria-label={`Reopen ${t.title}`} onClick={() => setDialog({ kind: 'reopen', task: t })}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {dialog?.kind === 'complete' && (
        <NoteModal title={`Complete “${dialog.task.title}”`} confirmLabel="Mark done" loading={m.complete.isPending} onClose={() => setDialog(null)} onConfirm={(note) => run(m.complete, dialog.task, note, 'Task completed')} />
      )}
      {dialog?.kind === 'waive' && (
        <NoteModal title={`Waive “${dialog.task.title}”`} confirmLabel="Waive task" required loading={m.waive.isPending} onClose={() => setDialog(null)} onConfirm={(note) => run(m.waive, dialog.task, note, 'Task waived')} />
      )}
      {dialog?.kind === 'reopen' && (
        <NoteModal title={`Reopen “${dialog.task.title}”`} confirmLabel="Reopen" loading={m.reopen.isPending} onClose={() => setDialog(null)} onConfirm={(note) => run(m.reopen, dialog.task, note, 'Task reopened')} />
      )}
      {dialog?.kind === 'upload' && <UploadDocumentModal open employeeId={dialog.task.employee.id} task={dialog.task} onClose={() => setDialog(null)} />}
    </>
  );
}
