import { describe, it, expect } from 'vitest';
import {
  indianPhoneSchema,
  gstinSchema,
  fssaiSchema,
  pincodeSchema,
  ianaTimezoneSchema,
  objectIdParam,
  objectIdSchema,
} from '../../src/utils/validators.js';
import { AppError } from '../../src/utils/appError.js';

describe('Unit Tests: Shared Validators (src/utils/validators.ts)', () => {
  describe('indianPhoneSchema', () => {
    it('accepts 10 digits starting 6-9 and stores as +91XXXXXXXXXX', () => {
      expect(indianPhoneSchema.parse('9876543210')).toBe('+919876543210');
      expect(indianPhoneSchema.parse('6123456789')).toBe('+916123456789');
      expect(indianPhoneSchema.parse('7000000000')).toBe('+917000000000');
      expect(indianPhoneSchema.parse('8999999999')).toBe('+918999999999');
    });

    it('accepts +91 prefix and formats with spaces or dashes', () => {
      expect(indianPhoneSchema.parse('+919876543210')).toBe('+919876543210');
      expect(indianPhoneSchema.parse('+91 98765 43210')).toBe('+919876543210');
      expect(indianPhoneSchema.parse('+91-9876543210')).toBe('+919876543210');
    });

    it('rejects numbers starting with 0-5', () => {
      expect(() => indianPhoneSchema.parse('5999999999')).toThrow();
      expect(() => indianPhoneSchema.parse('0999999999')).toThrow();
      expect(() => indianPhoneSchema.parse('+915999999999')).toThrow();
    });

    it('rejects numbers with wrong length', () => {
      expect(() => indianPhoneSchema.parse('987654321')).toThrow();
      expect(() => indianPhoneSchema.parse('98765432100')).toThrow();
      expect(() => indianPhoneSchema.parse('+19876543210')).toThrow();
    });
  });

  describe('gstinSchema', () => {
    it('trims, uppercases, and accepts valid GSTIN formats', () => {
      const validGstin = '29ABCDE1234F1Z5';
      expect(gstinSchema.parse(validGstin)).toBe('29ABCDE1234F1Z5');
      expect(gstinSchema.parse('  29abcde1234f1z5  ')).toBe('29ABCDE1234F1Z5');
    });

    it('rejects invalid GSTIN formats', () => {
      expect(() => gstinSchema.parse('29ABCDE1234F1')).toThrow();
      expect(() => gstinSchema.parse('29ABCDE1234F15Z')).toThrow();
      expect(() => gstinSchema.parse('ABCDE1234F1Z529')).toThrow();
    });
  });

  describe('fssaiSchema', () => {
    it('accepts exactly 14 digits', () => {
      expect(fssaiSchema.parse('12345678901234')).toBe('12345678901234');
      expect(fssaiSchema.parse(' 12345678901234 ')).toBe('12345678901234');
    });

    it('rejects numbers with less or more than 14 digits or non-digits', () => {
      expect(() => fssaiSchema.parse('1234567890123')).toThrow();
      expect(() => fssaiSchema.parse('123456789012345')).toThrow();
      expect(() => fssaiSchema.parse('1234567890123A')).toThrow();
    });
  });

  describe('pincodeSchema', () => {
    it('accepts 6-digit PIN codes starting with 1-9', () => {
      expect(pincodeSchema.parse('560001')).toBe('560001');
      expect(pincodeSchema.parse('110001')).toBe('110001');
      expect(pincodeSchema.parse(' 700001 ')).toBe('700001');
    });

    it('rejects PIN codes starting with 0 or having wrong length', () => {
      expect(() => pincodeSchema.parse('056001')).toThrow();
      expect(() => pincodeSchema.parse('56000')).toThrow();
      expect(() => pincodeSchema.parse('5600001')).toThrow();
      expect(() => pincodeSchema.parse('56000A')).toThrow();
    });
  });

  describe('ianaTimezoneSchema', () => {
    it('accepts valid IANA timezones', () => {
      expect(ianaTimezoneSchema.parse('Asia/Kolkata')).toBe('Asia/Kolkata');
      expect(ianaTimezoneSchema.parse('UTC')).toBe('UTC');
      expect(ianaTimezoneSchema.parse('America/New_York')).toBe(
        'America/New_York',
      );
    });

    it('rejects invalid or unrecognized timezone strings', () => {
      expect(() => ianaTimezoneSchema.parse('Invalid/Timezone')).toThrow();
      expect(() => ianaTimezoneSchema.parse('Asia/Mars')).toThrow();
      expect(() => ianaTimezoneSchema.parse('NotATimezone')).toThrow();
    });
  });

  describe('objectIdParam & objectIdSchema', () => {
    const validId = '507f1f77bcf86cd799439011';

    it('accepts valid 24-character hexadecimal MongoDB ObjectId', () => {
      expect(objectIdParam(validId)).toBe(validId);
      expect(objectIdSchema.parse(validId)).toBe(validId);
    });

    it('throws AppError 400 INVALID_ID on invalid ObjectId strings', () => {
      expect(() => objectIdParam('123')).toThrowError(AppError);
      try {
        objectIdParam('123');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe('INVALID_ID');
      }

      expect(() => objectIdParam('507f1f77bcf86cd79943901z')).toThrow();
      expect(() => objectIdParam('')).toThrow();
      // @ts-expect-error test invalid type
      expect(() => objectIdParam(null)).toThrow();
    });
  });
});
