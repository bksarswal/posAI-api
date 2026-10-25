import { Router } from 'express';
import * as AuthController from './auth.controller.js';
import {
  signupSchema,
  signupSuccessResponseSchema,
} from './auth.validation.js';
import { validateBody } from '../../middleware/validate.js';
import {
  createRateLimiter,
  ipKeyGenerator,
} from '../../middleware/rateLimit.js';
import { openApiRegistry, ErrorResponseSchema } from '../../config/openapi.js';

export interface AuthRateLimitOptions {
  signupIp?: { windowMs?: number; max?: number };
  signupIpEmail?: { windowMs?: number; max?: number };
}

// Register OpenAPI path for POST /api/v1/auth/signup
openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/signup',
  summary: 'Register new Tenant and Owner',
  description:
    'Creates a new tenant and initial OWNER user account. Fails with 409 if email is already registered.',
  tags: ['Auth'],
  request: {
    body: {
      description: 'Account signup information',
      content: {
        'application/json': {
          schema: signupSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Tenant and OWNER account created successfully',
      content: {
        'application/json': {
          schema: signupSuccessResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation failed or disallowed fields present',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Email is already registered',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    429: {
      description: 'Rate limit exceeded',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * Builds the Auth router with configured rate limiters.
 */
export function createAuthRouter(rateLimits?: AuthRateLimitOptions): Router {
  const router = Router();

  // 1. IP-level rate limiter: 10 per hour default
  const signupIpLimiter = createRateLimiter({
    windowMs: rateLimits?.signupIp?.windowMs ?? 60 * 60 * 1000,
    max: rateLimits?.signupIp?.max ?? 10,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? '127.0.0.1'),
    message: 'Too many signup attempts from this IP. Please try again later.',
  });

  // 2. Composite IP+email rate limiter: 3 per hour default
  const signupIpEmailLimiter = createRateLimiter({
    windowMs: rateLimits?.signupIpEmail?.windowMs ?? 60 * 60 * 1000,
    max: rateLimits?.signupIpEmail?.max ?? 3,
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req.ip ?? '127.0.0.1');
      let email = '';
      if (
        typeof req.body === 'object' &&
        req.body !== null &&
        typeof (req.body as Record<string, unknown>)['email'] === 'string'
      ) {
        email = ((req.body as Record<string, unknown>)['email'] as string)
          .trim()
          .toLowerCase();
      }
      return `${ip}:${email}`;
    },
    message:
      'Too many signup attempts for this email address. Please try again later.',
  });

  router.post(
    '/signup',
    signupIpLimiter,
    signupIpEmailLimiter,
    validateBody(signupSchema),
    AuthController.signup,
  );

  return router;
}

export const authRouter = createAuthRouter();
