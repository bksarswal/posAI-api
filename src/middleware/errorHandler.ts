import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/appError.js';
import { sendError } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * Centralized error-handling middleware.
 * Formats AppError, Zod validation errors, and unexpected internal errors with sendError.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): Response {
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

  // Unknown or unhandled error
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
