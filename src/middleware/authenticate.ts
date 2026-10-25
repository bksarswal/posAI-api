import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { sendError } from '../utils/response.js';
import { runWithTenant } from '../utils/tenantContext.js';
import { UserService } from '../modules/user/index.js';
import { TenantService } from '../modules/tenant/index.js';
import type { AuthTokenPayload } from '../modules/auth/auth.types.js';

/**
 * Endpoints accessible even when mustChangePassword === true.
 */
export const PASSWORD_CHANGE_EXEMPT_ROUTES = [
  '/api/v1/auth/change-password',
  '/api/v1/auth/logout',
  '/api/v1/users/me',
] as const;

/**
 * Authentication middleware:
 * 1. Verifies Bearer JWT with pinned HS256 algorithm and issuer.
 * 2. Reloads user from database on every request inside runWithTenant(payload.tid).
 * 3. Enforces user ACTIVE and tenant ACTIVE status.
 * 4. Checks passwordChangedAt against token iat.
 * 5. Replaces token role with database role (never trusts token role).
 * 6. Enforces mustChangePassword gate except on exempt routes.
 * 7. Calls next() inside runWithTenant(tenantId) so downstream handlers are tenant-scoped.
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, {
      statusCode: 401,
      message: 'Authentication token missing or invalid',
      code: 'UNAUTHORIZED',
    });
  }

  const token = authHeader.substring(7).trim();

  let payload: AuthTokenPayload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'posai-api',
    }) as AuthTokenPayload;
  } catch (err: unknown) {
    if (err instanceof jwt.TokenExpiredError) {
      return sendError(res, {
        statusCode: 401,
        message: 'Authentication token has expired',
        code: 'TOKEN_EXPIRED',
      });
    }

    return sendError(res, {
      statusCode: 401,
      message: 'Invalid authentication token',
      code: 'UNAUTHORIZED',
    });
  }

  if (!payload.sub || !payload.tid) {
    return sendError(res, {
      statusCode: 401,
      message: 'Invalid token payload',
      code: 'UNAUTHORIZED',
    });
  }

  let tenantObjectId: Types.ObjectId;
  try {
    tenantObjectId = new Types.ObjectId(payload.tid);
  } catch {
    return sendError(res, {
      statusCode: 401,
      message: 'Invalid tenant identifier in token',
      code: 'UNAUTHORIZED',
    });
  }

  // Reload user from database inside tenant context matching token's tid.
  // If tid in token does not match user's tenant, query returns null.
  const user = await runWithTenant(tenantObjectId, async () => {
    return UserService.findUserById(payload.sub);
  });

  if (!user || user.status !== 'ACTIVE') {
    return sendError(res, {
      statusCode: 401,
      message: 'User account is inactive or not found',
      code: 'UNAUTHORIZED',
    });
  }

  // Verify tenant is active
  const tenant = await TenantService.findTenantById(payload.tid);
  if (!tenant || tenant.status === 'SUSPENDED') {
    return sendError(res, {
      statusCode: 401,
      message: 'Tenant account is suspended',
      code: 'UNAUTHORIZED',
    });
  }

  // Reject token if password was changed after token issuance
  if (user.passwordChangedAt && payload.iat) {
    const iatMs = payload.iat * 1000;
    if (user.passwordChangedAt.getTime() > iatMs) {
      return sendError(res, {
        statusCode: 401,
        message: 'Password was recently changed. Please log in again.',
        code: 'UNAUTHORIZED',
      });
    }
  }

  // Enforce password change requirement
  if (user.mustChangePassword) {
    const path = req.originalUrl.split('?')[0];
    const isExempt = PASSWORD_CHANGE_EXEMPT_ROUTES.some(
      (exemptPath) => path === exemptPath,
    );
    if (!isExempt) {
      return sendError(res, {
        statusCode: 403,
        message:
          'Password change required before accessing operational endpoints',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
  }

  // Populate req.auth using authoritative database role
  req.auth = {
    userId: user._id.toString(),
    tenantId: user.tenantId.toString(),
    role: user.role,
    branchIds: user.branchIds || [],
  };

  // Call next() INSIDE runWithTenant so all downstream handlers operate within tenant scope
  return runWithTenant(user.tenantId, async () => {
    next();
  });
}
