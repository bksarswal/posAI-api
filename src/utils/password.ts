import bcryptjs from 'bcryptjs';
import { env } from '../config/env.js';

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
