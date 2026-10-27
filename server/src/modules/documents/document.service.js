import crypto from 'node:crypto';
import { EmployeeDocument } from './document.model.js';
import { Employee } from '../employees/employee.model.js';
import { OnboardingTask } from '../onboarding/onboardingTask.model.js';
import { hasPermission } from '../roles/permissions.js';
import { recordAudit } from '../audit/audit.service.js';
import { storage } from '../../shared/storage.js';
import { conflict, forbidden, notFound, validationError } from '../../shared/errors.js';

const canManage = (req) => hasPermission(req.auth.permissions, 'documents:manage');
const isOwn = (req, employeeId) => req.auth.user.employee && String(req.auth.user.employee) === String(employeeId);

/**
 * Documents can contain identity and financial data, so access is narrow: HR document managers,
 * and the employee themself. Managers and other readers of the profile do not get documents.
 */
function assertEmployeeAccess(req, employeeId) {
  if (canManage(req)) return;
  if (isOwn(req, employeeId) && hasPermission(req.auth.permissions, 'self:profile')) return;
  throw notFound('Employee not found');
}

export function toPublicDocument(d) {
  return {
    id: String(d._id),
    employee: String(d.employee),
    category: d.category,
    title: d.title,
    fileName: d.fileName,
    mimeType: d.mimeType,
    size: d.size,
    status: d.status,
    reviewedByName: d.reviewedByName,
    reviewedAt: d.reviewedAt,
    rejectionReason: d.rejectionReason,
    onboardingTask: d.onboardingTask ? String(d.onboardingTask) : null,
    uploadedByName: d.uploadedByName,
    createdAt: d.createdAt,
  };
}

export async function listDocuments(req, { employee, status }) {
  assertEmployeeAccess(req, employee);
  const filter = { employee, deletedAt: null };
  if (status) filter.status = status;
  const items = await EmployeeDocument.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  return items.map(toPublicDocument);
}

export async function uploadDocument(req, { employeeId, category, title, onboardingTaskId }) {
  assertEmployeeAccess(req, employeeId);
  const employee = await Employee.findOne({ _id: employeeId, archivedAt: null }, { fullName: 1 }).lean();
  if (!employee) throw notFound('Employee not found');

  let task = null;
  if (onboardingTaskId) {
    task = await OnboardingTask.findOne({ _id: onboardingTaskId, employee: employeeId }).lean();
    if (!task) throw validationError([{ in: 'body', path: 'onboardingTaskId', message: 'Task not found for this employee' }]);
    if (task.status !== 'pending') throw conflict('This task is already closed');
  }

  const { buffer, detectedMimeType, safeName } = req.file;
  const storageKey = await storage.put(buffer, { prefix: `employees/${employeeId}` });
  let doc;
  try {
    doc = await EmployeeDocument.create({
      employee: employeeId,
      category,
      title: title || safeName,
      fileName: safeName,
      mimeType: detectedMimeType,
      size: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      storageKey,
      onboardingTask: task?._id ?? null,
      uploadedBy: req.auth.user._id,
      uploadedByName: req.auth.user.name,
    });
  } catch (err) {
    await storage.remove(storageKey);
    throw err;
  }
  if (task) await OnboardingTask.updateOne({ _id: task._id }, { $set: { document: doc._id } });
  await recordAudit(req, {
    action: 'document.uploaded',
    entityType: 'Employee',
    entityId: employeeId,
    summary: `Uploaded ${category.replace('_', ' ')} document "${doc.title}" for ${employee.fullName}`,
  });
  return toPublicDocument(doc.toObject());
}

async function findAccessible(req, id, { withKey = false } = {}) {
  const query = EmployeeDocument.findOne({ _id: id, deletedAt: null });
  if (withKey) query.select('+storageKey');
  const doc = await query.lean();
  if (!doc) throw notFound('Document not found');
  try {
    assertEmployeeAccess(req, doc.employee);
  } catch {
    throw notFound('Document not found');
  }
  return doc;
}

export async function openDownload(req, id) {
  const doc = await findAccessible(req, id, { withKey: true });
  await recordAudit(req, { action: 'document.downloaded', entityType: 'Employee', entityId: doc.employee, summary: `Downloaded "${doc.title}"` });
  return { doc, stream: storage.createReadStream(doc.storageKey) };
}

export async function reviewDocument(req, id, { decision, reason }) {
  const doc = await EmployeeDocument.findOne({ _id: id, deletedAt: null });
  if (!doc) throw notFound('Document not found');
  // Separation of duties: nobody verifies their own documents.
  if (isOwn(req, doc.employee)) throw forbidden('You cannot verify your own documents');
  if (doc.status !== 'pending') throw conflict(`This document is already ${doc.status}`);
  doc.status = decision;
  doc.rejectionReason = decision === 'rejected' ? reason : '';
  doc.reviewedBy = req.auth.user._id;
  doc.reviewedByName = req.auth.user.name;
  doc.reviewedAt = new Date();
  await doc.save();
  // A rejected document no longer satisfies its onboarding task.
  if (decision === 'rejected' && doc.onboardingTask) {
    await OnboardingTask.updateOne({ _id: doc.onboardingTask, document: doc._id, status: 'pending' }, { $set: { document: null } });
  }
  await recordAudit(req, {
    action: `document.${decision}`,
    entityType: 'Employee',
    entityId: doc.employee,
    summary: `${decision === 'verified' ? 'Verified' : 'Rejected'} "${doc.title}"${reason ? `: ${reason}` : ''}`,
  });
  return toPublicDocument(doc.toObject());
}

export async function deleteDocument(req, id) {
  const doc = await EmployeeDocument.findOne({ _id: id, deletedAt: null });
  if (!doc) throw notFound('Document not found');
  const manager = canManage(req);
  if (!manager) {
    if (!isOwn(req, doc.employee)) throw notFound('Document not found');
    if (doc.status === 'verified') throw forbidden('Verified documents can only be removed by HR');
  }
  doc.deletedAt = new Date();
  await doc.save();
  if (doc.onboardingTask) await OnboardingTask.updateOne({ _id: doc.onboardingTask, document: doc._id, status: 'pending' }, { $set: { document: null } });
  await recordAudit(req, { action: 'document.deleted', entityType: 'Employee', entityId: doc.employee, summary: `Removed "${doc.title}"` });
}
