import { logger } from '../logger.js';
import type {
  EmailProvider,
  SendEmailOptions,
} from './emailProvider.interface.js';

/**
 * Development & test email provider that logs the full email message
 * (including links and tokens) at info level.
 * Blocked from running in production environments by env validation.
 */
export class LogEmailProvider implements EmailProvider {
  async send(options: SendEmailOptions): Promise<void> {
    logger.info(
      {
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      },
      `[EMAIL DISPATCHED] Subject: "${options.subject}" To: "${options.to}"`,
    );
  }
}
