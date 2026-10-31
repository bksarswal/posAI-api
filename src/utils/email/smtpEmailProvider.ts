import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../logger.js';
import type {
  EmailProvider,
  SendEmailOptions,
} from './emailProvider.interface.js';

/**
 * Production email provider that dispatches transactional emails via SMTP using nodemailer.
 */
export class SmtpEmailProvider implements EmailProvider {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }

  async send(options: SendEmailOptions): Promise<void> {
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    logger.info(
      { to: options.to, subject: options.subject },
      'Email dispatched via SmtpEmailProvider',
    );
  }
}
