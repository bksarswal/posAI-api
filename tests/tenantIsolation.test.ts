import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  startTestDb,
  clearAllCollections,
  stopTestDb,
} from './helpers/testDb.js';
import {
  setupTwoTenants,
  type TwoTenantsFixture,
} from './helpers/twoTenants.js';
import { getOpenAPIDocument } from '../src/config/openapi.js';
import { Branch } from '../src/modules/branch/branch.model.js';
import { User } from '../src/modules/user/user.model.js';
import { Restaurant } from '../src/modules/restaurant/restaurant.model.js';
import { withGlobalScope } from '../src/utils/tenantBypass.js';

export interface EndpointDescriptor {
  method: 'get' | 'post' | 'patch' | 'delete' | 'put';
  pathTemplate: string;
  kind: 'tenant-scoped' | 'exempt';
  build?: (ctx: TwoTenantsFixture) => {
    path: string;
    body?: Record<string, unknown>;
    targetResource?: 'branch' | 'user';
    targetId?: string;
  };
  expectedStatus?: number;
  reason?: string;
}

export const ENDPOINT_MATRIX: EndpointDescriptor[] = [
  // -------------------------------------------------------------
  // Tenant-Scoped Endpoints (cross-tenant access MUST return 404)
  // -------------------------------------------------------------
  {
    method: 'get',
    pathTemplate: '/api/v1/branches/{id}',
    kind: 'tenant-scoped',
    build: (ctx) => ({
      path: `/api/v1/branches/${ctx.tenantA.branches.main.id}`,
      targetResource: 'branch',
      targetId: ctx.tenantA.branches.main.id,
    }),
    expectedStatus: 404,
  },
  {
    method: 'patch',
    pathTemplate: '/api/v1/branches/{id}',
    kind: 'tenant-scoped',
    build: (ctx) => ({
      path: `/api/v1/branches/${ctx.tenantA.branches.main.id}`,
      body: { name: 'Hacked Branch Name by Tenant B' },
      targetResource: 'branch',
      targetId: ctx.tenantA.branches.main.id,
    }),
    expectedStatus: 404,
  },
  {
    method: 'get',
    pathTemplate: '/api/v1/users/{id}',
    kind: 'tenant-scoped',
    build: (ctx) => ({
      path: `/api/v1/users/${ctx.tenantA.staff.manager!.id}`,
      targetResource: 'user',
      targetId: ctx.tenantA.staff.manager!.id,
    }),
    expectedStatus: 404,
  },
  {
    method: 'patch',
    pathTemplate: '/api/v1/users/{id}',
    kind: 'tenant-scoped',
    build: (ctx) => ({
      path: `/api/v1/users/${ctx.tenantA.staff.manager!.id}`,
      body: { name: 'Hacked User Name by Tenant B' },
      targetResource: 'user',
      targetId: ctx.tenantA.staff.manager!.id,
    }),
    expectedStatus: 404,
  },
  {
    method: 'post',
    pathTemplate: '/api/v1/users/{id}/reset-password',
    kind: 'tenant-scoped',
    build: (ctx) => ({
      path: `/api/v1/users/${ctx.tenantA.staff.manager!.id}/reset-password`,
      targetResource: 'user',
      targetId: ctx.tenantA.staff.manager!.id,
    }),
    expectedStatus: 404,
  },

  // -------------------------------------------------------------
  // Exempt Endpoints (with explicit reasons)
  // -------------------------------------------------------------
  {
    method: 'get',
    pathTemplate: '/health',
    kind: 'exempt',
    reason: 'Public system health check with no tenant-specific data',
  },
  {
    method: 'post',
    pathTemplate: '/api/v1/auth/signup',
    kind: 'exempt',
    reason: 'Public onboarding endpoint creating a brand-new tenant and owner',
  },
  {
    method: 'post',
    pathTemplate: '/api/v1/auth/login',
    kind: 'exempt',
    reason:
      'Public credential exchange resolving tenant context from user identity',
  },
  {
    method: 'post',
    pathTemplate: '/api/v1/auth/logout',
    kind: 'exempt',
    reason: 'Terminates caller own session/refresh token',
  },
  {
    method: 'post',
    pathTemplate: '/api/v1/auth/refresh',
    kind: 'exempt',
    reason: 'Rotates caller own refresh token and issues caller access token',
  },
  {
    method: 'post',
    pathTemplate: '/api/v1/auth/change-password',
    kind: 'exempt',
    reason: 'Modifies authenticated caller own password',
  },
  {
    method: 'post',
    pathTemplate: '/api/v1/auth/verify-email',
    kind: 'exempt',
    reason:
      'Public token verification acting on the user associated with the token',
  },
  {
    method: 'post',
    pathTemplate: '/api/v1/auth/resend-verification',
    kind: 'exempt',
    reason: 'Public action looking up unverified user by email',
  },
  {
    method: 'post',
    pathTemplate: '/api/v1/auth/forgot-password',
    kind: 'exempt',
    reason: 'Public password reset initiation looking up user by email',
  },
  {
    method: 'post',
    pathTemplate: '/api/v1/auth/reset-password',
    kind: 'exempt',
    reason:
      'Public password reset completion using single-use cryptographic token',
  },
  {
    method: 'get',
    pathTemplate: '/api/v1/users/me',
    kind: 'exempt',
    reason:
      'Self-scoped profile endpoint returning only caller own user/tenant data',
  },
  {
    method: 'patch',
    pathTemplate: '/api/v1/users/me',
    kind: 'exempt',
    reason: 'Self-scoped profile update modifying only caller own user record',
  },
  {
    method: 'post',
    pathTemplate: '/api/v1/restaurant',
    kind: 'exempt',
    reason: 'Creates the singleton restaurant for caller own tenant',
  },
  {
    method: 'get',
    pathTemplate: '/api/v1/restaurant',
    kind: 'exempt',
    reason:
      'Self-scoped retrieval of singleton restaurant for caller own tenant',
  },
  {
    method: 'patch',
    pathTemplate: '/api/v1/restaurant',
    kind: 'exempt',
    reason: 'Self-scoped update of singleton restaurant for caller own tenant',
  },
  {
    method: 'post',
    pathTemplate: '/api/v1/branches',
    kind: 'exempt',
    reason: 'Creates a branch scoped strictly under caller own tenant',
  },
  {
    method: 'get',
    pathTemplate: '/api/v1/branches',
    kind: 'exempt',
    reason:
      'List endpoint returning branches strictly belonging to caller own tenant',
  },
  {
    method: 'post',
    pathTemplate: '/api/v1/users',
    kind: 'exempt',
    reason:
      'Staff creation endpoint provisioning users strictly within caller own tenant',
  },
  {
    method: 'get',
    pathTemplate: '/api/v1/users',
    kind: 'exempt',
    reason:
      'List endpoint returning staff users strictly belonging to caller own tenant',
  },
];

