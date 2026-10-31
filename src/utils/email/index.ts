import { env } from '../../config/env.js';
import type { EmailProvider } from './emailProvider.interface.js';
import { LogEmailProvider } from './logEmailProvider.js';
import { SmtpEmailProvider } from './smtpEmailProvider.js';

export * from './emailProvider.interface.js';
export * from './logEmailProvider.js';
export * from './smtpEmailProvider.js';

let sharedLogProvider: LogEmailProvider | null = null;
let sharedSmtpProvider: SmtpEmailProvider | null = null;

/**
 * Returns a single shared EmailProvider instance selected based on env.EMAIL_PROVIDER.
 * Services must always call getEmailProvider().send(...) at call time so tests can
 * spy on or mock getEmailProvider().send.
 */
export function getEmailProvider(): EmailProvider {
  if (env.EMAIL_PROVIDER === 'smtp') {
    if (!sharedSmtpProvider) {
      sharedSmtpProvider = new SmtpEmailProvider();
    }
    return sharedSmtpProvider;
  }

  if (!sharedLogProvider) {
    sharedLogProvider = new LogEmailProvider();
  }
  return sharedLogProvider;
}
