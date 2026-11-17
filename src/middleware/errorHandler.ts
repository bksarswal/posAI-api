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
  // Strip query string so tokens or sensitive parameters are never logged
  const path = (req.originalUrl || req.url || '').split('?')[0];

  // 1. TenantScopingError (programmer bug / safety violation):
  // Log at error level with full error stack; never leak internal details to client.
  if (err instanceof TenantScopingError) {
    logger.error(
      { err, method: req.method, path },
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
      logger.error({ err, method: req.method, path }, err.message);
    } else {
      logger.warn(
        {
          code: err.code,
          message: err.message,
          statusCode: err.statusCode,
          method: req.method,
          path,
        },
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

  // 3. Zod schema validation errors (4xx at warn: code + message)
  if (err instanceof ZodError) {
    logger.warn(
      {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        method: req.method,
        path,
      },
      'Validation failed',
    );

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

  // 4. Mongoose schema validation errors (4xx at warn: code + message)
  if (err instanceof MongooseError.ValidationError) {
    logger.warn(
      {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        method: req.method,
        path,
      },
      'Validation failed',
    );

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

  // 5. Mongoose CastError (4xx at warn: code + message)
  if (err instanceof MongooseError.CastError) {
    logger.warn(
      {
        code: 'INVALID_ID',
        message: `Invalid identifier provided for ${err.path}`,
        method: req.method,
        path,
      },
      `Invalid identifier provided for ${err.path}`,
    );

    return sendError(res, {
      statusCode: 400,
      message: `Invalid identifier provided for ${err.path}`,
      code: 'INVALID_ID',
    });
  }

  // 6. MongoDB duplicate key error (code 11000, 4xx at warn: code + message, never leak raw keyValue/err)
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as Record<string, unknown>)['code'] === 11000
  ) {
    logger.warn(
      {
        code: 'DUPLICATE_RESOURCE',
        message: 'A resource with the specified identifier already exists',
        method: req.method,
        path,
      },
      'Duplicate resource conflict',
    );
    return sendError(res, {
      statusCode: 409,
      message: 'A resource with the specified identifier already exists',
      code: 'DUPLICATE_RESOURCE',
    });
  }

  // 7. Unknown or unhandled error (5xx with full stack at error level)
  logger.error({ err, method: req.method, path }, 'Unhandled server error');

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
