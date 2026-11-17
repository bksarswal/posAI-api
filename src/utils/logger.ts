import pino from 'pino';
import { env } from '../config/env.js';

export const REDACT_PATHS = [
  // Headers & cookies (top-level, 1-level, 2-levels, and arrays)
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  '*.headers.authorization',
  '*.headers.cookie',
  '*.*.headers.authorization',
  '*.*.headers.cookie',
  'authorization',
  'cookie',
  'set-cookie',
  '*.authorization',
  '*.cookie',
  '*.set-cookie',
  '*.*.authorization',
  '*.*.cookie',
  '*.*.set-cookie',
  '[*].authorization',
  '[*].cookie',
  '[*].set-cookie',
  '*[*].authorization',
  '*[*].cookie',
  '*[*].set-cookie',

  // Passwords & credentials (top-level, 1-level, 2-levels, and arrays)
  'password',
  'temporaryPassword',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'SMTP_PASS',
  'smtpPass',
  '*.password',
  '*.temporaryPassword',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordHash',
  '*.SMTP_PASS',
  '*.smtpPass',
  '*.*.password',
  '*.*.temporaryPassword',
  '*.*.currentPassword',
  '*.*.newPassword',
  '*.*.passwordHash',
  '*.*.SMTP_PASS',
  '*.*.smtpPass',
  '[*].password',
  '[*].temporaryPassword',
  '[*].currentPassword',
  '[*].newPassword',
  '[*].passwordHash',
  '*[*].password',
  '*[*].temporaryPassword',
  '*[*].currentPassword',
  '*[*].newPassword',
  '*[*].passwordHash',

  // Tokens (top-level, 1-level, 2-levels, and arrays)
  'token',
  'accessToken',
  'refreshToken',
  'verificationToken',
  'resetToken',
  'tokenHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.verificationToken',
  '*.resetToken',
  '*.tokenHash',
  '*.*.token',
  '*.*.accessToken',
  '*.*.refreshToken',
  '*.*.verificationToken',
  '*.*.resetToken',
  '*.*.tokenHash',
  '[*].token',
  '[*].accessToken',
  '[*].refreshToken',
  '[*].verificationToken',
  '[*].resetToken',
  '[*].tokenHash',
  '*[*].token',
  '*[*].accessToken',
  '*[*].refreshToken',
  '*[*].verificationToken',
  '*[*].resetToken',
  '*[*].tokenHash',

  // Request & response bodies
  'req.body',
  'body',
  '*.req.body',
  '*.body',
  '*.*.body',
  '[*].body',
  '*[*].body',
];

export const REDACT_CENSOR = '[REDACTED]';

export function createLogger(
  options: pino.LoggerOptions = {},
  destination?: pino.DestinationStream,
): pino.Logger {
  const isDev = env.NODE_ENV === 'development';
  const level = options.level ?? env.LOG_LEVEL;

  return pino(
    {
      level,
      redact: {
        paths: REDACT_PATHS,
        censor: REDACT_CENSOR,
      },
      transport:
        !destination && isDev && level !== 'silent'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
      ...options,
    },
    destination,
  );
}

export const logger = createLogger();
