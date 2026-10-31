import { z } from 'zod';
import { restaurantResponseSchema } from '../restaurant/index.js';
import { branchResponseSchema } from '../branch/index.js';

export const getMeUserSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  email: z.string().email(),
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
