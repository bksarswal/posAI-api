import { z } from 'zod';
import {
  indianPhoneSchema,
  gstinSchema,
  fssaiSchema,
  pincodeSchema,
} from '../../utils/validators.js';

export const restaurantAddressSchema = z
  .object({
    line1: z.string().trim().min(1, 'Address line1 is required'),
    line2: z.string().trim().optional(),
    city: z.string().trim().min(1, 'City is required'),
    state: z.string().trim().min(1, 'State is required'),
    pincode: pincodeSchema,
  })
  .strict();

export const createRestaurantSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Restaurant name must be between 2 and 100 characters')
      .max(100, 'Restaurant name must be between 2 and 100 characters'),
    gstin: gstinSchema.optional(),
    fssai: fssaiSchema.optional(),
    phone: indianPhoneSchema,
    email: z.string().trim().email('Invalid email address').toLowerCase(),
    address: restaurantAddressSchema,
    logoUrl: z
      .string()
      .trim()
      .max(500, 'logoUrl cannot exceed 500 characters')
      .url('logoUrl must be a valid URL')
      .refine(
        (url) => url.startsWith('https://'),
        'logoUrl must be a secure https URL',
      )
      .optional(),
  })
  .strict();

export type CreateRestaurantInput = z.infer<typeof createRestaurantSchema>;

export const updateRestaurantSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Restaurant name must be between 2 and 100 characters')
      .max(100, 'Restaurant name must be between 2 and 100 characters')
      .optional(),
    gstin: gstinSchema.optional(),
    fssai: fssaiSchema.optional(),
    phone: indianPhoneSchema.optional(),
    email: z
      .string()
      .trim()
      .email('Invalid email address')
      .toLowerCase()
      .optional(),
    address: restaurantAddressSchema.optional(),
    logoUrl: z
      .string()
      .trim()
      .max(500, 'logoUrl cannot exceed 500 characters')
      .url('logoUrl must be a valid URL')
      .refine(
        (url) => url.startsWith('https://'),
        'logoUrl must be a secure https URL',
      )
      .optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    'Update payload must contain at least one field',
  );

export type UpdateRestaurantInput = z.infer<typeof updateRestaurantSchema>;

export const restaurantResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  gstin: z.string().optional(),
  fssai: z.string().optional(),
  phone: z.string(),
  email: z.string(),
  address: restaurantAddressSchema,
  logoUrl: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
