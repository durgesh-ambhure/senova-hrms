import { useRef, useState } from 'react';
import { CheckCircle2, Download, FileText, Trash2, Upload, XCircle } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useDocumentMutations, useDocuments } from '../employees/api.js';
import { download } from '../../lib/api.js';
import { DOCUMENT_CATEGORIES, DOCUMENT_STATUS } from '../../lib/labels.js';
import { formatDateTime } from '../../lib/format.js';
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Input, Modal, Select, Spinner, Textarea, useToast } from '../../components/ui/index.js';

const MAX_MB = 10;
const ACCEPT = 'application/pdf,image/jpeg,image/png';
const formatSize = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

/** Upload dialog. `task` pre-fills the category and links the document to an onboarding task. */
export function UploadDocumentModal({ employeeId, open, onClose, task }) {
  const toast = useToast();
  const { upload } = useDocumentMutations(employeeId);
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState(task?.documentCategory ?? 'identity');
  const [title, setTitle] = useState('');
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const close = () => {
    setFile(null);
    setTitle('');
    setError(null);
    onClose();
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!file) return setError('Choose a file to upload');
    if (!ACCEPT.split(',').includes(file.type)) return setError('Only PDF, JPEG and PNG files are accepted');
    if (file.size > MAX_MB * 1024 * 1024) return setError(`Files must be ${MAX_MB} MB or smaller`);
    const form = new FormData();
    form.append('employeeId', employeeId);
    form.append('category', task?.documentCategory ?? category);
    if (title.trim()) form.append('title', title.trim());
    if (task) form.append('onboardingTaskId', task.id);
    form.append('file', file);
    try {
      await upload.mutateAsync(form);
      toast.success('Document uploaded');
      close();
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={task ? `Upload for: ${task.title}` : 'Upload document'}
      description={`PDF, JPEG or PNG, up to ${MAX_MB} MB.`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="upload-form" loading={upload.isPending}>
            Upload
          </Button>
        </>
      }
    >
      <form id="upload-form" onSubmit={submit} noValidate className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">File</span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-1 rounded-lg border-2 border-dashed border-slate-300 px-4 py-6 text-sm text-slate-600 hover:border-brand-400 hover:bg-brand-50/40"
          >
            <Upload className="h-5 w-5 text-brand-600" aria-hidden="true" />
            {file ? (
              <span className="font-medium text-slate-900">
                {file.name} · {formatSize(file.size)}
              </span>
            ) : (
              'Choose a file'
            )}
          </button>
          <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" aria-label="Document file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        {!task && (
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(DOCUMENT_CATEGORIES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        )}
        <Input label="Title" placeholder="Defaults to the file name" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} />
      </form>
    </Modal>
  );
}

function ReviewModal({ doc, employeeId, onClose }) {
  const toast = useToast();
  const { review } = useDocumentMutations(employeeId);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const decide = async (decision) => {
    setError(null);
    if (decision === 'rejected' && reason.trim().length < 3) return setError('Tell the employee why the document was rejected');
    try {
      await review.mutateAsync({ id: doc.id, decision, reason: reason.trim() || undefined });
      toast.success(decision === 'verified' ? 'Document verified' : 'Document rejected');
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Review document"
      description={`${doc.title} · ${DOCUMENT_CATEGORIES[doc.category]}`}
      size="sm"
      footer={
        <>
          <Button variant="danger" onClick={() => decide('rejected')} loading={review.isPending}>
            Reject
          </Button>
          <Button onClick={() => decide('verified')} loading={review.isPending}>
            Verify
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Button variant="secondary" size="sm" onClick={() => download(`/documents/${doc.id}/download`, doc.fileName).catch((e) => setError(e.message))}>
          <Download className="h-4 w-4" aria-hidden="true" /> Download to check
        </Button>
        <Textarea label="Reason (required to reject)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </div>
    </Modal>
  );
}

export function DocumentsPanel({ employee, isSelf }) {
  const { can } = useAuth();
  const toast = useToast();
  const canManage = can('documents:manage');
  const docs = useDocuments(employee.id);
  const { remove } = useDocumentMutations(employee.id);
  const [uploading, setUploading] = useState(false);
  const [reviewing, setReviewing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const doDelete = async () => {
    try {
      await remove.mutateAsync(deleting.id);
      toast.success('Document removed');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Documents"
        description="Stored privately. Downloads are recorded in the audit log."
        actions={
          !employee.archived && (
            <Button size="sm" onClick={() => setUploading(true)}>
              <Upload className="h-4 w-4" aria-hidden="true" /> Upload
            </Button>
          )
        }
      />
      {docs.isLoading ? (
        <div className="flex justify-center py-10 text-brand-700">
          <Spinner label="Loading documents" />
        </div>
      ) : docs.error ? (
        <ErrorState error={docs.error} onRetry={docs.refetch} />
      ) : docs.data.length === 0 ? (
        <EmptyState icon={FileText} title="No documents yet" description="Identity, address and education proofs uploaded here are reviewed by HR." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {docs.data.map((d) => {
            const status = DOCUMENT_STATUS[d.status];
            const canDelete = canManage || (isSelf && d.status !== 'verified');
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <FileText className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{d.title}</p>
                  <p className="text-xs text-slate-500">
                    {DOCUMENT_CATEGORIES[d.category]} · {formatSize(d.size)} · uploaded by {d.uploadedByName} {formatDateTime(d.createdAt)}
                  </p>
                  {d.status === 'rejected' && d.rejectionReason && <p className="mt-0.5 text-xs text-red-600">Rejected: {d.rejectionReason}</p>}
                </div>
                <Badge tone={status.tone}>
                  {d.status === 'verified' ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> : d.status === 'rejected' ? <XCircle className="h-3 w-3" aria-hidden="true" /> : null}
                  {status.label}
                </Badge>
                <div className="flex items-center gap-1">
                  {canManage && !isSelf && d.status === 'pending' && (
                    <Button variant="secondary" size="sm" onClick={() => setReviewing(d)}>
                      Review
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" aria-label={`Download ${d.title}`} onClick={() => download(`/documents/${d.id}/download`, d.fileName).catch((e) => toast.error(e.message))}>
                    <Download className="h-4 w-4" />
                  </Button>
                  {canDelete && (
                    <Button variant="ghost" size="sm" aria-label={`Remove ${d.title}`} onClick={() => setDeleting(d)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <UploadDocumentModal employeeId={employee.id} open={uploading} onClose={() => setUploading(false)} />
      {reviewing && <ReviewModal doc={reviewing} employeeId={employee.id} onClose={() => setReviewing(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove document"
        description={`Remove “${deleting?.title}”? HR can still see it in the audit trail.`}
        confirmLabel="Remove"
        tone="danger"
        loading={remove.isPending}
        onConfirm={doDelete}
        onClose={() => setDeleting(null)}
      />
    </Card>
  );
}
