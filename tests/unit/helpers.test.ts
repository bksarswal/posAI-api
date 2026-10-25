import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/utils/password.js';
import { generateToken, hashToken } from '../../src/utils/token.js';

describe('Password & Token Helpers', () => {
  describe('password.ts (bcryptjs)', () => {
    it('successfully hashes and verifies a password round-trip', async () => {
      const plain = 'SuperSecret123!';
      const hash = await hashPassword(plain);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).not.toBe(plain);

      const isValid = await verifyPassword(plain, hash);
      expect(isValid).toBe(true);
    });

    it('returns false when verifying an incorrect password', async () => {
      const plain = 'SuperSecret123!';
      const hash = await hashPassword(plain);

      const isWrongValid = await verifyPassword('WrongPassword!', hash);
      expect(isWrongValid).toBe(false);
    });

    it('produces distinct salt hashes for the same password', async () => {
      const plain = 'SamePassword456!';
      const hash1 = await hashPassword(plain);
      const hash2 = await hashPassword(plain);

      expect(hash1).not.toBe(hash2);
      expect(await verifyPassword(plain, hash1)).toBe(true);
      expect(await verifyPassword(plain, hash2)).toBe(true);
    });
  });

  describe('token.ts (crypto)', () => {
    it('generates unique random tokens with expected base64url length', () => {
      const token1 = generateToken();
      const token2 = generateToken();

      expect(token1).not.toBe(token2);
      // 32 bytes encoded in base64url has length 43 (without padding)
      expect(token1.length).toBe(43);
      expect(token2.length).toBe(43);
      // base64url charset check: letters, digits, hyphen, underscore
      expect(/^[A-Za-z0-9_-]+$/.test(token1)).toBe(true);
    });

    it('produces a deterministic 64-character hexadecimal SHA-256 hash', () => {
      const token = 'sample_raw_token_value_abc123';
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(hash1)).toBe(true);
    });
  });
});
