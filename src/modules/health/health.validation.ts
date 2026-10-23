import { z } from 'zod';

export const healthDataSchema = z.object({
  status: z.enum(['healthy', 'unhealthy']),
  uptime: z.number(),
  db: z.string(),
});

export const healthSuccessResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: healthDataSchema,
});

export const healthErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  code: z.literal('SERVICE_UNAVAILABLE'),
  errors: healthDataSchema,
});
