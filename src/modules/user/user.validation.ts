import { z } from 'zod';
import { restaurantResponseSchema } from '../restaurant/index.js';
import { branchResponseSchema } from '../branch/index.js';
import { indianPhoneSchema } from '../../utils/validators.js';

export const getMeUserSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
  role: z.enum(['OWNER', 'ADMIN', 'MANAGER', 'WAITER', 'CASHIER', 'CHEF']),
  branchIds: z.array(z.string()),
  emailVerified: z.boolean(),
  mustChangePassword: z.boolean(),
});

export const getMeTenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
});

export const getMeResponseDataSchema = z.object({
  user: getMeUserSchema,
  tenant: getMeTenantSchema,
  restaurant: restaurantResponseSchema.nullable(),
  branches: z.array(branchResponseSchema),
});

export const userResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
  role: z.enum(['OWNER', 'ADMIN', 'MANAGER', 'WAITER', 'CASHIER', 'CHEF']),
  branchIds: z.array(z.string()),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  emailVerified: z.boolean(),
  mustChangePassword: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createStaffSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Name must be between 2 and 100 characters')
      .max(100, 'Name must be between 2 and 100 characters'),
    email: z.string().trim().email('Invalid email address').toLowerCase(),
    phone: indianPhoneSchema.optional(),
    role: z.enum(['OWNER', 'ADMIN', 'MANAGER', 'WAITER', 'CASHIER', 'CHEF']),
    branchIds: z.array(z.string()).default([]),
  })
  .strict();

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Name must be between 2 and 100 characters')
      .max(100, 'Name must be between 2 and 100 characters')
      .optional(),
    phone: indianPhoneSchema.optional(),
    role: z
      .enum(['OWNER', 'ADMIN', 'MANAGER', 'WAITER', 'CASHIER', 'CHEF'])
      .optional(),
    branchIds: z.array(z.string()).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    'Update payload must contain at least one field',
  );

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

export const updateMeSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Name must be between 2 and 100 characters')
      .max(100, 'Name must be between 2 and 100 characters')
      .optional(),
    phone: indianPhoneSchema.optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    'Update payload must contain at least one field',
  );

export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  role: z
    .enum(['OWNER', 'ADMIN', 'MANAGER', 'WAITER', 'CASHIER', 'CHEF'])
    .optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  branchId: z.string().optional(),
  q: z.string().trim().max(50).optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const createStaffResponseSchema = z.object({
  user: userResponseSchema,
  temporaryPassword: z.string(),
});

export const resetPasswordResponseSchema = z.object({
  temporaryPassword: z.string(),
});

export const paginatedUsersResponseSchema = z.object({
  items: z.array(userResponseSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
});
