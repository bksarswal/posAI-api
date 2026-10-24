import { AsyncLocalStorage } from 'node:async_hooks';
import type { Types } from 'mongoose';

export interface TenantStore {
  tenantId?: Types.ObjectId;
  bypassTenantScope?: boolean;
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

/**
 * Returns the active tenantId from the AsyncLocalStorage store, if present.
 */
export function getTenantId(): Types.ObjectId | undefined {
  return tenantStorage.getStore()?.tenantId;
}

/**
 * Checks if the current execution context explicitly bypasses tenant scoping.
 */
export function isTenantBypassed(): boolean {
  return tenantStorage.getStore()?.bypassTenantScope === true;
}

/**
 * Executes a function within the context of a specific tenantId.
 */
export async function runWithTenant<T>(
  tenantId: Types.ObjectId,
  fn: () => Promise<T>,
): Promise<T> {
  return tenantStorage.run({ tenantId, bypassTenantScope: false }, fn);
}
