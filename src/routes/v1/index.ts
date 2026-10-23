import { Router } from 'express';
import { getOpenAPIDocument } from '../../config/openapi.js';

const v1Router = Router();

// Serve the OpenAPI specification as JSON
v1Router.get('/docs/openapi.json', (_req, res) => {
  const document = getOpenAPIDocument();
  res.json(document);
});

// Single location where future feature module routers are registered:
// v1Router.use('/auth', authRouter);
// v1Router.use('/restaurants', restaurantRouter);

export { v1Router };
