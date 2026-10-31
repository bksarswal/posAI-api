import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine(
    (val) => Buffer.byteLength(val, 'utf8') <= 72,
    'Password cannot exceed 72 bytes',
  );

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
    password: passwordSchema,
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

export const loginSchema = z
  .object({
    email: z.string().trim().email('Invalid email address').toLowerCase(),
    password: z.string().min(1, 'Password is required'),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

export const loginSuccessResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    accessToken: z.string(),
    user: z.object({
      id: z.string(),
      tenantId: z.string(),
      name: z.string(),
      email: z.string(),
      role: z.enum(['OWNER', 'ADMIN', 'MANAGER', 'WAITER', 'CASHIER', 'CHEF']),
      emailVerified: z.boolean().optional(),
      branchIds: z.array(z.string()),
      mustChangePassword: z.boolean(),
    }),
  }),
});

export const refreshSuccessResponseSchema = loginSuccessResponseSchema;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
  })
  .strict()
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const changePasswordSuccessResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

export const authGenericSuccessResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

export const verifyEmailSchema = z
  .object({
    token: z.string().min(1, 'Verification token is required'),
  })
  .strict();

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resendVerificationSchema = z
  .object({
    email: z.string().trim().email('Invalid email address').toLowerCase(),
  })
  .strict();

export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

export const forgotPasswordSchema = z
  .object({
    email: z.string().trim().email('Invalid email address').toLowerCase(),
  })
  .strict();

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, 'Reset token is required'),
    newPassword: passwordSchema,
  })
  .strict();

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
