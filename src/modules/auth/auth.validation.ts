import { z } from 'zod';

export const signupSchema = z
  .object({
    businessName: z
      .string()
      .trim()
      .min(2, 'businessName must be between 2 and 100 characters')
      .max(100, 'businessName must be between 2 and 100 characters'),
    name: z
      .string()
      .trim()
      .min(2, 'name must be between 2 and 100 characters')
      .max(100, 'name must be between 2 and 100 characters'),
    email: z.string().trim().email('Invalid email address').toLowerCase(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .refine(
        (val) => Buffer.byteLength(val, 'utf8') <= 72,
        'Password cannot exceed 72 bytes',
      ),
    phone: z.string().trim().optional(),
  })
  .strict();

export type SignupInput = z.infer<typeof signupSchema>;

export const signupSuccessResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    user: z.object({
      id: z.string(),
      tenantId: z.string(),
      name: z.string(),
      email: z.string(),
      role: z.literal('OWNER'),
      emailVerified: z.boolean(),
    }),
  }),
});
