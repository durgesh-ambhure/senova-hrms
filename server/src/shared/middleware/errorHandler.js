import mongoose from 'mongoose';
import { AppError } from '../errors.js';
import { logger } from '../../config/logger.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
}

/** Maps known errors to safe responses. Unknown errors are logged and reported generically. */
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let body = { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again later.' };

  if (err instanceof AppError) {
    status = err.status;
    body = { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    body = { code: 'BAD_REQUEST', message: 'Malformed JSON body' };
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    body = { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    body = { code: 'BAD_REQUEST', message: `Invalid value for ${err.path}` };
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 422;
    body = {
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    };
  } else if (err?.code === 11000) {
    status = 409;
    body = { code: 'CONFLICT', message: 'A record with the same unique value already exists' };
  }

  const log = req.log ?? logger;
  if (status >= 500) log.error({ err }, 'Unhandled error');

  res.status(status).json({ error: { ...body, requestId: req.id } });
}
