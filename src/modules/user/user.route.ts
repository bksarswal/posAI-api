import { Router } from 'express';
import * as UserController from './user.controller.js';
import { getMeResponseDataSchema } from './user.validation.js';
import { authenticate } from '../../middleware/authenticate.js';
import {
  openApiRegistry,
  SuccessResponseSchema,
  ErrorResponseSchema,
} from '../../config/openapi.js';

const getMeEnvelopeSchema = SuccessResponseSchema.extend({
  data: getMeResponseDataSchema,
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

export const userRouter = Router();

userRouter.get('/me', authenticate, UserController.getMe);
