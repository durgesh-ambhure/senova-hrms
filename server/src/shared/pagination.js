import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;

/**
 * Builds a zod schema for list query params. `sortFields` is an allowlist so clients cannot sort
 * (and thereby probe) on arbitrary or sensitive fields.
 */
export function listQuerySchema(sortFields, extra = {}, defaultSort = sortFields[0]) {
  const sortValues = sortFields.flatMap((f) => [f, `-${f}`]);
  // Strict: unknown params (typos, `field[$ne]` style operator attempts) are rejected, not ignored.
  return z.strictObject({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
    sort: z.enum(sortValues).default(defaultSort),
    search: z.string().trim().max(100).optional(),
    ...extra,
  });
}

export function toMongoSort(sort) {
  return sort.startsWith('-') ? { [sort.slice(1)]: -1, _id: -1 } : { [sort]: 1, _id: 1 };
}

export async function paginate(model, filter, { page, limit, sort }, { select, populate } = {}) {
  let query = model
    .find(filter)
    .sort(toMongoSort(sort))
    .skip((page - 1) * limit)
    .limit(limit);
  if (select) query = query.select(select);
  if (populate) query = query.populate(populate);
  const [items, total] = await Promise.all([query.lean(), model.countDocuments(filter)]);
  return { items, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

/** Escapes user input for use inside a RegExp (search boxes). */
export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
