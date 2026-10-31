import { env } from '../../config/env.js';

export interface EmailTemplate {
  subject: string;
  text: string;
  html: string;
}

/**
 * Escapes special HTML characters in user-provided content to prevent XSS injection in email clients.
 */
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Builds email verification email template with plain text and HTML versions.
 */
export function getVerificationEmailTemplate(options: {
  name: string;
  token: string;
}): EmailTemplate {
  const verifyUrl = `${env.CLIENT_URL}/verify-email?token=${encodeURIComponent(options.token)}`;
  const escapedName = escapeHtml(options.name);

  const subject = 'Verify your email address - POSAI';

  const text = `Hello ${options.name},

Thank you for registering with POSAI. Please verify your email address by opening the following link:
${verifyUrl}

This verification link is valid for 24 hours.

If you did not create a POSAI account, you can safely ignore this email.`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 32px;">
    <h2 style="color: #111827; margin-top: 0;">Welcome to POSAI, ${escapedName}!</h2>
    <p>Please click the button below to verify your email address:</p>
    <div style="margin: 24px 0;">
      <a href="${verifyUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-weight: 500; text-decoration: none; padding: 12px 24px; border-radius: 6px;">Verify Email</a>
    </div>
    <p style="color: #6b7280; font-size: 14px;">Or copy and paste this link into your browser:<br>
      <a href="${verifyUrl}" style="color: #2563eb; word-break: break-all;">${verifyUrl}</a>
    </p>
    <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0;">
    <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">This verification link will expire in 24 hours. If you did not create an account, no further action is required.</p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Builds password reset email template with plain text and HTML versions.
 */
export function getPasswordResetEmailTemplate(options: {
  name: string;
  token: string;
}): EmailTemplate {
  const resetUrl = `${env.CLIENT_URL}/reset-password?token=${encodeURIComponent(options.token)}`;
  const escapedName = escapeHtml(options.name);

  const subject = 'Reset your password - POSAI';

  const text = `Hello ${options.name},

We received a request to reset your POSAI password. Click the link below to choose a new password:
${resetUrl}

This link is valid for 1 hour.

If you did not request a password reset, you can safely ignore this email.`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 32px;">
    <h2 style="color: #111827; margin-top: 0;">Reset Your Password</h2>
    <p>Hello ${escapedName},</p>
    <p>We received a request to reset your POSAI account password. Click the button below to set a new password:</p>
    <div style="margin: 24px 0;">
      <a href="${resetUrl}" style="display: inline-block; background-color: #dc2626; color: #ffffff; font-weight: 500; text-decoration: none; padding: 12px 24px; border-radius: 6px;">Reset Password</a>
    </div>
    <p style="color: #6b7280; font-size: 14px;">Or copy and paste this link into your browser:<br>
      <a href="${resetUrl}" style="color: #2563eb; word-break: break-all;">${resetUrl}</a>
    </p>
    <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0;">
    <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">This reset link will expire in 1 hour. If you did not request a password reset, please ignore this email.</p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}
