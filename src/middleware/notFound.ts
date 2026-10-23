import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';

/**
 * 404 Not Found middleware.
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  _next: NextFunction,
): Response {
  return sendError(res, {
    statusCode: 404,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    code: 'NOT_FOUND',
  });
}
