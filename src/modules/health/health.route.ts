import { Router } from 'express';
import * as HealthController from './health.controller.js';
import { openApiRegistry } from '../../config/openapi.js';
import {
  healthSuccessResponseSchema,
  healthErrorResponseSchema,
} from './health.validation.js';

const router = Router();

// OpenAPI route registration
openApiRegistry.registerPath({
  method: 'get',
  path: '/health',
  summary: 'Health check',
  description: 'Returns server uptime and database connection state',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Service is healthy',
      content: {
        'application/json': {
          schema: healthSuccessResponseSchema,
        },
      },
    },
    503: {
      description: 'Database is disconnected',
      content: {
        'application/json': {
          schema: healthErrorResponseSchema,
        },
      },
    },
  },
});

router.get('/health', HealthController.getHealth);

export { router as healthRouter };
