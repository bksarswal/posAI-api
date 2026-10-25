import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { healthRouter } from './modules/health/index.js';
import { createV1Router } from './routes/v1/index.js';
import { notFoundHandler } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import type { AuthRateLimitOptions } from './modules/auth/index.js';

export interface RateLimitOverrides extends AuthRateLimitOptions {
  global?: { windowMs?: number; max?: number };
}

export interface AppOptions {
  rateLimits?: RateLimitOverrides;
}

/**
 * Builds and configures the Express application instance.
 * Accepts optional rate-limit overrides for integration testing.
 */
export function createApp(options: AppOptions = {}): Express {
  const app: Express = express();

  // Reverse proxy trust level (e.g. 1 behind Nginx/ALB/Cloudflare)
  app.set('trust proxy', env.TRUST_PROXY);

  // 1. Request logging
  app.use(
    pinoHttp({
      logger,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        censor: '[REDACTED]',
      },
    }),
  );

  // 2. Security headers
  app.use(helmet());

  // 3. CORS
  app.use(
    cors({
      origin: env.CLIENT_URL,
      credentials: true,
    }),
  );

  // 4. JSON body parsing with sensible limit
  app.use(express.json({ limit: '1mb' }));

  // 5. Global rate limiter (generous per IP)
  const globalLimiter = createRateLimiter({
    windowMs: options.rateLimits?.global?.windowMs ?? 15 * 60 * 1000,
    max: options.rateLimits?.global?.max ?? 1000,
    message: 'Too many requests, please try again later.',
  });
  app.use(globalLimiter);

  // 6. Routes
  app.use(healthRouter);
  app.use('/api/v1', createV1Router(options));

  // 7. Not Found handler
  app.use(notFoundHandler);

  // 8. Central Error handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
