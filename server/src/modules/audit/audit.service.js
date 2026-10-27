import { AuditLog } from './auditLog.model.js';
import { escapeRegex, paginate } from '../../shared/pagination.js';

/**
 * Records an audit event. `changes` must only contain non-secret fields; callers pass explicit
 * before/after values for the fields they changed. `actor` defaults to the signed-in user and is
 * only passed when the actor is known but not signed in (login, password reset by link).
 */
export async function recordAudit(req, { action, entityType, entityId, summary, changes, actor }, session) {
  const user = actor ?? req?.auth?.user;
  const doc = {
    actor: user?._id ?? null,
    actorName: user?.name ?? null,
    action,
    entityType,
    entityId: entityId ? String(entityId) : null,
    summary,
    changes,
    ip: req?.ip ?? null,
    userAgent: req?.get?.('user-agent')?.slice(0, 300) ?? null,
    requestId: req?.id ? String(req.id) : null,
  };
  await AuditLog.create([doc], session ? { session } : undefined);
}

/** Builds `{ field: { from, to } }` for the allowlisted fields that actually changed. */
export function diffFields(before, after, fields) {
  const changes = {};
  for (const field of fields) {
    const from = before?.[field];
    const to = after?.[field];
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  }
  return changes;
}

export async function listAuditLogs({ page, limit, sort, search, entityType, action, actor, from, to }) {
  const filter = {};
  if (entityType) filter.entityType = entityType;
  if (action) filter.action = action;
  if (actor) filter.actor = actor;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }
  if (search) filter.summary = { $regex: escapeRegex(search), $options: 'i' };
  const { items, meta } = await paginate(AuditLog, filter, { page, limit, sort });
  return {
    items: items.map((l) => ({
      id: String(l._id),
      actor: l.actor ? String(l.actor) : null,
      actorName: l.actorName,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      summary: l.summary,
      changes: l.changes,
      ip: l.ip,
      createdAt: l.createdAt,
    })),
    meta,
  };
}
