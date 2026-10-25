import mongoose from 'mongoose';
import { TenantService } from '../tenant/index.js';
import { UserService } from '../user/index.js';
import { generateTenantSlug } from '../../utils/slug.js';
import { hashPassword } from '../../utils/password.js';
import { runWithTenant } from '../../utils/tenantContext.js';
import { AppError } from '../../utils/appError.js';
import { env } from '../../config/env.js';
import type { SignupInput } from './auth.validation.js';
import type { SignupResponseData } from './auth.types.js';
import type { UserDocument } from '../user/user.interface.js';
import type { TenantDocument } from '../tenant/tenant.interface.js';

/**
 * Handles account registration:
 * 1. Checks for existing email globally.
 * 2. Hashes password.
 * 3. Inside one transaction: creates Tenant and OWNER User (scoped to tenant).
 * 4. Retries up to 3 times on slug collision; maps email collision to 409.
 */
export async function signup(input: SignupInput): Promise<SignupResponseData> {
  const normalizedEmail = input.email.toLowerCase().trim();

  // 1. Fast pre-check for existing email across all tenants
  const existingUser = await UserService.findUserByEmailGlobal(normalizedEmail);
  if (existingUser) {
    throw new AppError(
      'Email is already registered',
      409,
      'EMAIL_ALREADY_REGISTERED',
    );
  }

  // 2. Hash password upfront before opening transaction
  const passwordHash = await hashPassword(input.password);

  // 3. Retryable transaction loop to handle slug collisions
  const MAX_SLUG_ATTEMPTS = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    const slug = generateTenantSlug(input.businessName);

    try {
      let createdUser: UserDocument | null = null;
      let createdTenant: TenantDocument | null = null;

      await session.withTransaction(async () => {
        // Create Tenant inside transaction
        createdTenant = await TenantService.createTenant(
          {
            name: input.businessName,
            slug,
          },
          { session },
        );

        // Create OWNER User inside tenant execution context
        await runWithTenant(createdTenant._id, async () => {
          createdUser = await UserService.createUser(
            {
              name: input.name,
              email: normalizedEmail,
              passwordHash,
              role: 'OWNER',
              phone: input.phone,
              emailVerified: env.AUTO_VERIFY_EMAIL,
            },
            { session },
          );
        });
      });

      if (!createdUser || !createdTenant) {
        throw new Error(
          'Transaction succeeded but user or tenant was not created',
        );
      }

      const userDoc: UserDocument = createdUser;
      const tenantDoc: TenantDocument = createdTenant;

      return {
        user: {
          id: userDoc._id.toString(),
          tenantId: tenantDoc._id.toString(),
          name: userDoc.name,
          email: userDoc.email,
          role: userDoc.role,
          emailVerified: userDoc.emailVerified,
        },
      };
    } catch (err: unknown) {
      lastError = err;

      // Inspect duplicate key error (code 11000)
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as Record<string, unknown>)['code'] === 11000
      ) {
        const keyPattern =
          (err as { keyPattern?: Record<string, unknown> }).keyPattern ||
          (err as { errorResponse?: { keyPattern?: Record<string, unknown> } })
            .errorResponse?.keyPattern;

        const isEmailCollision =
          (keyPattern && 'email' in keyPattern) ||
          (err instanceof Error && err.message.includes('email_1'));

        const isSlugCollision =
          (keyPattern && 'slug' in keyPattern) ||
          (err instanceof Error && err.message.includes('slug_1'));

        if (isEmailCollision) {
          throw new AppError(
            'Email is already registered',
            409,
            'EMAIL_ALREADY_REGISTERED',
          );
        }

        if (isSlugCollision && attempt < MAX_SLUG_ATTEMPTS) {
          continue;
        }
      }

      throw err;
    } finally {
      await session.endSession();
    }
  }

  throw lastError;
}
