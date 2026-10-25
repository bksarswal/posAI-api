import type { Request, Response, NextFunction } from 'express';
import { Error as MongooseError } from 'mongoose';
import { ZodError } from 'zod';
import { AppError, TenantScopingError } from '../utils/appError.js';
import { sendError } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * Centralized error-handling middleware.
 * Formats AppError, Mongoose/MongoDB errors, Zod validation errors,
 * and unexpected internal errors with sendError.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): Response {
  // 1. TenantScopingError (programmer bug / safety violation):
  // Log at error level, never leak internal tenant details or query message to the client.
  if (err instanceof TenantScopingError) {
    logger.error(
      { err, method: req.method, url: req.originalUrl },
      `Tenant scoping violation: ${err.message}`,
    );
    return sendError(res, {
      statusCode: 500,
      message: 'Internal server error',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }

  // 2. Controlled application error
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(
        { err, method: req.method, url: req.originalUrl },
        err.message,
      );
    }

    return sendError(res, {
      statusCode: err.statusCode,
      message: err.message,
      code: err.code,
      errors: err.details,
    });
  }

  // 3. Zod schema validation errors
  if (err instanceof ZodError) {
    const fieldErrors = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));

    return sendError(res, {
      statusCode: 400,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors: fieldErrors,
    });
  }

  // 4. Mongoose schema validation errors
  if (err instanceof MongooseError.ValidationError) {
    const fieldErrors = Object.values(err.errors).map((item) => ({
      field: item.path,
      message: item.message,
    }));

    return sendError(res, {
      statusCode: 400,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors: fieldErrors,
    });
  }

  // 5. Mongoose CastError (e.g. invalid ObjectId)
  if (err instanceof MongooseError.CastError) {
    return sendError(res, {
      statusCode: 400,
      message: `Invalid identifier provided for ${err.path}`,
      code: 'INVALID_ID',
    });
  }

  // 6. MongoDB duplicate key error (code 11000):
  // Generic 409 response; never expose keyValue, index names, or collection names.
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as Record<string, unknown>)['code'] === 11000
  ) {
    logger.warn(
      { err, method: req.method, url: req.originalUrl },
      'Duplicate resource conflict (Mongo 11000)',
    );
    return sendError(res, {
      statusCode: 409,
      message: 'A resource with the specified identifier already exists',
      code: 'DUPLICATE_RESOURCE',
    });
  }

  // 7. Unknown or unhandled error
  logger.error(
    { err, method: req.method, url: req.originalUrl },
    'Unhandled server error',
  );

  const message =
    env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err instanceof Error
        ? err.message
        : 'Internal server error';

  return sendError(res, {
    statusCode: 500,
    message,
    code: 'INTERNAL_SERVER_ERROR',
  });
}
