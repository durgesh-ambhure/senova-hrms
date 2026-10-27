import { z } from 'zod';

function stripDefault(schema) {
  return schema instanceof z.ZodDefault ? stripDefault(schema.unwrap()) : schema;
}

/**
 * Builds a PATCH schema from a create schema: every field optional and — crucially — with create-time
 * defaults removed. (zod applies defaults inside `.partial()`/`.optional()`, which would silently reset
 * fields the client did not send.) Pass `extend` for update-only fields and `omit` for create-only ones.
 */
export function updateSchemaFrom(createSchema, { omit = [], extend = {} } = {}) {
  const shape = Object.fromEntries(
    Object.entries(createSchema.shape)
      .filter(([key]) => !omit.includes(key))
      .map(([key, field]) => [key, stripDefault(field).optional()]),
  );
  return z.object({ ...shape, ...Object.fromEntries(Object.entries(extend).map(([k, v]) => [k, v.optional()])) }).refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
}
