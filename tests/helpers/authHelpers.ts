import request from 'supertest';
import type { Express } from 'express';
import { Types } from 'mongoose';
import { Tenant, type TenantDocument } from '../../src/modules/tenant/index.js';
import {
  User,
  UserService,
  type UserDocument,
  type Role,
} from '../../src/modules/user/index.js';
import { hashPassword } from '../../src/utils/password.js';
import { runWithTenant } from '../../src/utils/tenantContext.js';
import { withGlobalScope } from '../../src/utils/tenantBypass.js';

export interface CreateTenantAndOwnerOptions {
  app: Express;
  tenantName?: string;
  slug?: string;
  ownerName?: string;
  email?: string;
  phone?: string;
  password?: string;
  emailVerified?: boolean;
  mustChangePassword?: boolean;
}

export interface TenantAndOwnerResult {
  tenant: TenantDocument;
  owner: UserDocument;
  plainPassword: string;
  accessToken: string;
  cookie: string;
}

/**
 * Creates a tenant and an initial OWNER user, then performs login to obtain access token & cookie.
 */
export async function createTenantAndOwner(
  options: CreateTenantAndOwnerOptions,
): Promise<TenantAndOwnerResult> {
  const tenantName = options.tenantName ?? 'Test Restaurant Group';
  const slug =
    options.slug ?? `rest-${Math.random().toString(36).substring(2, 8)}`;
  const email = (
    options.email ??
    `owner-${Math.random().toString(36).substring(2, 8)}@test.com`
  )
    .trim()
    .toLowerCase();
  const plainPassword = options.password ?? 'ValidPassword123!';
  const passwordHash = await hashPassword(plainPassword);

  const tenant = await Tenant.create({
    name: tenantName,
    slug,
    status: 'ACTIVE',
  });

  const owner = await runWithTenant(tenant._id, async () => {
    return UserService.createUser({
      name: options.ownerName ?? 'Owner User',
      email,
      phone: options.phone,
      passwordHash,
      role: 'OWNER',
      emailVerified: options.emailVerified ?? true,
    });
  });

  if (options.mustChangePassword) {
    await withGlobalScope(async () => {
      await User.updateOne(
        { _id: owner._id },
        { $set: { mustChangePassword: true } },
      );
    });
  }

  const loginRes = await request(options.app)
    .post('/api/v1/auth/login')
    .send({ email, password: plainPassword });

  const accessToken = loginRes.body.data?.accessToken as string;
  const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';

  return {
    tenant,
    owner,
    plainPassword,
    accessToken,
    cookie,
  };
}

export interface CreateStaffUserOptions {
  app: Express;
  tenantId: Types.ObjectId | string;
  role: Role;
  branchIds?: Array<string | Types.ObjectId>;
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  emailVerified?: boolean;
  mustChangePassword?: boolean;
}

export interface StaffUserResult {
  user: UserDocument;
  plainPassword: string;
  accessToken: string;
  cookie: string;
}

/**
 * Creates a staff user with a specified role and branchIds within a given tenant, and logs in.
 */
export async function createStaffUser(
  options: CreateStaffUserOptions,
): Promise<StaffUserResult> {
  const email = (
    options.email ??
    `${options.role.toLowerCase()}-${Math.random().toString(36).substring(2, 8)}@test.com`
  )
    .trim()
    .toLowerCase();
  const plainPassword = options.password ?? 'StaffPassword123!';
  const passwordHash = await hashPassword(plainPassword);

  const user = await runWithTenant(options.tenantId, async () => {
    const created = await UserService.createUser({
      name: options.name ?? `${options.role} Staff`,
      email,
      phone: options.phone,
      passwordHash,
      role: options.role,
      emailVerified: options.emailVerified ?? true,
    });

    if (options.branchIds && options.branchIds.length > 0) {
      await User.updateOne(
        { _id: created._id },
        { $set: { branchIds: options.branchIds } },
      );
    }

    if (options.mustChangePassword) {
      await User.updateOne(
        { _id: created._id },
        { $set: { mustChangePassword: true } },
      );
    }

    return created;
  });

  const loginRes = await request(options.app)
    .post('/api/v1/auth/login')
    .send({ email, password: plainPassword });

  const accessToken = loginRes.body.data?.accessToken as string;
  const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';

  return {
    user,
    plainPassword,
    accessToken,
    cookie,
  };
}

/**
 * Creates a restaurant and an initial main branch for a tenant using the owner's credentials.
 */
export async function createTestRestaurantAndBranch(
  app: Express,
  ownerAccessToken: string,
  branchOptions?: { name?: string; code?: string },
): Promise<{
  restaurant: Record<string, unknown>;
  branch: Record<string, unknown> & { id: string; name: string; code: string };
}> {
  const restRes = await request(app)
    .post('/api/v1/restaurant')
    .set('Authorization', `Bearer ${ownerAccessToken}`)
    .send({
      name: 'Default Test Restaurant',
      phone: '9876543210',
      email: 'test@restaurant.com',
      address: {
        line1: '123 Main St',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
    });

  const branchCode =
    branchOptions?.code ??
    `BR-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  const branchRes = await request(app)
    .post('/api/v1/branches')
    .set('Authorization', `Bearer ${ownerAccessToken}`)
    .send({
      name: branchOptions?.name ?? 'Main Branch',
      code: branchCode,
      address: {
        line1: '123 Main St',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
      phone: '9876543210',
    });

  return {
    restaurant: restRes.body.data?.restaurant,
    branch: branchRes.body.data?.branch,
  };
}
