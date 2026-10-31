import { z } from 'zod';
import {
  indianPhoneSchema,
  pincodeSchema,
  ianaTimezoneSchema,
} from '../../utils/validators.js';

export const branchAddressSchema = z
  .object({
    line1: z.string().trim().min(1, 'Address line1 is required'),
    line2: z.string().trim().optional(),
    city: z.string().trim().min(1, 'City is required'),
    state: z.string().trim().min(1, 'State is required'),
    pincode: pincodeSchema,
  })
  .strict();

export const createBranchSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Branch name must be between 2 and 100 characters')
      .max(100, 'Branch name must be between 2 and 100 characters'),
    code: z
      .string()
      .trim()
      .transform((val) => val.toUpperCase())
      .refine(
        (val) => /^[A-Z0-9-]{2,10}$/.test(val),
        'Branch code must be 2-10 characters consisting of uppercase letters, digits, or hyphens',
      ),
    address: branchAddressSchema,
    phone: indianPhoneSchema.optional(),
    timezone: ianaTimezoneSchema.default('Asia/Kolkata'),
    currency: z
      .literal('INR', {
        error: 'Currency must be INR',
      })
      .default('INR'),
  })
  .strict();

export type CreateBranchInput = z.infer<typeof createBranchSchema>;

export const updateBranchSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Branch name must be between 2 and 100 characters')
      .max(100, 'Branch name must be between 2 and 100 characters')
      .optional(),
    address: branchAddressSchema.optional(),
    phone: indianPhoneSchema.optional(),
    timezone: ianaTimezoneSchema.optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    'Update payload must contain at least one field',
  );

export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

export const branchResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  restaurantId: z.string(),
  name: z.string(),
  code: z.string(),
  address: branchAddressSchema,
  phone: z.string().optional(),
  timezone: z.string(),
  currency: z.string(),
  isMain: z.boolean(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
