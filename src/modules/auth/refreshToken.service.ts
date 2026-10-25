import type { Types } from 'mongoose';
import { RefreshToken } from './refreshToken.model.js';
import type { RefreshTokenDocument } from './refreshToken.interface.js';
import { withGlobalScope } from '../../utils/tenantBypass.js';
import { runWithTenant } from '../../utils/tenantContext.js';

export interface CreateRefreshTokenInput {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
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
      { familyId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    );
  });
}
