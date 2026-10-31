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
