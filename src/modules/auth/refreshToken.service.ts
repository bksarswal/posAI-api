import mongoose, { type Types } from 'mongoose';
import { RefreshToken } from './refreshToken.model.js';
import type { RefreshTokenDocument } from './refreshToken.interface.js';
import { withGlobalScope } from '../../utils/tenantBypass.js';
import { runWithTenant } from '../../utils/tenantContext.js';
import { generateToken, hashToken } from '../../utils/token.js';
import { env } from '../../config/env.js';
import { REFRESH_GRACE_SECONDS } from './auth.constants.js';

export interface CreateRefreshTokenInput {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  ip?: string;
  userAgent?: string;
}

export type RotateTokenResult =
  | {
      status: 'rotated';
      claimedToken: RefreshTokenDocument;
      newRawToken: string;
      newTokenDoc: RefreshTokenDocument;
    }
  | {
      status: 'grace';
      token: RefreshTokenDocument;
    }
  | {
      status: 'reused';
      token: RefreshTokenDocument;
    }
  | {
      status: 'invalid';
    };

export interface RotateTokenInput {
  tokenHash: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Creates a new refresh token record scoped to tenantId.
 */
export async function createRefreshToken(
  input: CreateRefreshTokenInput,
): Promise<RefreshTokenDocument> {
  return runWithTenant(input.tenantId, async () => {
    return RefreshToken.create(input);
  });
}

/**
 * Finds a refresh token by its SHA-256 hash across all tenants (unauthenticated token rotation/logout).
 * Legitimate global query wrapped in withGlobalScope.
 */
export async function findTokenByHash(
  tokenHash: string,
): Promise<RefreshTokenDocument | null> {
  return withGlobalScope(async () => {
    return RefreshToken.findOne({ tokenHash });
  });
}

/**
 * Revokes all tokens belonging to a family by setting revokedAt across all tenants.
 * Legitimate global query wrapped in withGlobalScope.
 */
export async function revokeFamily(familyId: string): Promise<void> {
  await withGlobalScope(async () => {
    await RefreshToken.updateMany(
      { familyId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  });
}

/**
 * Revokes all refresh token families for a user across all tenants.
 * Invoked during password change to invalidate sessions across all devices.
 * Legitimate global query wrapped in withGlobalScope.
 */
export async function revokeAllForUser(
  userId: string | Types.ObjectId,
): Promise<void> {
  const userObjectId =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  await withGlobalScope(async () => {
    await RefreshToken.updateMany(
      { userId: userObjectId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  });
}

/**
 * Atomically claims and rotates a refresh token inside a MongoDB transaction session.
 * Returns a discriminated result union:
 * - 'rotated': Token atomically claimed, and new family token created in same transaction.
 * - 'grace': Token was already rotated within REFRESH_GRACE_SECONDS (replay from concurrent tabs).
 * - 'reused': Token was rotated beyond grace period (token reuse detected).
 * - 'invalid': Token not found, expired, or already revoked.
 */
export async function rotateToken(
  input: RotateTokenInput,
): Promise<RotateTokenResult> {
  return withGlobalScope(async () => {
    const session = await mongoose.startSession();
    try {
      let result: RotateTokenResult = { status: 'invalid' };

      await session.withTransaction(async () => {
        const now = new Date();

        // 1. Attempt atomic claim of active, unrotated, unrevoked, unexpired token
        const claimed = await RefreshToken.findOneAndUpdate(
          {
            tokenHash: input.tokenHash,
            rotatedAt: null,
            revokedAt: null,
            expiresAt: { $gt: now },
          },
          {
            $set: { rotatedAt: now },
          },
          {
            session,
            returnDocument: 'before',
          },
        );

        if (claimed) {
          // Verify that family was not previously revoked by another event
          const familyRevoked = await RefreshToken.findOne({
            familyId: claimed.familyId,
            revokedAt: { $ne: null },
          }).session(session);

          if (familyRevoked) {
            result = { status: 'invalid' };
            return;
          }

          // Generate new refresh token
          const newRawToken = generateToken();
          const newTokenHash = hashToken(newRawToken);
          const newExpiresAt = new Date(
            now.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
          );

          const createdTokens = await RefreshToken.create(
            [
              {
                tenantId: claimed.tenantId,
                userId: claimed.userId,
                tokenHash: newTokenHash,
                familyId: claimed.familyId,
                expiresAt: newExpiresAt,
                ip: input.ip,
                userAgent: input.userAgent,
              },
            ],
            { session },
          );

          const createdToken = createdTokens[0];
          if (!createdToken) {
            result = { status: 'invalid' };
            return;
          }

          result = {
            status: 'rotated',
            claimedToken: claimed,
            newRawToken,
            newTokenDoc: createdToken,
          };
          return;
        }

        // findOneAndUpdate returned null. Inspect why to discriminate result.
        const existingToken = await RefreshToken.findOne({
          tokenHash: input.tokenHash,
        }).session(session);

        if (!existingToken) {
          result = { status: 'invalid' };
          return;
        }

        // Check if token was revoked or expired
        if (
          existingToken.revokedAt ||
          existingToken.expiresAt.getTime() <= now.getTime()
        ) {
          result = { status: 'invalid' };
          return;
        }

        // Check if token was already rotated
        if (existingToken.rotatedAt) {
          const diffMs = now.getTime() - existingToken.rotatedAt.getTime();
          if (diffMs <= REFRESH_GRACE_SECONDS * 1000) {
            result = { status: 'grace', token: existingToken };
          } else {
            result = { status: 'reused', token: existingToken };
          }
          return;
        }

        // Fallback for any other condition
        result = { status: 'invalid' };
      });

      return result;
    } finally {
      await session.endSession();
    }
  });
}
