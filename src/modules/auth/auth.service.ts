import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { TenantService } from '../tenant/index.js';
import { UserService } from '../user/index.js';
import * as RefreshTokenService from './refreshToken.service.js';
import * as AuthTokenService from './authToken.service.js';
import { getEmailProvider } from '../../utils/email/index.js';
import {
  getVerificationEmailTemplate,
  getPasswordResetEmailTemplate,
} from './auth.emails.js';
import { AUTH_TOKEN_RESEND_COOLDOWN_SECONDS } from './auth.constants.js';
import { generateTenantSlug } from '../../utils/slug.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { generateToken, hashToken } from '../../utils/token.js';
import { runWithTenant } from '../../utils/tenantContext.js';
import { AppError } from '../../utils/appError.js';
import { logger } from '../../utils/logger.js';
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

      // If AUTO_VERIFY_EMAIL is false, create verification token and send email.
      // Send failure does NOT fail signup.
      if (!env.AUTO_VERIFY_EMAIL) {
        try {
          const { rawToken } = await AuthTokenService.createAuthToken({
            tenantId: tenantDoc._id,
            userId: userDoc._id,
            type: 'EMAIL_VERIFICATION',
          });

          const template = getVerificationEmailTemplate({
            name: userDoc.name,
            token: rawToken,
          });

          await getEmailProvider().send({
            to: userDoc.email,
            subject: template.subject,
            text: template.text,
            html: template.html,
          });
        } catch (emailErr) {
          logger.error(
            { err: emailErr, userId: userDoc._id.toString() },
            'Failed to dispatch verification email during signup',
          );
        }
      }

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

/**
 * Handles refresh token rotation:
 * 1. Checks if raw token is provided.
 * 2. Invokes atomic rotateToken transaction.
 * 3. Handles discriminated status (rotated | grace | reused | invalid) AFTER transaction commits.
 * 4. Reloads user and tenant inside tenant context and verifies active / emailVerified status.
 * 5. Generates new access token with DB role.
 */
export async function refreshSession(
  rawRefreshToken: string | undefined,
  context: { ip?: string; userAgent?: string },
): Promise<{
  accessToken: string;
  rawRefreshToken: string;
  user: LoginResponseUser;
}> {
  if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
    throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
  }

  const tokenHash = hashToken(rawRefreshToken);
  const result = await RefreshTokenService.rotateToken({
    tokenHash,
    ip: context.ip,
    userAgent: context.userAgent,
  });

  if (result.status === 'invalid') {
    throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
  }

  if (result.status === 'grace') {
    // Replay within REFRESH_GRACE_SECONDS: Do NOT revoke family, do NOT clear cookie
    throw new AppError(
      'Refresh token was already rotated within grace period',
      401,
      'REFRESH_TOKEN_ROTATED',
    );
  }

  if (result.status === 'reused') {
    // Replay after grace window: Revoke entire family, log security event
    logger.warn(
      {
        userId: result.token.userId.toString(),
        familyId: result.token.familyId,
        ip: context.ip,
      },
      'Refresh token reuse detected: entire token family revoked',
    );
    await RefreshTokenService.revokeFamily(result.token.familyId);
    throw new AppError(
      'Refresh token reuse detected',
      401,
      'REFRESH_TOKEN_REUSED',
    );
  }

  // result.status === 'rotated'
  const { claimedToken, newRawToken } = result;

  // Step 5: Reload user inside runWithTenant(claimedToken.tenantId)
  const user = await runWithTenant(claimedToken.tenantId, async () => {
    return UserService.findUserById(claimedToken.userId.toString());
  });

  const tenant = await TenantService.findTenantById(
    claimedToken.tenantId.toString(),
  );

  if (
    !user ||
    user.status !== 'ACTIVE' ||
    !user.emailVerified ||
    !tenant ||
    tenant.status !== 'ACTIVE'
  ) {
    await RefreshTokenService.revokeFamily(claimedToken.familyId);
    throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
  }

  // Step 6: Generate access token using DB role
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

  return {
    accessToken,
    rawRefreshToken: newRawToken,
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

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * Handles password change for authenticated users:
 * 1. Verifies current password against stored hash.
 * 2. Hashes new password.
 * 3. Updates passwordHash, passwordChangedAt = now, mustChangePassword = false via UserService.
 * 4. Revokes all refresh token families for this user across all tenants.
 */
export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
): Promise<void> {
  const user = await UserService.findUserByIdWithPassword(userId);
  if (!user) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }

  const isCurrentValid = await verifyPassword(
    input.currentPassword,
    user.passwordHash,
  );
  if (!isCurrentValid) {
    throw new AppError(
      'Current password is incorrect',
      400,
      'INVALID_CURRENT_PASSWORD',
    );
  }

  if (input.currentPassword === input.newPassword) {
    throw new AppError(
      'New password must be different from current password',
      400,
      'VALIDATION_ERROR',
    );
  }

  const newPasswordHash = await hashPassword(input.newPassword);
  await UserService.updatePassword(userId, newPasswordHash);

  // Revoke all refresh token families for this user across all tenants
  await RefreshTokenService.revokeAllForUser(userId);
}

export const GENERIC_RESEND_VERIFICATION_MESSAGE =
  'If the account exists and is not verified, an email has been sent';

