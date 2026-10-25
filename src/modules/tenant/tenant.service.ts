import type { ClientSession } from 'mongoose';
import { Tenant } from './tenant.model.js';
import type { TenantDocument } from './tenant.interface.js';

export interface CreateTenantInput {
  name: string;
  slug: string;
}

/**
 * Creates a new Tenant record.
 */
export async function createTenant(
  input: CreateTenantInput,
  options?: { session?: ClientSession },
): Promise<TenantDocument> {
  const [tenant] = await Tenant.create([input], options);
  if (!tenant) {
    throw new Error('Failed to create Tenant');
  }
  return tenant;
}

/**
 * Finds a tenant by its unique ID.
 */
export async function findTenantById(
  id: string,
): Promise<TenantDocument | null> {
  return Tenant.findById(id);
}
