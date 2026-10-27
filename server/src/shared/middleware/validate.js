import { validationError } from '../errors.js';

const formatIssues = (issues, location) =>
  issues.map((i) => ({ in: location, path: i.path.join('.'), message: i.message }));

/**
 * Validates request parts with zod and replaces them with the parsed values, so unknown keys are
 * stripped before they reach a controller (mass-assignment protection). The parsed query is stored
 * on req.validatedQuery because Express 5 exposes req.query as a read-only getter.
 */
export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    const issues = [];
    if (params) {
      const r = params.safeParse(req.params);
      if (r.success) req.params = r.data;
      else issues.push(...formatIssues(r.error.issues, 'params'));
    }
    if (query) {
      const r = query.safeParse(req.query);
      if (r.success) req.validatedQuery = r.data;
      else issues.push(...formatIssues(r.error.issues, 'query'));
    }
    if (body) {
      const r = body.safeParse(req.body ?? {});
      if (r.success) req.body = r.data;
      else issues.push(...formatIssues(r.error.issues, 'body'));
    }
    return next(issues.length ? validationError(issues) : undefined);
  };
}
