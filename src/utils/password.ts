import crypto from 'node:crypto';
import bcryptjs from 'bcryptjs';
import { env } from '../config/env.js';

/**
 * Character set without visually ambiguous look-alikes (excludes 0, O, 1, l, I).
 */
export const UNAMBIGUOUS_PASSWORD_ALPHABET =
  '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Generates a 12-character cryptographically secure temporary password
 * from an alphabet without look-alike characters (no 0, O, 1, l, I).
 * The result always satisfies the 8-72 character passwordSchema constraint.
 */
export function generateTemporaryPassword(): string {
  const chars = UNAMBIGUOUS_PASSWORD_ALPHABET;
  let password = '';
  for (let i = 0; i < 12; i++) {
    const idx = crypto.randomInt(0, chars.length);
    password += chars[idx];
  }
  return password;
}

/**
 * Hashes a plaintext password using bcryptjs and the configured work factor.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcryptjs.hash(plain, env.BCRYPT_ROUNDS);
}

/**
 * Verifies a plaintext password against a stored bcrypt hash.
 */
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcryptjs.compare(plain, hash);
}
