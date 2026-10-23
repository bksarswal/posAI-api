import fs from 'node:fs';
import { z } from 'zod';
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';
import { env } from './env.js';

// Extend Zod prototypes with .openapi() metadata methods
extendZodWithOpenApi(z);

export const openApiRegistry = new OpenAPIRegistry();

// Register JWT Bearer Security Scheme
openApiRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'JWT Bearer token for API authentication',
});

// Standard Success Response Component
export const SuccessResponseSchema = openApiRegistry.register(
  'SuccessResponse',
  z.object({
    success: z.literal(true),
    message: z.string(),
    data: z.unknown().optional(),
  }),
);

// Standard Error Response Component
export const ErrorResponseSchema = openApiRegistry.register(
  'ErrorResponse',
  z.object({
    success: z.literal(false),
    message: z.string(),
    code: z.string(),
    errors: z.unknown().optional(),
  }),
);

export type OpenAPIDocument = ReturnType<
  OpenApiGeneratorV31['generateDocument']
>;

/**
 * Builds and returns the OpenAPI 3.1 document for the application.
 */
export function getOpenAPIDocument(): OpenAPIDocument {
  const packageJson = JSON.parse(
    fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string; description?: string };

  const generator = new OpenApiGeneratorV31(openApiRegistry.definitions);

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'POSAI API',
      version: packageJson.version,
      description: packageJson.description ?? 'POSAI Restaurant POS SaaS API',
    },
    servers: [
      {
        url: `http://localhost:${env.PORT}`,
        description: 'Local development server',
      },
    ],
  });
}
