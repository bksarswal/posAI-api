import {
  rateLimit,
  ipKeyGenerator,
  type RateLimitRequestHandler,
} from 'express-rate-limit';
import type { Request, Response } from 'express';
import { sendError } from '../utils/response.js';

export interface CreateRateLimiterOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request, res: Response) => string | Promise<string>;
  message?: string;
}

/**
 * Factory for creating express-rate-limit middleware with standard POSAI error formatting.
 * Uses the default in-memory store (single instance). Multi-instance Redis store is planned for later sprints.
 */
export function createRateLimiter(
  options: CreateRateLimiterOptions,
): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: options.keyGenerator,
    handler: (_req, res) => {
      return sendError(res, {
        statusCode: 429,
        message: options.message ?? 'Too many requests, please try again later',
        code: 'RATE_LIMITED',
      });
    },
  });
}

export { ipKeyGenerator };
