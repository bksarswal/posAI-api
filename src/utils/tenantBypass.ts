import { tenantStorage } from './tenantContext.js';

/**
 * Executes an operation with tenant-scoping bypassed.
 *
 * This is the ONLY approved bypass API in the system.
 * Legitimate cross-tenant query cases governed by this utility:
 * 1. User lookup by email during authentication (login).
 * 2. Email uniqueness check during owner signup.
 * 3. User lookup by verification token hash during email verification.
 * 4. User lookup by password reset token hash during password reset.
 * 5. Refresh token lookup by tokenHash during session refresh and logout.
 */
export async function withGlobalScope<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ bypassTenantScope: true }, fn);
}
