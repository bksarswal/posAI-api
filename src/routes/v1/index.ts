import { Router } from 'express';
import { getOpenAPIDocument } from '../../config/openapi.js';
import {
  createAuthRouter,
  type AuthRateLimitOptions,
} from '../../modules/auth/index.js';
import { userRouter } from '../../modules/user/index.js';
import { restaurantRouter } from '../../modules/restaurant/index.js';
import { branchRouter } from '../../modules/branch/index.js';

export interface V1RouterOptions {
  rateLimits?: AuthRateLimitOptions;
}

/**
 * Builds the /api/v1 router mounting all feature modules.
 */
export function createV1Router(options?: V1RouterOptions): Router {
  const router = Router();

  // Serve the OpenAPI specification as JSON
  router.get('/docs/openapi.json', (_req, res) => {
    const document = getOpenAPIDocument();
    res.json(document);
  });

  // Feature module routers
  router.use('/auth', createAuthRouter(options?.rateLimits));
  router.use('/users', userRouter);
  router.use('/restaurant', restaurantRouter);
  router.use('/branches', branchRouter);

  return router;
}

export const v1Router = createV1Router();
