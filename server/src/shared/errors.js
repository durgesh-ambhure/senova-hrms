export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = 'Bad request', details) => new AppError(400, 'BAD_REQUEST', message, details);
export const validationError = (details, message = 'Validation failed') =>
  new AppError(422, 'VALIDATION_ERROR', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message = 'Conflict', details) => new AppError(409, 'CONFLICT', message, details);
