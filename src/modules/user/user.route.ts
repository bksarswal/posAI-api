import { Router } from 'express';
import * as UserController from './user.controller.js';
import {
  getMeResponseDataSchema,
  createStaffSchema,
  updateStaffSchema,
  updateMeSchema,
  createStaffResponseSchema,
  resetPasswordResponseSchema,
  paginatedUsersResponseSchema,
  userResponseSchema,
} from './user.validation.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
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
import { z } from 'zod';

export interface UserRateLimitOptions {
  resetPassword?: { windowMs?: number; max?: number };
}

const getMeEnvelopeSchema = SuccessResponseSchema.extend({
  data: getMeResponseDataSchema,
});

const userEnvelopeSchema = SuccessResponseSchema.extend({
  data: z.object({
    user: userResponseSchema,
  }),
});

const createStaffEnvelopeSchema = SuccessResponseSchema.extend({
  data: createStaffResponseSchema,
});

const resetPasswordEnvelopeSchema = SuccessResponseSchema.extend({
  data: resetPasswordResponseSchema,
});

const paginatedUsersEnvelopeSchema = SuccessResponseSchema.extend({
  data: paginatedUsersResponseSchema,
  meta: z
    .object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      totalPages: z.number(),
    })
    .optional(),
});

// Register OpenAPI path for GET /api/v1/users/me
openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/users/me',
  summary: 'Get current user and onboarding context',
  description:
    'Retrieves user profile, tenant info, restaurant profile, and accessible branches. Exempt from mustChangePassword gate. Accessible by all authenticated roles.',
  tags: ['Users'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'User profile and onboarding context retrieved successfully',
      content: {
        'application/json': {
          schema: getMeEnvelopeSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Register OpenAPI path for PATCH /api/v1/users/me
openApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/users/me',
  summary: 'Update own user profile',
  description:
    'Updates name or phone on own account. Blocked if mustChangePassword is true.',
  tags: ['Users'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      description: 'Self-update payload (strict name, phone)',
      content: {
        'application/json': {
          schema: updateMeSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Profile updated successfully',
      content: {
        'application/json': {
          schema: userEnvelopeSchema,
        },
      },
    },
    400: {
      description: 'Validation failed or uneditable fields provided',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden - Password change required',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Register OpenAPI path for POST /api/v1/users
openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/users',
  summary: 'Create staff user',
  description:
    'Creates a new staff user with temporary password. OWNER or ADMIN only. Returns 201 with Cache-Control: no-store.',
  tags: ['Users'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      description: 'Staff creation payload',
      content: {
        'application/json': {
          schema: createStaffSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Staff user created successfully',
      headers: {
        'Cache-Control': {
          description: 'Prevents credential caching',
          schema: { type: 'string', example: 'no-store' },
        },
      },
      content: {
        'application/json': {
          schema: createStaffEnvelopeSchema,
        },
      },
    },
    400: {
      description: 'Validation failed or invalid branch assignment',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden - Insufficient permissions',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Email already registered',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Register OpenAPI path for GET /api/v1/users
openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/users',
  summary: 'List staff users',
  description:
    'Lists staff users in the active tenant with pagination and filtering. OWNER or ADMIN only.',
  tags: ['Users'],
  security: [{ bearerAuth: [] }],
  parameters: [
    {
      name: 'page',
      in: 'query',
      required: false,
      schema: { type: 'integer', default: 1 },
    },
    {
      name: 'limit',
      in: 'query',
      required: false,
      schema: { type: 'integer', default: 20 },
    },
    {
      name: 'role',
      in: 'query',
      required: false,
      schema: {
        type: 'string',
        enum: ['OWNER', 'ADMIN', 'MANAGER', 'WAITER', 'CASHIER', 'CHEF'],
      },
    },
    {
      name: 'status',
      in: 'query',
      required: false,
      schema: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    },
    {
      name: 'branchId',
      in: 'query',
      required: false,
      schema: { type: 'string' },
    },
    {
      name: 'q',
      in: 'query',
      required: false,
      schema: { type: 'string' },
    },
  ],
  responses: {
    200: {
      description: 'Staff users list retrieved successfully',
      content: {
        'application/json': {
          schema: paginatedUsersEnvelopeSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden - Insufficient permissions',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Register OpenAPI path for GET /api/v1/users/{id}
openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/users/{id}',
  summary: 'Get staff user by ID',
  description:
    'Retrieves a staff user by ID within the active tenant. OWNER or ADMIN only.',
  tags: ['Users'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().describe('User MongoDB ObjectId'),
    }),
  },
  responses: {
    200: {
      description: 'Staff user retrieved successfully',
      content: {
        'application/json': {
          schema: userEnvelopeSchema,
        },
      },
    },
    400: {
      description: 'Invalid ObjectId parameter (INVALID_ID)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden - Insufficient permissions',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'User not found (USER_NOT_FOUND)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Register OpenAPI path for PATCH /api/v1/users/{id}
openApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/users/{id}',
  summary: 'Update staff user by ID',
  description:
    'Updates staff user fields and role. OWNER or ADMIN only. Deactivating yourself returns 409.',
  tags: ['Users'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().describe('User MongoDB ObjectId'),
    }),
    body: {
      description: 'Staff update payload (strict partial, non-empty)',
      content: {
        'application/json': {
          schema: updateStaffSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Staff user updated successfully',
      content: {
        'application/json': {
          schema: userEnvelopeSchema,
        },
      },
    },
    400: {
      description: 'Validation failed or invalid branch assignment',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden - Insufficient permissions',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'User not found (USER_NOT_FOUND)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Cannot deactivate yourself (CANNOT_DEACTIVATE_SELF)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Register OpenAPI path for POST /api/v1/users/{id}/reset-password
openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/users/{id}/reset-password',
  summary: 'Admin reset staff password',
  description:
    'Generates a new temporary password for a staff member. Returns 200 with Cache-Control: no-store. Rate limited.',
  tags: ['Users'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().describe('User MongoDB ObjectId'),
    }),
  },
  responses: {
    200: {
      description: 'Password reset successfully',
      headers: {
        'Cache-Control': {
          description: 'Prevents credential caching',
          schema: { type: 'string', example: 'no-store' },
        },
      },
      content: {
        'application/json': {
          schema: resetPasswordEnvelopeSchema,
        },
      },
    },
    400: {
      description: 'Invalid identifier (INVALID_ID)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden - Insufficient permissions',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'User not found (USER_NOT_FOUND)',
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

export function createUserRouter(rateLimits?: UserRateLimitOptions): Router {
  const router = Router();

  const resetPasswordLimiter = createRateLimiter({
    windowMs: rateLimits?.resetPassword?.windowMs ?? 15 * 60 * 1000,
    max: rateLimits?.resetPassword?.max ?? 20,
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req.ip ?? '127.0.0.1');
      const actorId = req.auth?.userId ?? 'anonymous';
      return `${ip}:${actorId}`;
    },
    message: 'Too many password reset attempts. Please try again later.',
  });

  router.get('/me', authenticate, UserController.getMe);

  router.patch(
    '/me',
    authenticate,
    validateBody(updateMeSchema),
    UserController.updateMe,
  );

  router.post(
    '/',
    authenticate,
    authorize('OWNER', 'ADMIN'),
    validateBody(createStaffSchema),
    UserController.createStaff,
  );

  router.get(
    '/',
    authenticate,
    authorize('OWNER', 'ADMIN'),
    UserController.listStaff,
  );

  router.get(
    '/:id',
    authenticate,
    authorize('OWNER', 'ADMIN'),
    UserController.getStaffById,
  );

  router.patch(
    '/:id',
    authenticate,
    authorize('OWNER', 'ADMIN'),
    validateBody(updateStaffSchema),
    UserController.updateStaff,
  );

  router.post(
    '/:id/reset-password',
    authenticate,
    authorize('OWNER', 'ADMIN'),
    resetPasswordLimiter,
    UserController.adminResetPassword,
  );

  return router;
}

export const userRouter = createUserRouter();
