import crypto from 'node:crypto';

/**
 * Generates a cryptographically secure random token (32 bytes encoded as base64url).
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Hashes a token using SHA-256 and returns a deterministic 64-character hexadecimal digest.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
