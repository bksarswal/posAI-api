import { Router } from 'express';
import * as RestaurantController from './restaurant.controller.js';
import {
  createRestaurantSchema,
  updateRestaurantSchema,
  restaurantResponseSchema,
} from './restaurant.validation.js';
import { validateBody } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  openApiRegistry,
  SuccessResponseSchema,
  ErrorResponseSchema,
} from '../../config/openapi.js';
import { z } from 'zod';

const restaurantEnvelopeSchema = SuccessResponseSchema.extend({
  data: z.object({
    restaurant: restaurantResponseSchema,
  }),
});

// Register OpenAPI path for POST /api/v1/restaurant
openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/restaurant',
  summary: 'Create tenant restaurant',
  description:
    'Creates the single restaurant profile for the tenant. OWNER only. Returns 409 if a restaurant already exists.',
  tags: ['Restaurant'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      description: 'Restaurant creation payload',
      content: {
        'application/json': {
          schema: createRestaurantSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Restaurant created successfully',
      content: {
        'application/json': {
          schema: restaurantEnvelopeSchema,
        },
      },
    },
    400: {
      description: 'Validation failed or unexpected fields',
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
      description: 'Forbidden - OWNER role required',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Restaurant already exists for this tenant',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Register OpenAPI path for GET /api/v1/restaurant
openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/restaurant',
  summary: 'Get tenant restaurant',
  description:
    'Retrieves the restaurant profile for the active tenant. Accessible by any authenticated role. Returns 404 when none exists.',
  tags: ['Restaurant'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Restaurant retrieved successfully',
      content: {
        'application/json': {
          schema: restaurantEnvelopeSchema,
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
    404: {
      description: 'Restaurant not found for this tenant',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Register OpenAPI path for PATCH /api/v1/restaurant
openApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/restaurant',
  summary: 'Update tenant restaurant',
  description:
    'Updates restaurant profile fields. OWNER and ADMIN roles only. Empty body returns 400.',
  tags: ['Restaurant'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      description: 'Restaurant update payload (strict partial, non-empty)',
      content: {
        'application/json': {
          schema: updateRestaurantSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Restaurant updated successfully',
      content: {
        'application/json': {
          schema: restaurantEnvelopeSchema,
        },
      },
    },
    400: {
      description: 'Validation failed or empty body',
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
      description: 'Forbidden - OWNER or ADMIN role required',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Restaurant not found for this tenant',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

export const restaurantRouter = Router();

restaurantRouter.post(
  '/',
  authenticate,
  authorize('OWNER'),
  validateBody(createRestaurantSchema),
  RestaurantController.createRestaurant,
);

restaurantRouter.get('/', authenticate, RestaurantController.getRestaurant);

restaurantRouter.patch(
  '/',
  authenticate,
  authorize('OWNER', 'ADMIN'),
  validateBody(updateRestaurantSchema),
  RestaurantController.updateRestaurant,
);
