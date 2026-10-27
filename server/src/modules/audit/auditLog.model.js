import mongoose from 'mongoose';

/** Append-only record of sensitive actions. There are no update or delete endpoints. */
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: null },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, default: null },
    summary: { type: String, maxlength: 500, default: '' },
    changes: { type: mongoose.Schema.Types.Mixed, default: undefined },
    ip: { type: String, default: null },
    userAgent: { type: String, maxlength: 300, default: null },
    requestId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
