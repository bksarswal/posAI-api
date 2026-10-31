import type { ClientSession, Types } from 'mongoose';
import { AuthToken } from './authToken.model.js';
import type {
  AuthTokenDocument,
  AuthTokenType,
} from './authToken.interface.js';
import { withGlobalScope } from '../../utils/tenantBypass.js';
import { runWithTenant } from '../../utils/tenantContext.js';
import { generateToken, hashToken } from '../../utils/token.js';
import {
  VERIFICATION_TOKEN_TTL_HOURS,
  PASSWORD_RESET_TOKEN_TTL_HOURS,
} from './auth.constants.js';

export interface CreateAuthTokenInput {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  type: AuthTokenType;
}

export interface CreatedAuthTokenResult {
  rawToken: string;
  authToken: AuthTokenDocument;
}

/**
 * Creates an authentication token (email verification or password reset) for a user.
 * Invalidates any older unused tokens of the same type for that user.
 * The raw token is returned to be dispatched via email and is NEVER stored or logged.
 */
export async function createAuthToken(
  input: CreateAuthTokenInput,
  options?: { session?: ClientSession },
): Promise<CreatedAuthTokenResult> {
  const now = new Date();

  // Invalidate older unused tokens of the same type for this user
  await runWithTenant(input.tenantId, async () => {
    await AuthToken.updateMany(
      {
        userId: input.userId,
        type: input.type,
        usedAt: null,
      },
      {
        $set: { usedAt: now },
      },
      { session: options?.session },
    );
  });

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);

  const ttlMs =
    input.type === 'EMAIL_VERIFICATION'
      ? VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000
      : PASSWORD_RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000;

  const expiresAt = new Date(now.getTime() + ttlMs);

  const [authToken] = await runWithTenant(input.tenantId, async () => {
    return AuthToken.create(
      [
        {
          tenantId: input.tenantId,
          userId: input.userId,
          type: input.type,
          tokenHash,
          expiresAt,
        },
      ],
      { session: options?.session },
    );
  });

  if (!authToken) {
    throw new Error('Failed to create AuthToken');
  }

  return { rawToken, authToken };
}

/**
 * Atomically claims an auth token by setting usedAt = now if it is currently unused and unexpired.
 * Global query wrapped in withGlobalScope (token verification is unauthenticated).
 */
export async function claimTokenAtomic(
  rawToken: string,
  expectedType: AuthTokenType,
  options?: { session?: ClientSession },
): Promise<AuthTokenDocument | null> {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  return withGlobalScope(async () => {
    return AuthToken.findOneAndUpdate(
      {
        tokenHash,
        type: expectedType,
        usedAt: null,
        expiresAt: { $gt: now },
      },
      {
        $set: { usedAt: now },
      },
      {
        session: options?.session,
        returnDocument: 'after',
      },
    );
  });
}

/**
 * Retrieves the latest token of a given type for a user across all tenants.
 * Used for cooldown checks on resend/forgot requests.
 */
export async function findLatestTokenForUser(
  userId: Types.ObjectId | string,
  type: AuthTokenType,
): Promise<AuthTokenDocument | null> {
  return withGlobalScope(async () => {
    return AuthToken.findOne({ userId, type }).sort({ createdAt: -1 });
  });
}

/**
 * Marks all remaining unused tokens of a given type for a user as used.
 */
export async function invalidateTokensForUser(
  userId: Types.ObjectId | string,
  type: AuthTokenType,
  options?: { session?: ClientSession },
): Promise<void> {
  await withGlobalScope(async () => {
    await AuthToken.updateMany(
      {
        userId,
        type,
        usedAt: null,
      },
      {
        $set: { usedAt: new Date() },
      },
      { session: options?.session },
    );
  });
}
