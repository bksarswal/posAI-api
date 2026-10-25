import { Router } from 'express';
import * as AuthController from './auth.controller.js';
import {
  signupSchema,
  signupSuccessResponseSchema,
  loginSchema,
  loginSuccessResponseSchema,
} from './auth.validation.js';
import { validateBody } from '../../middleware/validate.js';
import {
  createRateLimiter,
  ipKeyGenerator,
} from '../../middleware/rateLimit.js';
import {
  openApiRegistry,
  SuccessResponseSchema,
  ErrorResponseSchema,
} from '../../config/openapi.js';

export interface AuthRateLimitOptions {
  signupIp?: { windowMs?: number; max?: number };
  signupIpEmail?: { windowMs?: number; max?: number };
  loginIp?: { windowMs?: number; max?: number };
  loginIpEmail?: { windowMs?: number; max?: number };
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

// Register OpenAPI path for POST /api/v1/auth/login
openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/login',
  summary: 'User login',
  description:
    'Authenticates user with email and password, issuing an access token and HttpOnly refresh cookie.',
  tags: ['Auth'],
  request: {
    body: {
      description: 'Login credentials',
      content: {
        'application/json': {
          schema: loginSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Login successful',
      content: {
        'application/json': {
          schema: loginSuccessResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation failed',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Invalid email or password',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Account disabled, email unverified, or tenant suspended',
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

// Register OpenAPI path for POST /api/v1/auth/logout
openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/logout',
  summary: 'User logout',
  description:
    'Revokes active refresh token family and clears HttpOnly refresh cookie. Idempotent.',
  tags: ['Auth'],
  responses: {
    200: {
      description: 'Logged out successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema,
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

  // 1. Signup rate limiters
  const signupIpLimiter = createRateLimiter({
    windowMs: rateLimits?.signupIp?.windowMs ?? 60 * 60 * 1000,
    max: rateLimits?.signupIp?.max ?? 10,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? '127.0.0.1'),
    message: 'Too many signup attempts from this IP. Please try again later.',
  });

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

  // 2. Login rate limiters: 50/15m per IP, 10/15m per IP+email
  const loginIpLimiter = createRateLimiter({
    windowMs: rateLimits?.loginIp?.windowMs ?? 15 * 60 * 1000,
    max: rateLimits?.loginIp?.max ?? 50,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? '127.0.0.1'),
    message: 'Too many login attempts from this IP. Please try again later.',
  });

  const loginIpEmailLimiter = createRateLimiter({
    windowMs: rateLimits?.loginIpEmail?.windowMs ?? 15 * 60 * 1000,
    max: rateLimits?.loginIpEmail?.max ?? 10,
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
      'Too many login attempts for this account. Please try again later.',
  });

  router.post(
    '/signup',
    signupIpLimiter,
    signupIpEmailLimiter,
    validateBody(signupSchema),
    AuthController.signup,
  );

  router.post(
    '/login',
    loginIpLimiter,
    loginIpEmailLimiter,
    validateBody(loginSchema),
    AuthController.login,
  );

  router.post('/logout', AuthController.logout);

  return router;
}

export const authRouter = createAuthRouter();
