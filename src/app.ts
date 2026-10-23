import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { healthRouter } from './modules/health/index.js';
import { v1Router } from './routes/v1/index.js';
import { notFoundHandler } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

const app: Express = express();

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
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
    code: 'TOO_MANY_REQUESTS',
  },
});
app.use(globalLimiter);

// 6. Routes
app.use(healthRouter);
app.use('/api/v1', v1Router);

// 7. Not Found handler
app.use(notFoundHandler);

// 8. Central Error handler
app.use(errorHandler);

export { app };
