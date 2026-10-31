import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),

    PORT: z.coerce.number().int().positive().default(8080),

    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

    // Minimum 32 characters enforced to prevent weak secrets in production.
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z
      .string()
      .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),

    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

    CLIENT_URL: z.string().url('CLIENT_URL must be a valid URL'),

    BCRYPT_ROUNDS: z.coerce
      .number()
      .int()
      .min(4, 'BCRYPT_ROUNDS must be at least 4')
      .max(15, 'BCRYPT_ROUNDS must be at most 15')
      .default(12),

    AUTO_VERIFY_EMAIL: z.stringbool().default(false),

    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    EMAIL_PROVIDER: z.enum(['log', 'smtp']).default('log'),
    EMAIL_FROM: z
      .string()
      .email('EMAIL_FROM must be a valid email address')
      .optional(),
    SMTP_HOST: z.string().min(1, 'SMTP_HOST cannot be empty').optional(),
    SMTP_PORT: z.coerce
      .number()
      .int()
      .positive('SMTP_PORT must be a positive integer')
      .optional(),
    SMTP_USER: z.string().min(1, 'SMTP_USER cannot be empty').optional(),
    SMTP_PASS: z.string().min(1, 'SMTP_PASS cannot be empty').optional(),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((data, ctx) => {
    if (data.EMAIL_PROVIDER === 'smtp') {
      if (!data.EMAIL_FROM) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'EMAIL_FROM is required when EMAIL_PROVIDER is smtp',
          path: ['EMAIL_FROM'],
        });
      }
      if (!data.SMTP_HOST) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SMTP_HOST is required when EMAIL_PROVIDER is smtp',
          path: ['SMTP_HOST'],
        });
      }
      if (!data.SMTP_PORT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SMTP_PORT is required when EMAIL_PROVIDER is smtp',
          path: ['SMTP_PORT'],
        });
      }
      if (!data.SMTP_USER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SMTP_USER is required when EMAIL_PROVIDER is smtp',
          path: ['SMTP_USER'],
        });
      }
      if (!data.SMTP_PASS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SMTP_PASS is required when EMAIL_PROVIDER is smtp',
          path: ['SMTP_PASS'],
        });
      }
    }

    if (data.NODE_ENV === 'production') {
      if (data.EMAIL_PROVIDER === 'log') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'EMAIL_PROVIDER cannot be "log" in production',
          path: ['EMAIL_PROVIDER'],
        });
      }

      if (data.BCRYPT_ROUNDS < 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'BCRYPT_ROUNDS must be at least 10 in production',
          path: ['BCRYPT_ROUNDS'],
        });
      }

      if (data.AUTO_VERIFY_EMAIL === true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'AUTO_VERIFY_EMAIL cannot be true in production',
          path: ['AUTO_VERIFY_EMAIL'],
        });
      }

      if (data.JWT_ACCESS_SECRET.startsWith('change-me')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'JWT_ACCESS_SECRET cannot start with "change-me" in production',
          path: ['JWT_ACCESS_SECRET'],
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Pure function to validate environment configuration.
 * Returns the typed, frozen config or throws an error listing every invalid variable.
 */
export function parseEnv(input: unknown): Env {
  const result = envSchema.safeParse(input);

  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `  • ${field}: ${issue.message}`;
    });

    throw new Error(
      `Invalid environment configuration – fix the following variables:\n${lines.join('\n')}`,
    );
  }

  return Object.freeze(result.data);
}

let loadedEnv: Env;
try {
  loadedEnv = parseEnv(process.env);
} catch (error) {
  if (error instanceof Error) {
    console.error(`\n❌ ${error.message}\n`);
  } else {
    console.error('\n❌ Unknown error validating environment variables.\n');
  }
  process.exit(1);
}

export let env = loadedEnv;

/**
 * Test helper to override specific env variables in unit/integration tests.
 * Throws unless NODE_ENV === 'test'.
 */
export function setEnvForTesting(overrides: Partial<Env>): void {
  if (process.env['NODE_ENV'] !== 'test') {
    throw new Error(
      'setEnvForTesting is only permitted when NODE_ENV === "test"',
    );
  }
  env = Object.freeze({ ...env, ...overrides });
}

/**
 * Resets env to its initial parsed state after test overrides.
 * Throws unless NODE_ENV === 'test'.
 */
export function resetEnvForTesting(): void {
  if (process.env['NODE_ENV'] !== 'test') {
    throw new Error(
      'resetEnvForTesting is only permitted when NODE_ENV === "test"',
    );
  }
  env = loadedEnv;
}