describe('Task 10b: Tenant-Isolation Test Suite & Coverage Guard', () => {
  const app = createApp({
    rateLimits: {
      global: { windowMs: 60000, max: 10000 },
      signupIp: { windowMs: 60000, max: 10000 },
      signupIpEmail: { windowMs: 60000, max: 10000 },
      loginIp: { windowMs: 60000, max: 10000 },
      loginIpEmail: { windowMs: 60000, max: 10000 },
      refreshIp: { windowMs: 60000, max: 10000 },
      changePassword: { windowMs: 60000, max: 10000 },
      verifyEmailIp: { windowMs: 60000, max: 10000 },
      resendVerificationIp: { windowMs: 60000, max: 10000 },
      resendVerificationIpEmail: { windowMs: 60000, max: 10000 },
      forgotPasswordIp: { windowMs: 60000, max: 10000 },
      forgotPasswordIpEmail: { windowMs: 60000, max: 10000 },
      resetPasswordIp: { windowMs: 60000, max: 10000 },
      userResetPassword: { windowMs: 60000, max: 10000 },
    },
  });

  let fixture: TwoTenantsFixture;

  beforeAll(async () => {
    await startTestDb();
  }, 60000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    await clearAllCollections();
    fixture = await setupTwoTenants(app);
  });

  // -------------------------------------------------------------
  // 1. OpenAPI Coverage Guard
  // -------------------------------------------------------------
  describe('Coverage Guard: OpenAPI Specification Completeness', () => {
    it('ensures every operation in OpenAPI 3.1 is covered in ENDPOINT_MATRIX with no extras', () => {
      const doc = getOpenAPIDocument();
      const openApiOps = new Set<string>();

      for (const [pathTemplate, methods] of Object.entries(doc.paths || {})) {
        for (const method of Object.keys(methods || {})) {
          const m = method.toLowerCase();
          if (['get', 'post', 'patch', 'delete', 'put'].includes(m)) {
            openApiOps.add(`${m.toUpperCase()} ${pathTemplate}`);
          }
        }
      }

      const matrixOps = new Set<string>();
      for (const entry of ENDPOINT_MATRIX) {
        matrixOps.add(`${entry.method.toUpperCase()} ${entry.pathTemplate}`);
      }

      const missingFromMatrix: string[] = [];
      for (const op of openApiOps) {
        if (!matrixOps.has(op)) {
          missingFromMatrix.push(op);
        }
      }

      const extraInMatrix: string[] = [];
      for (const op of matrixOps) {
        if (!openApiOps.has(op)) {
          extraInMatrix.push(op);
        }
      }

      expect(
        missingFromMatrix,
        `Missing operations in ENDPOINT_MATRIX! Developer must add tenant-scoped or exempt entry for:\n${missingFromMatrix.join('\n')}`,
      ).toEqual([]);

      expect(
        extraInMatrix,
        `ENDPOINT_MATRIX contains operations not found in current OpenAPI document:\n${extraInMatrix.join('\n')}`,
      ).toEqual([]);
    });

    it('ensures every exempt entry has a non-empty reason', () => {
      for (const entry of ENDPOINT_MATRIX) {
        if (entry.kind === 'exempt') {
          expect(
            typeof entry.reason === 'string' && entry.reason.trim().length > 0,
            `Exempt entry ${entry.method.toUpperCase()} ${entry.pathTemplate} must have an explanatory reason`,
          ).toBe(true);
        }
      }
    });
  });

  // -------------------------------------------------------------
  // 2. Sanity Checks & Negative Controls
  // -------------------------------------------------------------
  describe('Sanity Checks & Negative Controls', () => {
    it('proves target resources actually exist in DB before attacks', async () => {
      await withGlobalScope(async () => {
        const branchA = await Branch.findById(fixture.tenantA.branches.main.id);
        expect(branchA).not.toBeNull();
        expect(branchA?.tenantId.toString()).toBe(fixture.tenantA.tenantId);

        const managerA = await User.findById(fixture.tenantA.staff.manager!.id);
        expect(managerA).not.toBeNull();
        expect(managerA?.tenantId.toString()).toBe(fixture.tenantA.tenantId);
      });
    });

    it('negative control: caller A can access own resources successfully (proves 404 for B is isolation, not a broken route)', async () => {
      const resBranchA = await request(app)
        .get(`/api/v1/branches/${fixture.tenantA.branches.main.id}`)
        .set('Authorization', `Bearer ${fixture.tenantA.owner.accessToken}`);
      expect(resBranchA.status).toBe(200);
      expect(resBranchA.body.data.branch.id).toBe(
        fixture.tenantA.branches.main.id,
      );

      const resUserA = await request(app)
        .get(`/api/v1/users/${fixture.tenantA.staff.manager!.id}`)
        .set('Authorization', `Bearer ${fixture.tenantA.owner.accessToken}`);
      expect(resUserA.status).toBe(200);
      expect(resUserA.body.data.user.id).toBe(
        fixture.tenantA.staff.manager!.id,
      );
    });
  });

  // -------------------------------------------------------------
  // 3. Cross-Tenant Attacks on All Tenant-Scoped Endpoints
  // -------------------------------------------------------------
  describe('Cross-Tenant Attack Suite on Tenant-Scoped Endpoints', () => {
    const scopedEndpoints = ENDPOINT_MATRIX.filter(
      (e) => e.kind === 'tenant-scoped',
    );

    for (const descriptor of scopedEndpoints) {
      it(`blocks Tenant B from ${descriptor.method.toUpperCase()} ${descriptor.pathTemplate} targeting Tenant A resource with 404`, async () => {
        const { path, body, targetResource, targetId } =
          descriptor.build!(fixture);

        // Snapshot resource state in DB before call
        let beforeState: Record<string, unknown> | null = null;
        if (targetResource === 'branch' && targetId) {
          beforeState = await withGlobalScope(async () => {
            const doc = await Branch.findById(targetId).lean();
            return doc as Record<string, unknown>;
          });
        } else if (targetResource === 'user' && targetId) {
          beforeState = await withGlobalScope(async () => {
            const doc = await User.findById(targetId).lean();
            return doc as Record<string, unknown>;
          });
        }

        // Execute attack as Tenant B OWNER
        let req = request(app)
          [descriptor.method](path)
          .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`);

        if (body) {
          req = req.send(body);
        }

        const res = await req;

        // 1. Assert cross-tenant rejection status is 404 (existence not leaked)
        expect(res.status).toBe(descriptor.expectedStatus ?? 404);

        // 2. Assert body contains NO data from Tenant A
        const resText = JSON.stringify(res.body);
        expect(resText).not.toContain(fixture.tenantA.tenantId);
        expect(resText).not.toContain(fixture.tenantA.owner.email);
        expect(resText).not.toContain(fixture.tenantA.branches.main.name);
        expect(resText).not.toContain(fixture.tenantA.staff.manager!.email);

        // 3. Assert target resource in DB is completely UNCHANGED
        if (targetResource === 'branch' && targetId) {
          const afterState = await withGlobalScope(async () => {
            const doc = await Branch.findById(targetId).lean();
            return doc as Record<string, unknown>;
          });
          expect(afterState?.['name']).toBe(beforeState?.['name']);
          expect(afterState?.['updatedAt']).toEqual(beforeState?.['updatedAt']);
        } else if (targetResource === 'user' && targetId) {
          const afterState = await withGlobalScope(async () => {
            const doc = await User.findById(targetId).lean();
            return doc as Record<string, unknown>;
          });
          expect(afterState?.['name']).toBe(beforeState?.['name']);
          expect(afterState?.['passwordHash']).toBe(
            beforeState?.['passwordHash'],
          );
          expect(afterState?.['updatedAt']).toEqual(beforeState?.['updatedAt']);
        }
      });
    }
  });

  // -------------------------------------------------------------
  // 4. Self-Scoped & List Isolation Assertions
  // -------------------------------------------------------------
  describe('Self-Scoped & List Isolation', () => {
    it('GET /api/v1/users/me returns strictly B profile, restaurant, and branches', async () => {
      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.tenant.id).toBe(fixture.tenantB.tenantId);
      expect(res.body.data.user.id).toBe(fixture.tenantB.owner.id);
      expect(res.body.data.restaurant.id).toBe(fixture.tenantB.restaurantId);
      expect(res.body.data.branches).toHaveLength(1);
      expect(res.body.data.branches[0].id).toBe(
        fixture.tenantB.branches.main.id,
      );

      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain(fixture.tenantA.tenantId);
      expect(bodyStr).not.toContain(fixture.tenantA.owner.id);
      expect(bodyStr).not.toContain(fixture.tenantA.restaurantId);
    });

    it('PATCH /api/v1/users/me modifies caller B and does not touch A', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`)
        .send({ name: 'Updated Owner B Name' });

      expect(res.status).toBe(200);
      expect(res.body.data.user.name).toBe('Updated Owner B Name');

      // Verify A's owner is unchanged
      const ownerAInDb = await withGlobalScope(async () =>
        User.findById(fixture.tenantA.owner.id),
      );
      expect(ownerAInDb?.name).not.toBe('Updated Owner B Name');
    });

    it('GET /api/v1/restaurant returns only B restaurant and never A', async () => {
      const res = await request(app)
        .get('/api/v1/restaurant')
        .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.restaurant.id).toBe(fixture.tenantB.restaurantId);
      expect(res.body.data.restaurant.id).not.toBe(
        fixture.tenantA.restaurantId,
      );
    });

    it('PATCH /api/v1/restaurant modifies only B restaurant and never A', async () => {
      const res = await request(app)
        .patch('/api/v1/restaurant')
        .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`)
        .send({ name: 'Brand New B Restaurant Name' });

      expect(res.status).toBe(200);
      expect(res.body.data.restaurant.name).toBe('Brand New B Restaurant Name');

      const restA = await withGlobalScope(async () =>
        Restaurant.findById(fixture.tenantA.restaurantId),
      );
      expect(restA?.name).not.toBe('Brand New B Restaurant Name');
    });

    it('GET /api/v1/branches: returns only B branches (1), total is 1, ignoring tenantId spoofing via query & header', async () => {
      const aBranchIds = [
        fixture.tenantA.branches.main.id,
        fixture.tenantA.branches.second!.id,
      ];
      const aBranchNames = [
        fixture.tenantA.branches.main.name,
        fixture.tenantA.branches.second!.name,
      ];

      // 1. Standard request
      const resStandard = await request(app)
        .get('/api/v1/branches')
        .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`);

      expect(resStandard.status).toBe(200);
      expect(resStandard.body.data.branches).toHaveLength(1);
      expect(resStandard.body.data.branches[0].id).toBe(
        fixture.tenantB.branches.main.id,
      );
      expect(resStandard.body.data.branches[0].name).toBe(
        fixture.tenantB.branches.main.name,
      );
      expect(resStandard.body.data.branches[0].tenantId).toBe(
        fixture.tenantB.tenantId,
      );

      const standardBodyStr = JSON.stringify(resStandard.body);
      expect(standardBodyStr).not.toContain(fixture.tenantA.tenantId);
      for (const aId of aBranchIds) {
        expect(standardBodyStr).not.toContain(aId);
      }
      for (const aName of aBranchNames) {
        expect(standardBodyStr).not.toContain(aName);
      }

      // 2. Query param spoofing: ?tenantId=<tenantA>
      const resQuerySpoof = await request(app)
        .get(`/api/v1/branches?tenantId=${fixture.tenantA.tenantId}`)
        .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`);

      expect(resQuerySpoof.status).toBe(200);
      expect(resQuerySpoof.body.data.branches).toHaveLength(1);
      expect(resQuerySpoof.body.data.branches[0].id).toBe(
        fixture.tenantB.branches.main.id,
      );
      expect(resQuerySpoof.body.data.branches[0].name).toBe(
        fixture.tenantB.branches.main.name,
      );
      expect(resQuerySpoof.body.data.branches[0].tenantId).toBe(
        fixture.tenantB.tenantId,
      );

      const querySpoofBodyStr = JSON.stringify(resQuerySpoof.body);
      expect(querySpoofBodyStr).not.toContain(fixture.tenantA.tenantId);
      for (const aId of aBranchIds) {
        expect(querySpoofBodyStr).not.toContain(aId);
      }
      for (const aName of aBranchNames) {
        expect(querySpoofBodyStr).not.toContain(aName);
      }

      // 3. Header spoofing: X-Tenant-Id: <tenantA>
      const resHeaderSpoof = await request(app)
        .get('/api/v1/branches')
        .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`)
        .set('X-Tenant-Id', fixture.tenantA.tenantId);

      expect(resHeaderSpoof.status).toBe(200);
      expect(resHeaderSpoof.body.data.branches).toHaveLength(1);
      expect(resHeaderSpoof.body.data.branches[0].id).toBe(
        fixture.tenantB.branches.main.id,
      );
      expect(resHeaderSpoof.body.data.branches[0].name).toBe(
        fixture.tenantB.branches.main.name,
      );
      expect(resHeaderSpoof.body.data.branches[0].tenantId).toBe(
        fixture.tenantB.tenantId,
      );

      const headerSpoofBodyStr = JSON.stringify(resHeaderSpoof.body);
      expect(headerSpoofBodyStr).not.toContain(fixture.tenantA.tenantId);
      for (const aId of aBranchIds) {
        expect(headerSpoofBodyStr).not.toContain(aId);
      }
      for (const aName of aBranchNames) {
        expect(headerSpoofBodyStr).not.toContain(aName);
      }
    });

    it('GET /api/v1/users: returns only B users, total counts only B, ignoring tenantId spoofing via query & header', async () => {
      const knownBUserIds = [
        fixture.tenantB.owner.id,
        fixture.tenantB.staff.manager!.id,
      ];
      const knownBEmails = [
        fixture.tenantB.owner.email,
        fixture.tenantB.staff.manager!.email,
      ];
      const aUserIds = [
        fixture.tenantA.owner.id,
        fixture.tenantA.staff.admin!.id,
        fixture.tenantA.staff.manager!.id,
        fixture.tenantA.staff.waiter!.id,
      ];
      const aEmails = [
        fixture.tenantA.owner.email,
        fixture.tenantA.staff.admin!.email,
        fixture.tenantA.staff.manager!.email,
        fixture.tenantA.staff.waiter!.email,
      ];

      // 1. Standard request
      const resStandard = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`);

      expect(resStandard.status).toBe(200);
      expect(resStandard.body.data.total).toBe(2);
      expect(resStandard.body.data.items).toHaveLength(2); // Owner B + Manager B

      // Assert every item in items belongs to B's known set
      for (const item of resStandard.body.data.items) {
        expect(knownBUserIds).toContain(item.id);
        expect(knownBEmails).toContain(item.email);
        expect(item.tenantId).toBe(fixture.tenantB.tenantId);
      }

      // Assert none of A's user IDs or emails appear anywhere in body
      const standardBodyStr = JSON.stringify(resStandard.body);
      expect(standardBodyStr).not.toContain(fixture.tenantA.tenantId);
      for (const aId of aUserIds) {
        expect(standardBodyStr).not.toContain(aId);
      }
      for (const aEmail of aEmails) {
        expect(standardBodyStr).not.toContain(aEmail);
      }

      // 2. Query param spoofing: ?tenantId=<tenantA>
      const resQuerySpoof = await request(app)
        .get(`/api/v1/users?tenantId=${fixture.tenantA.tenantId}`)
        .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`);

      expect(resQuerySpoof.status).toBe(200);
      expect(resQuerySpoof.body.data.total).toBe(2);
      expect(resQuerySpoof.body.data.items).toHaveLength(2);

      for (const item of resQuerySpoof.body.data.items) {
        expect(knownBUserIds).toContain(item.id);
        expect(knownBEmails).toContain(item.email);
        expect(item.tenantId).toBe(fixture.tenantB.tenantId);
      }

      const querySpoofBodyStr = JSON.stringify(resQuerySpoof.body);
      expect(querySpoofBodyStr).not.toContain(fixture.tenantA.tenantId);
      for (const aId of aUserIds) {
        expect(querySpoofBodyStr).not.toContain(aId);
      }
      for (const aEmail of aEmails) {
        expect(querySpoofBodyStr).not.toContain(aEmail);
      }

      // 3. Header spoofing: X-Tenant-Id: <tenantA>
      const resHeaderSpoof = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`)
        .set('X-Tenant-Id', fixture.tenantA.tenantId);

      expect(resHeaderSpoof.status).toBe(200);
      expect(resHeaderSpoof.body.data.total).toBe(2);
      expect(resHeaderSpoof.body.data.items).toHaveLength(2);

      for (const item of resHeaderSpoof.body.data.items) {
        expect(knownBUserIds).toContain(item.id);
        expect(knownBEmails).toContain(item.email);
        expect(item.tenantId).toBe(fixture.tenantB.tenantId);
      }

      const headerSpoofBodyStr = JSON.stringify(resHeaderSpoof.body);
      expect(headerSpoofBodyStr).not.toContain(fixture.tenantA.tenantId);
      for (const aId of aUserIds) {
        expect(headerSpoofBodyStr).not.toContain(aId);
      }
      for (const aEmail of aEmails) {
        expect(headerSpoofBodyStr).not.toContain(aEmail);
      }
    });
  });
});
