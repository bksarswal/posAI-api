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

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
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
