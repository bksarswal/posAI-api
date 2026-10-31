import type { CookieOptions } from 'express';
import { env } from '../../config/env.js';

/**
 * Window in seconds within which a rotated refresh token may be safely replayed
 * by legitimate concurrent requests (e.g. multiple tabs) without triggering security revocation.
 */
export const REFRESH_GRACE_SECONDS = 10;

/**
 * Token validity windows.
 */
export const VERIFICATION_TOKEN_TTL_HOURS = 24;
export const PASSWORD_RESET_TOKEN_TTL_HOURS = 1;

/**
 * Cooldown period in seconds before a new verification or reset email can be requested.
 */
export const AUTH_TOKEN_RESEND_COOLDOWN_SECONDS = 60;

/**
 * Builds standard HttpOnly cookie options for refresh tokens.
 * Secure flag is strictly true ONLY in production environments.
 */
export function getRefreshTokenCookieOptions(
  overrides?: Partial<CookieOptions>,
): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

/**
 * Builds cookie options for clearing refresh tokens on logout or revocation.
 */
export function getClearRefreshTokenCookieOptions(
  overrides?: Partial<CookieOptions>,
): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/v1/auth',
    ...overrides,
  };
}
