import type { Express } from 'express';

import {
  createTenantAndOwner,
  createStaffUser,
  createTestRestaurantAndBranch,
  type TenantAndOwnerResult,
  type StaffUserResult,
} from './authHelpers.js';
import request from 'supertest';

export interface TenantContextFixture {
  tenantId: string;
  restaurantId: string;
  owner: {
    id: string;
    email: string;
    accessToken: string;
    cookie: string;
  };
  branches: {
    main: { id: string; name: string; code: string };
    second?: { id: string; name: string; code: string };
  };
  staff: {
    admin?: { id: string; email: string; accessToken: string; cookie: string };
    manager?: {
      id: string;
      email: string;
      accessToken: string;
      cookie: string;
    };
    waiter?: { id: string; email: string; accessToken: string; cookie: string };
  };
}

export interface TwoTenantsFixture {
  tenantA: TenantContextFixture;
  tenantB: TenantContextFixture;
}

/**
 * Creates two fully populated tenants (Tenant A and Tenant B) with their
 * restaurants, branches, users, and tokens according to Task 10b specifications.
 */
export async function setupTwoTenants(
  app: Express,
): Promise<TwoTenantsFixture> {
  // -------------------------------------------------------------
  // 1. Build Tenant A
  // -------------------------------------------------------------
  const aOwnerRes: TenantAndOwnerResult = await createTenantAndOwner({
    app,
    tenantName: 'Tenant A Restaurant Group',
    slug: `tenant-a-${Math.random().toString(36).substring(2, 8)}`,
    ownerName: 'Owner A',
    email: `owner-a-${Math.random().toString(36).substring(2, 8)}@test.com`,
  });

  const aRestAndBranch = await createTestRestaurantAndBranch(
    app,
    aOwnerRes.accessToken,
    {
      name: 'A Main Branch',
      code: `AMAIN-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
    },
  );

  const aRestaurantId = (aRestAndBranch.restaurant['id'] ||
    aRestAndBranch.restaurant['_id']) as string;
  const aMainBranch = aRestAndBranch.branch;

  // Create Second Branch for Tenant A
  const aSecondBranchRes = await request(app)
    .post('/api/v1/branches')
    .set('Authorization', `Bearer ${aOwnerRes.accessToken}`)
    .send({
      name: 'A Second Branch',
      code: `ASEC-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      address: {
        line1: '456 Second Ave',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560038',
      },
      phone: '9876543212',
    });
  const aSecondBranch = aSecondBranchRes.body.data.branch as {
    id: string;
    name: string;
    code: string;
  };

  // Staff for Tenant A: ADMIN, MANAGER (branch A1), WAITER
  const aAdminRes: StaffUserResult = await createStaffUser({
    app,
    tenantId: aOwnerRes.tenant._id,
    role: 'ADMIN',
    name: 'Admin A',
    email: `admin-a-${Math.random().toString(36).substring(2, 8)}@test.com`,
  });

  const aManagerRes: StaffUserResult = await createStaffUser({
    app,
    tenantId: aOwnerRes.tenant._id,
    role: 'MANAGER',
    name: 'Manager A1',
    branchIds: [aMainBranch.id],
    email: `manager-a-${Math.random().toString(36).substring(2, 8)}@test.com`,
  });

  const aWaiterRes: StaffUserResult = await createStaffUser({
    app,
    tenantId: aOwnerRes.tenant._id,
    role: 'WAITER',
    name: 'Waiter A',
    branchIds: [aMainBranch.id],
    email: `waiter-a-${Math.random().toString(36).substring(2, 8)}@test.com`,
  });

  const tenantA: TenantContextFixture = {
    tenantId: aOwnerRes.tenant._id.toString(),
    restaurantId: aRestaurantId,
    owner: {
      id: aOwnerRes.owner._id.toString(),
      email: aOwnerRes.owner.email,
      accessToken: aOwnerRes.accessToken,
      cookie: aOwnerRes.cookie,
    },
    branches: {
      main: aMainBranch,
      second: aSecondBranch,
    },
    staff: {
      admin: {
        id: aAdminRes.user._id.toString(),
        email: aAdminRes.user.email,
        accessToken: aAdminRes.accessToken,
        cookie: aAdminRes.cookie,
      },
      manager: {
        id: aManagerRes.user._id.toString(),
        email: aManagerRes.user.email,
        accessToken: aManagerRes.accessToken,
        cookie: aManagerRes.cookie,
      },
      waiter: {
        id: aWaiterRes.user._id.toString(),
        email: aWaiterRes.user.email,
        accessToken: aWaiterRes.accessToken,
        cookie: aWaiterRes.cookie,
      },
    },
  };

  // -------------------------------------------------------------
  // 2. Build Tenant B
  // -------------------------------------------------------------
  const bOwnerRes: TenantAndOwnerResult = await createTenantAndOwner({
    app,
    tenantName: 'Tenant B Restaurant Group',
    slug: `tenant-b-${Math.random().toString(36).substring(2, 8)}`,
    ownerName: 'Owner B',
    email: `owner-b-${Math.random().toString(36).substring(2, 8)}@test.com`,
  });

  const bRestAndBranch = await createTestRestaurantAndBranch(
    app,
    bOwnerRes.accessToken,
    {
      name: 'B Main Branch',
      code: `BMAIN-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
    },
  );

  const bRestaurantId = (bRestAndBranch.restaurant['id'] ||
    bRestAndBranch.restaurant['_id']) as string;
  const bMainBranch = bRestAndBranch.branch;

  const bManagerRes: StaffUserResult = await createStaffUser({
    app,
    tenantId: bOwnerRes.tenant._id,
    role: 'MANAGER',
    name: 'Manager B',
    branchIds: [bMainBranch.id],
    email: `manager-b-${Math.random().toString(36).substring(2, 8)}@test.com`,
  });

  const tenantB: TenantContextFixture = {
    tenantId: bOwnerRes.tenant._id.toString(),
    restaurantId: bRestaurantId,
    owner: {
      id: bOwnerRes.owner._id.toString(),
      email: bOwnerRes.owner.email,
      accessToken: bOwnerRes.accessToken,
      cookie: bOwnerRes.cookie,
    },
    branches: {
      main: bMainBranch,
    },
    staff: {
      manager: {
        id: bManagerRes.user._id.toString(),
        email: bManagerRes.user.email,
        accessToken: bManagerRes.accessToken,
        cookie: bManagerRes.cookie,
      },
    },
  };

  return { tenantA, tenantB };
}
