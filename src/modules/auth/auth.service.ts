import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { TenantService } from '../tenant/index.js';
import { UserService } from '../user/index.js';
import * as RefreshTokenService from './refreshToken.service.js';
import { generateTenantSlug } from '../../utils/slug.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { generateToken, hashToken } from '../../utils/token.js';
import { runWithTenant } from '../../utils/tenantContext.js';
import { AppError } from '../../utils/appError.js';
import { env } from '../../config/env.js';
import type { SignupInput, LoginInput } from './auth.validation.js';
import type { SignupResponseData, LoginResponseUser } from './auth.types.js';
import type { UserDocument } from '../user/user.interface.js';
import type { TenantDocument } from '../tenant/tenant.interface.js';

// Precomputed dummy hash created with the configured work factor for timing-safe login
const DUMMY_HASH = bcryptjs.hashSync(
  'posai_timing_attack_defense_dummy_password',
  env.BCRYPT_ROUNDS,
);

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

export interface LoginResult {
  accessToken: string;
  rawRefreshToken: string;
  user: LoginResponseUser;
}

export interface LoginContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Handles user login:
 * 1. Looks up user by email globally, with timing attack mitigation.
 * 2. Compares password hash (always invokes verifyPassword exactly once).
 * 3. Enforces post-credential status rules: emailVerified, ACTIVE, tenant SUSPENDED.
 * 4. Issues access JWT and persists single-use refresh token.
 */
export async function login(
  input: LoginInput,
  context: LoginContext = {},
): Promise<LoginResult> {
  const normalizedEmail = input.email.toLowerCase().trim();

  // Global lookup for user including +passwordHash
  const user = await UserService.findUserByEmailForLogin(normalizedEmail);

  if (!user) {
    // Timing defense: compare against dummy hash so duration is uniform
    await verifyPassword(input.password, DUMMY_HASH);
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  const isPasswordValid = await verifyPassword(
    input.password,
    user.passwordHash,
  );

  if (!isPasswordValid) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  // Post-password checks
  if (!user.emailVerified) {
    throw new AppError(
      'Email is not verified. Please verify your email before logging in.',
      403,
      'EMAIL_NOT_VERIFIED',
    );
  }

  if (user.status === 'INACTIVE') {
    throw new AppError(
      'Account is deactivated. Please contact your administrator.',
      403,
      'ACCOUNT_DISABLED',
    );
  }

  const tenant = await TenantService.findTenantById(user.tenantId.toString());
  if (!tenant || tenant.status === 'SUSPENDED') {
    throw new AppError('Tenant account is suspended.', 403, 'TENANT_SUSPENDED');
  }

  // Issue access JWT (pinned HS256, standard issuer, claims: sub, tid, role)
  const accessToken = jwt.sign(
    {
      sub: user._id.toString(),
      tid: user.tenantId.toString(),
      role: user.role,
    },
    env.JWT_ACCESS_SECRET,
    {
      algorithm: 'HS256',
      issuer: 'posai-api',
      expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m`,
    },
  );

  // Issue refresh token
  const rawRefreshToken = generateToken();
  const tokenHash = hashToken(rawRefreshToken);
  const familyId = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  await RefreshTokenService.createRefreshToken({
    tenantId: user.tenantId,
    userId: user._id,
    tokenHash,
    familyId,
    expiresAt,
    ip: context.ip,
    userAgent: context.userAgent,
  });

  // Update lastLoginAt inside tenant context
  await runWithTenant(user.tenantId, async () => {
    await UserService.updateLastLogin(user._id.toString());
  });

  return {
    accessToken,
    rawRefreshToken,
    user: {
      id: user._id.toString(),
      tenantId: user.tenantId.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      branchIds: (user.branchIds || []).map((b) => b.toString()),
      mustChangePassword: user.mustChangePassword ?? false,
    },
  };
}

/**
 * Handles user logout:
 * Revokes the token family if refresh cookie is present and known.
 * Idempotent: always succeeds.
 */
export async function logout(rawRefreshToken?: string): Promise<void> {
  if (rawRefreshToken && typeof rawRefreshToken === 'string') {
    const tokenHash = hashToken(rawRefreshToken);
    const existing = await RefreshTokenService.findTokenByHash(tokenHash);
    if (existing) {
      await RefreshTokenService.revokeFamily(existing.familyId);
    }
  }
}
