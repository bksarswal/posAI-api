import { Router } from 'express';
import * as AuthController from './auth.controller.js';
import {
  signupSchema,
  signupSuccessResponseSchema,
  loginSchema,
  loginSuccessResponseSchema,
  refreshSuccessResponseSchema,
  changePasswordSchema,
  changePasswordSuccessResponseSchema,
  authGenericSuccessResponseSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.validation.js';
import { validateBody } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
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
  refreshIp?: { windowMs?: number; max?: number };
  changePassword?: { windowMs?: number; max?: number };
  verifyEmailIp?: { windowMs?: number; max?: number };
  resendVerificationIp?: { windowMs?: number; max?: number };
  resendVerificationIpEmail?: { windowMs?: number; max?: number };
  forgotPasswordIp?: { windowMs?: number; max?: number };
  forgotPasswordIpEmail?: { windowMs?: number; max?: number };
  resetPasswordIp?: { windowMs?: number; max?: number };
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

// Register OpenAPI path for POST /api/v1/auth/refresh
openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/refresh',
  summary: 'Rotate refresh token',
  description:
    'Rotates refresh token atomically, issues a new access token, and sets a new HttpOnly refresh cookie.',
  tags: ['Auth'],
  responses: {
    200: {
      description: 'Token refreshed successfully',
      content: {
        'application/json': {
          schema: refreshSuccessResponseSchema,
        },
      },
    },
    401: {
      description: 'Invalid, expired, or reused refresh token',
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

// Register OpenAPI path for POST /api/v1/auth/change-password
openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/change-password',
  summary: 'Change password',
  description:
    'Allows authenticated user to change password. Invalidates all active refresh token families across all devices.',
  tags: ['Auth'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      description: 'Current and new password',
      content: {
        'application/json': {
          schema: changePasswordSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Password changed successfully',
      content: {
        'application/json': {
          schema: changePasswordSuccessResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid current password or validation failure',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized or token invalid',
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

// Register OpenAPI path for POST /api/v1/auth/verify-email
openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/verify-email',
  summary: 'Verify user email',
  description:
    'Atomically verifies user email address using single-use verification token.',
  tags: ['Auth'],
  request: {
    body: {
      description: 'Email verification token',
      content: {
        'application/json': {
          schema: verifyEmailSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Email verified successfully',
      content: {
        'application/json': {
          schema: authGenericSuccessResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid, used, or expired verification token',
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

// Register OpenAPI path for POST /api/v1/auth/resend-verification
openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/resend-verification',
  summary: 'Resend email verification',
  description:
    'Sends a new email verification link if the account exists and is unverified. 60-second cooldown per user.',
  tags: ['Auth'],
  request: {
    body: {
      description: 'User email address',
      content: {
        'application/json': {
          schema: resendVerificationSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Generic success message regardless of account existence',
      content: {
        'application/json': {
          schema: authGenericSuccessResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation failure',
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

// Register OpenAPI path for POST /api/v1/auth/forgot-password
openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/forgot-password',
  summary: 'Request password reset',
  description:
    'Sends password reset link if account exists and is ACTIVE. 60-second cooldown per user.',
  tags: ['Auth'],
  request: {
    body: {
      description: 'User email address',
      content: {
        'application/json': {
          schema: forgotPasswordSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Generic success message regardless of account existence',
      content: {
        'application/json': {
          schema: authGenericSuccessResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation failure',
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

// Register OpenAPI path for POST /api/v1/auth/reset-password
openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/reset-password',
  summary: 'Reset password with token',
  description:
    'Resets password using single-use reset token, updates email verification status, and invalidates all active sessions.',
  tags: ['Auth'],
  request: {
    body: {
      description: 'Reset token and new password',
      content: {
        'application/json': {
          schema: resetPasswordSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Password reset successfully',
      content: {
        'application/json': {
          schema: authGenericSuccessResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid, used, or expired reset token, or validation error',
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

  // 3. Refresh rate limiter: 60/15m per IP
  const refreshIpLimiter = createRateLimiter({
    windowMs: rateLimits?.refreshIp?.windowMs ?? 15 * 60 * 1000,
    max: rateLimits?.refreshIp?.max ?? 60,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? '127.0.0.1'),
    message: 'Too many refresh attempts from this IP. Please try again later.',
  });

  // 4. Change password rate limiter: 5/15m per IP+userId
  const changePasswordLimiter = createRateLimiter({
    windowMs: rateLimits?.changePassword?.windowMs ?? 15 * 60 * 1000,
    max: rateLimits?.changePassword?.max ?? 5,
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req.ip ?? '127.0.0.1');
      const userId = req.auth?.userId || 'anonymous';
      return `${ip}:${userId}`;
    },
    message: 'Too many password change attempts. Please try again later.',
  });

  // 5. Verify email rate limiter: 10/15m per IP
  const verifyEmailIpLimiter = createRateLimiter({
    windowMs: rateLimits?.verifyEmailIp?.windowMs ?? 15 * 60 * 1000,
    max: rateLimits?.verifyEmailIp?.max ?? 10,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? '127.0.0.1'),
    message:
      'Too many email verification attempts from this IP. Please try again later.',
  });

  // 6. Resend verification rate limiters: 20/hr per IP, 3/hr per IP+email
  const resendVerificationIpLimiter = createRateLimiter({
    windowMs: rateLimits?.resendVerificationIp?.windowMs ?? 60 * 60 * 1000,
    max: rateLimits?.resendVerificationIp?.max ?? 20,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? '127.0.0.1'),
    message:
      'Too many resend verification attempts from this IP. Please try again later.',
  });

  const resendVerificationIpEmailLimiter = createRateLimiter({
    windowMs: rateLimits?.resendVerificationIpEmail?.windowMs ?? 60 * 60 * 1000,
    max: rateLimits?.resendVerificationIpEmail?.max ?? 3,
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
      'Too many resend verification attempts for this email address. Please try again later.',
  });

  // 7. Forgot password rate limiters: 20/hr per IP, 3/hr per IP+email
  const forgotPasswordIpLimiter = createRateLimiter({
    windowMs: rateLimits?.forgotPasswordIp?.windowMs ?? 60 * 60 * 1000,
    max: rateLimits?.forgotPasswordIp?.max ?? 20,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? '127.0.0.1'),
    message:
      'Too many password reset requests from this IP. Please try again later.',
  });

  const forgotPasswordIpEmailLimiter = createRateLimiter({
    windowMs: rateLimits?.forgotPasswordIpEmail?.windowMs ?? 60 * 60 * 1000,
    max: rateLimits?.forgotPasswordIpEmail?.max ?? 3,
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
      'Too many password reset requests for this email address. Please try again later.',
  });

  // 8. Reset password rate limiter: 10/15m per IP
  const resetPasswordIpLimiter = createRateLimiter({
    windowMs: rateLimits?.resetPasswordIp?.windowMs ?? 15 * 60 * 1000,
    max: rateLimits?.resetPasswordIp?.max ?? 10,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? '127.0.0.1'),
    message:
      'Too many password reset attempts from this IP. Please try again later.',
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

  router.post('/refresh', refreshIpLimiter, AuthController.refresh);

  router.post(
    '/change-password',
    authenticate,
    changePasswordLimiter,
    validateBody(changePasswordSchema),
    AuthController.changePassword,
  );

  router.post(
    '/verify-email',
    verifyEmailIpLimiter,
    validateBody(verifyEmailSchema),
    AuthController.verifyEmail,
  );

  router.post(
    '/resend-verification',
    resendVerificationIpLimiter,
    resendVerificationIpEmailLimiter,
    validateBody(resendVerificationSchema),
    AuthController.resendVerification,
  );

  router.post(
    '/forgot-password',
    forgotPasswordIpLimiter,
    forgotPasswordIpEmailLimiter,
    validateBody(forgotPasswordSchema),
    AuthController.forgotPassword,
  );

  router.post(
    '/reset-password',
    resetPasswordIpLimiter,
    validateBody(resetPasswordSchema),
    AuthController.resetPassword,
  );

  return router;
}

export const authRouter = createAuthRouter();
