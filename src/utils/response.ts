import type { Response } from 'express';

export interface SuccessResponseOptions<T = unknown> {
  statusCode?: number;
  message: string;
  data?: T;
  meta?: Record<string, unknown>;
}

export interface ErrorResponseOptions {
  statusCode?: number;
  message: string;
  code?: string;
  errors?: unknown;
}

export interface SuccessResponseBody<T = unknown> {
  success: true;
  message: string;
  data?: T;
  meta?: Record<string, unknown>;
}

export interface ErrorResponseBody {
  success: false;
  message: string;
  code: string;
  errors?: unknown;
}

/**
 * Sends a standardized success response.
 */
export function sendSuccess<T>(
  res: Response,
  { statusCode = 200, message, data, meta }: SuccessResponseOptions<T>,
): Response {
  const body: SuccessResponseBody<T> = {
    success: true,
    message,
    ...(data !== undefined ? { data } : {}),
    ...(meta !== undefined ? { meta } : {}),
  };
  return res.status(statusCode).json(body);
}

/**
 * Sends a standardized error response.
 */
export function sendError(
  res: Response,
  {
    statusCode = 500,
    message,
    code = 'INTERNAL_ERROR',
    errors,
  }: ErrorResponseOptions,
): Response {
  const body: ErrorResponseBody = {
    success: false,
    message,
    code,
    ...(errors !== undefined ? { errors } : {}),
  };
  return res.status(statusCode).json(body);
}