export const GENERIC_FORGOT_PASSWORD_MESSAGE =
  'If the account exists, a password reset email has been sent';

/**
 * Handles email verification:
 * Claims verification token and marks user emailVerified inside ONE transaction,
 * ensuring failure during user update rolls back the token claim.
 */
export async function verifyEmail(input: { token: string }): Promise<void> {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const token = await AuthTokenService.claimTokenAtomic(
        input.token,
        'EMAIL_VERIFICATION',
        { session },
      );

      if (!token) {
        throw new AppError(
          'Invalid or expired verification token',
          400,
          'INVALID_OR_EXPIRED_TOKEN',
        );
      }

      await runWithTenant(token.tenantId, async () => {
        await UserService.markEmailVerified(token.userId, { session });
      });
    });
  } finally {
    await session.endSession();
  }
}

/**
 * Handles resend verification request:
 * Always returns generic 200 message. Only when user exists, is unverified,
 * and last token is older than 60 seconds: issues new token and dispatches email asynchronously.
 */
export async function resendVerification(email: string): Promise<string> {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await UserService.findUserByEmailGlobal(normalizedEmail);

  if (user && !user.emailVerified) {
    const latestToken = await AuthTokenService.findLatestTokenForUser(
      user._id,
      'EMAIL_VERIFICATION',
    );

    const now = new Date();
    const isWithinCooldown =
      latestToken &&
      now.getTime() - latestToken.createdAt.getTime() <
        AUTH_TOKEN_RESEND_COOLDOWN_SECONDS * 1000;

    if (!isWithinCooldown) {
      const { rawToken } = await AuthTokenService.createAuthToken({
        tenantId: user.tenantId,
        userId: user._id,
        type: 'EMAIL_VERIFICATION',
      });

      const template = getVerificationEmailTemplate({
        name: user.name,
        token: rawToken,
      });

      getEmailProvider()
        .send({
          to: user.email,
          subject: template.subject,
          text: template.text,
          html: template.html,
        })
        .catch((err) => {
          logger.error(
            { err, userId: user._id.toString() },
            'Failed to dispatch resend-verification email',
          );
        });
    }
  }

  return GENERIC_RESEND_VERIFICATION_MESSAGE;
}

/**
 * Handles forgot password request:
 * Always returns generic 200 message. Only when user exists and is ACTIVE:
 * issues PASSWORD_RESET token (cooldown 60 seconds per user) and dispatches email asynchronously.
 */
export async function forgotPassword(email: string): Promise<string> {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await UserService.findUserByEmailGlobal(normalizedEmail);

  if (user && user.status === 'ACTIVE') {
    const latestToken = await AuthTokenService.findLatestTokenForUser(
      user._id,
      'PASSWORD_RESET',
    );

    const now = new Date();
    const isWithinCooldown =
      latestToken &&
      now.getTime() - latestToken.createdAt.getTime() <
        AUTH_TOKEN_RESEND_COOLDOWN_SECONDS * 1000;

    if (!isWithinCooldown) {
      const { rawToken } = await AuthTokenService.createAuthToken({
        tenantId: user.tenantId,
        userId: user._id,
        type: 'PASSWORD_RESET',
      });

      const template = getPasswordResetEmailTemplate({
        name: user.name,
        token: rawToken,
      });

      getEmailProvider()
        .send({
          to: user.email,
          subject: template.subject,
          text: template.text,
          html: template.html,
        })
        .catch((err) => {
          logger.error(
            { err, userId: user._id.toString() },
            'Failed to dispatch password reset email',
          );
        });
    }
  }

  return GENERIC_FORGOT_PASSWORD_MESSAGE;
}

/**
 * Handles password reset:
 * In one transaction: claims token atomically, validates user ACTIVE status,
 * sets new passwordHash, passwordChangedAt = now, mustChangePassword = false, emailVerified = true.
 * Invalidates other unused reset tokens and revokes all refresh token families for user.
 */
export async function resetPassword(input: {
  token: string;
  newPassword: string;
}): Promise<void> {
  const session = await mongoose.startSession();
  let claimedTokenUserId: mongoose.Types.ObjectId | null = null;

  try {
    await session.withTransaction(async () => {
      const token = await AuthTokenService.claimTokenAtomic(
        input.token,
        'PASSWORD_RESET',
        { session },
      );

      if (!token) {
        throw new AppError(
          'Invalid or expired password reset token',
          400,
          'INVALID_OR_EXPIRED_TOKEN',
        );
      }

      claimedTokenUserId = token.userId;

      const user = await runWithTenant(token.tenantId, async () => {
        return UserService.findUserById(token.userId.toString());
      });

      if (!user || user.status !== 'ACTIVE') {
        throw new AppError(
          'Invalid or expired password reset token',
          400,
          'INVALID_OR_EXPIRED_TOKEN',
        );
      }

      const passwordHash = await hashPassword(input.newPassword);

      await runWithTenant(token.tenantId, async () => {
        await UserService.resetPassword(user._id, passwordHash, { session });
      });

      await AuthTokenService.invalidateTokensForUser(
        user._id,
        'PASSWORD_RESET',
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  if (claimedTokenUserId) {
    await RefreshTokenService.revokeAllForUser(claimedTokenUserId);
  }
}
