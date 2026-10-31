import { z } from 'zod';
import { AppError } from './appError.js';

/**
 * Validates and normalizes Indian phone numbers:
 * Accepts 10 digits starting with 6-9, or prefixed with +91.
 * Removes spaces/dashes and stores strictly as +91XXXXXXXXXX.
 */
export const indianPhoneSchema = z
  .string()
  .trim()
  .transform((val) => val.replace(/[\s-]/g, ''))
  .refine((val) => /^(\+91)?[6-9]\d{9}$/.test(val), {
    message:
      'Invalid Indian phone number. Must be 10 digits starting with 6-9, optionally prefixed with +91',
  })
  .transform((val) => (val.startsWith('+91') ? val : `+91${val}`));

/**
 * GSTIN regex: 2 digits, 5 uppercase letters (PAN), 4 digits, 1 letter, 1 alphanumeric entity code, 'Z', 1 alphanumeric check code.
 */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Validates and normalizes GSTIN (trims and converts to uppercase).
 */
export const gstinSchema = z
  .string()
  .trim()
  .transform((val) => val.toUpperCase())
  .refine((val) => GSTIN_REGEX.test(val), {
    message: 'Invalid GSTIN format',
  });

/**
 * Validates FSSAI license number (exactly 14 digits).
 */
export const fssaiSchema = z
  .string()
  .trim()
  .regex(/^\d{14}$/, 'FSSAI license number must be exactly 14 digits');

/**
 * Validates Indian 6-digit postal PIN code (first digit 1-9).
 */
export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, 'Invalid Indian PIN code');

/**
 * Validates an IANA timezone identifier via Intl.DateTimeFormat.
 */
export const ianaTimezoneSchema = z
  .string()
  .trim()
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid IANA timezone' },
  );

/**
 * Validates a MongoDB ObjectId param string.
 * Throws AppError with status 400 and code INVALID_ID if invalid.
 */
export function objectIdParam(id: string): string {
  if (!id || typeof id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(id)) {
    throw new AppError('Invalid identifier provided', 400, 'INVALID_ID');
  }
  return id;
}

/**
 * Zod schema for 24-character hexadecimal MongoDB ObjectId.
 */
export const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid identifier format');
