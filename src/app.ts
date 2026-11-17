import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
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
  userResetPassword?: { windowMs?: number; max?: number };
}

export interface AppOptions {
  rateLimits?: RateLimitOverrides;
  customLogger?: typeof logger;
}

/**
 * Builds and configures the Express application instance.
 * Accepts optional rate-limit and logger overrides for integration testing.
 */
export function createApp(options: AppOptions = {}): Express {
  const app: Express = express();

  // Reverse proxy trust level (e.g. 1 behind Nginx/ALB/Cloudflare)
  app.set('trust proxy', env.TRUST_PROXY);

  // 1. Request logging: one concise line per request at info (method, path, status, duration, requestId).
  // No request/response bodies, no headers, no query strings with tokens. Health & openapi/docs at debug only.
  app.use(
    pinoHttp({
      logger: options.customLogger ?? logger,
      serializers: {
        req: () => undefined,
        res: () => undefined,
        err: () => undefined,
      },
      customProps: (req, res) => {
        // Return empty on request start to prevent duplicated properties in child logger bindings.
        // Populate only when response has finished so the final status and full path are emitted once.
        if (!res.headersSent && !res.writableEnded) {
          return {};
        }
        const fullUrl = req.originalUrl || req.url || '/';
        const path = fullUrl.split('?')[0] || '/';
        return {
          method: req.method,
          path,
          status: res.statusCode,
          requestId: req.id,
        };
      },
      customLogLevel: (req, res, err) => {
        const fullUrl = req.originalUrl || req.url || '';
        const path = fullUrl.split('?')[0] || '';
        if (
          path === '/health' ||
          path.startsWith('/api/v1/docs') ||
          path === '/favicon.ico'
        ) {
          return 'debug';
        }
        if (res.statusCode >= 500 || err) {
          return 'error';
        }
        if (res.statusCode >= 400) {
          return 'warn';
        }
        return 'info';
      },
      customSuccessMessage: (req, res, responseTime) => {
        const fullUrl = req.originalUrl || req.url || '/';
        const path = fullUrl.split('?')[0] || '/';
        return `${req.method} ${path} ${res.statusCode} ${Math.round(responseTime)}ms`;
      },
      customErrorMessage: (req, res, err) => {
        const fullUrl = req.originalUrl || req.url || '/';
        const path = fullUrl.split('?')[0] || '/';
        return `${req.method} ${path} ${res.statusCode} - ${err?.message || 'Error'}`;
      },
    }),
  );

  // 2. Security headers
  app.use(helmet());

  // 3. CORS: strictly the exact CLIENT_URL, credentials enabled
  app.use(
    cors({
      origin: env.CLIENT_URL,
      credentials: true,
    }),
  );

  // 4. Cookie parser placed before routes
  app.use(cookieParser());

  // 5. JSON body parsing with sensible limit
  app.use(express.json({ limit: '1mb' }));

  // 6. Global rate limiter (generous per IP)
  const globalLimiter = createRateLimiter({
    windowMs: options.rateLimits?.global?.windowMs ?? 15 * 60 * 1000,
    max: options.rateLimits?.global?.max ?? 1000,
    message: 'Too many requests, please try again later.',
  });
  app.use(globalLimiter);

  // 7. Routes
  app.use(healthRouter);
  app.use('/api/v1', createV1Router(options));

  // 8. Not Found handler
  app.use(notFoundHandler);

  // 9. Central Error handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
