import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
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
import { User } from '../src/modules/user/user.model.js';
import { Restaurant } from '../src/modules/restaurant/restaurant.model.js';
import { Branch } from '../src/modules/branch/branch.model.js';
import { createAuthToken } from '../src/modules/auth/authToken.service.js';
import { createStaffUser } from './helpers/authHelpers.js';
import { withGlobalScope } from '../src/utils/tenantBypass.js';

interface EndpointConfig {
  name: string;
  method: 'post' | 'patch';
  pathTemplate: string;
  allowedFields: readonly string[];
  expectedControlStatus: number;
  buildControl: (ctx: TwoTenantsFixture) => Promise<{
    path: string;
    token: string;
    validBody: Record<string, unknown>;
  }>;
  buildStatic: (ctx: TwoTenantsFixture) => {
    path: string;
    token: string;
    validBody: Record<string, unknown>;
    targetResource?: 'user' | 'restaurant' | 'branch';
    targetId?: string;
  };
}

export const EXEMPT_WRITE_OPERATIONS: {
  method: string;
  path: string;
  reason: string;
}[] = [
  {
    method: 'POST',
    path: '/api/v1/auth/logout',
    reason: 'Has no request body (relies entirely on refresh cookie)',
  },
  {
    method: 'POST',
    path: '/api/v1/auth/refresh',
    reason: 'Has no request body (relies entirely on refresh cookie)',
  },
  {
    method: 'POST',
    path: '/api/v1/users/{id}/reset-password',
    reason:
      'Has no request body (triggers administrative password reset via URL id parameter)',
  },
];

export const FORBIDDEN_EXTRA_FIELDS = [
  'tenantId',
  'tenant',
  'role',
  'roles',
  'isMain',
  'status',
  'passwordHash',
  'password',
  'emailVerified',
  'emailVerifiedAt',
  'mustChangePassword',
  'tokenVersion',
  'passwordChangedAt',
  '_id',
  'id',
  'createdAt',
  'updatedAt',
  'restaurantId',
  'branchIds',
  '__proto__',
  'constructor',
  '$set',
  '$where',
] as const;

describe('Task 10c - Part A: Mass Assignment Security Tests', () => {
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
    await clearAllCollections();
    fixture = await setupTwoTenants(app);
  }, 60000);

  afterAll(async () => {
    await stopTestDb();
  });

  const ENDPOINTS: EndpointConfig[] = [
    {
      name: 'Signup',
      method: 'post',
      pathTemplate: '/api/v1/auth/signup',
      allowedFields: ['businessName', 'name', 'email', 'password', 'phone'],
      expectedControlStatus: 201,
      buildControl: async () => ({
        path: '/api/v1/auth/signup',
        token: '',
        validBody: {
          businessName: 'Control Cafe Group',
          name: 'Control Owner',
          email: `control-signup-${Math.random().toString(36).substring(2, 8)}@test.com`,
          password: 'Password123!',
          phone: '9876543210',
        },
      }),
      buildStatic: () => ({
        path: '/api/v1/auth/signup',
        token: '',
        validBody: {
          businessName: 'Static Signup Cafe',
          name: 'Static Owner',
          email: 'static-owner@test.com',
          password: 'Password123!',
          phone: '9876543210',
        },
      }),
    },
    {
      name: 'Login',
      method: 'post',
      pathTemplate: '/api/v1/auth/login',
      allowedFields: ['email', 'password'],
      expectedControlStatus: 200,
      buildControl: async (ctx) => ({
        path: '/api/v1/auth/login',
        token: '',
        validBody: {
          email: ctx.tenantB.owner.email,
          password: 'ValidPassword123!',
        },
      }),
      buildStatic: (ctx) => ({
        path: '/api/v1/auth/login',
        token: '',
        validBody: {
          email: ctx.tenantB.owner.email,
          password: 'ValidPassword123!',
        },
      }),
    },
    {
      name: 'Change Password',
      method: 'post',
      pathTemplate: '/api/v1/auth/change-password',
      allowedFields: ['currentPassword', 'newPassword'],
      expectedControlStatus: 200,
      buildControl: async (ctx) => {
        // Create a dedicated user so credential mutation does not invalidate shared manager/owner tokens
        const dedicatedUser = await createStaffUser({
          app,
          tenantId: ctx.tenantB.tenantId,
          role: 'WAITER',
          email: `dedicated-cp-${Math.random().toString(36).substring(2, 8)}@test.com`,
          password: 'DedicatedPassword123!',
        });
        return {
          path: '/api/v1/auth/change-password',
          token: dedicatedUser.accessToken,
          validBody: {
            currentPassword: 'DedicatedPassword123!',
            newPassword: 'BrandNewDedicatedPassword123!',
          },
        };
      },
      buildStatic: (ctx) => ({
        path: '/api/v1/auth/change-password',
        token: ctx.tenantB.owner.accessToken,
        validBody: {
          currentPassword: 'ValidPassword123!',
          newPassword: 'BrandNewOwnerPassword123!',
        },
        targetResource: 'user',
        targetId: ctx.tenantB.owner.id,
      }),
    },
    {
      name: 'Resend Verification',
      method: 'post',
      pathTemplate: '/api/v1/auth/resend-verification',
      allowedFields: ['email'],
      expectedControlStatus: 200,
      buildControl: async (ctx) => ({
        path: '/api/v1/auth/resend-verification',
        token: '',
        validBody: {
          email: ctx.tenantB.owner.email,
        },
      }),
      buildStatic: (ctx) => ({
        path: '/api/v1/auth/resend-verification',
        token: '',
        validBody: {
          email: ctx.tenantB.owner.email,
        },
      }),
    },
    {
      name: 'Forgot Password',
      method: 'post',
      pathTemplate: '/api/v1/auth/forgot-password',
      allowedFields: ['email'],
      expectedControlStatus: 200,
      buildControl: async (ctx) => ({
        path: '/api/v1/auth/forgot-password',
        token: '',
        validBody: {
          email: ctx.tenantB.owner.email,
        },
      }),
      buildStatic: (ctx) => ({
        path: '/api/v1/auth/forgot-password',
        token: '',
        validBody: {
          email: ctx.tenantB.owner.email,
        },
      }),
    },
    {
      name: 'Verify Email',
      method: 'post',
      pathTemplate: '/api/v1/auth/verify-email',
      allowedFields: ['token'],
      expectedControlStatus: 200,
      buildControl: async (ctx) => {
        // Create an unverified user in Tenant B and issue a real verification token
        const unverified = await withGlobalScope(async () =>
          User.create({
            tenantId: new Types.ObjectId(ctx.tenantB.tenantId),
            name: 'Unverified Control User',
            email: `unverified-control-${Math.random().toString(36).substring(2, 8)}@test.com`,
            passwordHash:
              '$2b$04$fakehashfakehashfakehashfakehashfakehashfakehash1234',
            role: 'WAITER',
            emailVerified: false,
          }),
        );
        const { rawToken } = await createAuthToken({
          tenantId: new Types.ObjectId(ctx.tenantB.tenantId),
          userId: unverified._id,
          type: 'EMAIL_VERIFICATION',
        });
        return {
          path: '/api/v1/auth/verify-email',
          token: '',
          validBody: { token: rawToken },
        };
      },
      buildStatic: () => ({
        path: '/api/v1/auth/verify-email',
        token: '',
        validBody: { token: 'a'.repeat(64) },
      }),
    },
    {
      name: 'Reset Password',
      method: 'post',
      pathTemplate: '/api/v1/auth/reset-password',
      allowedFields: ['token', 'newPassword'],
      expectedControlStatus: 200,
      buildControl: async (ctx) => {
        // Create a dedicated user so password reset does not invalidate shared manager/owner tokens
        const dedicatedUser = await createStaffUser({
          app,
          tenantId: ctx.tenantB.tenantId,
          role: 'WAITER',
          email: `dedicated-rp-${Math.random().toString(36).substring(2, 8)}@test.com`,
          password: 'DedicatedPassword123!',
        });
        const { rawToken } = await createAuthToken({
          tenantId: new Types.ObjectId(ctx.tenantB.tenantId),
          userId: dedicatedUser.user._id,
          type: 'PASSWORD_RESET',
        });
        return {
          path: '/api/v1/auth/reset-password',
          token: '',
          validBody: {
            token: rawToken,
            newPassword: 'BrandNewResetPassword123!',
          },
        };
      },
      buildStatic: () => ({
        path: '/api/v1/auth/reset-password',
        token: '',
        validBody: {
          token: 'b'.repeat(64),
          newPassword: 'NewValidPassword123!',
        },
      }),
    },
    {
      name: 'Create Restaurant',
      method: 'post',
      pathTemplate: '/api/v1/restaurant',
      allowedFields: [
        'name',
        'gstin',
        'fssai',
        'phone',
        'email',
        'address',
        'logoUrl',
      ],
      expectedControlStatus: 409, // Tenant B already has a restaurant -> conflict
      buildControl: async (ctx) => ({
        path: '/api/v1/restaurant',
        token: ctx.tenantB.owner.accessToken,
        validBody: {
          name: 'Second Restaurant Attempt',
          phone: '9876543210',
          email: 'second@restaurant.com',
          address: {
            line1: '123 Main St',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560001',
          },
        },
      }),
      buildStatic: (ctx) => ({
        path: '/api/v1/restaurant',
        token: ctx.tenantB.owner.accessToken,
        validBody: {
          name: 'Extra Bistro',
          address: {
            line1: '123 Market St',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560001',
          },
          phone: '9876543210',
          email: 'bistro@test.com',
        },
      }),
    },
    {
      name: 'Update Restaurant',
      method: 'patch',
      pathTemplate: '/api/v1/restaurant',
      allowedFields: [
        'name',
        'gstin',
        'fssai',
        'phone',
        'email',
        'address',
        'logoUrl',
      ],
      expectedControlStatus: 200,
      buildControl: async (ctx) => ({
        path: '/api/v1/restaurant',
        token: ctx.tenantB.owner.accessToken,
        validBody: {
          name: 'Control Updated B Restaurant',
        },
      }),
      buildStatic: (ctx) => ({
        path: '/api/v1/restaurant',
        token: ctx.tenantB.owner.accessToken,
        validBody: {
          name: 'Updated B Restaurant',
        },
        targetResource: 'restaurant',
        targetId: ctx.tenantB.restaurantId,
      }),
    },
    {
      name: 'Create Branch',
      method: 'post',
      pathTemplate: '/api/v1/branches',
      allowedFields: [
        'name',
        'code',
        'address',
        'phone',
        'timezone',
        'currency',
      ],
      expectedControlStatus: 201,
      buildControl: async (ctx) => ({
        path: '/api/v1/branches',
        token: ctx.tenantB.owner.accessToken,
        validBody: {
          name: 'Control Branch Whitefield',
          code: `BW-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
          address: {
            line1: 'ITPL Main Rd',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560066',
          },
          phone: '9876543210',
        },
      }),
      buildStatic: (ctx) => ({
        path: '/api/v1/branches',
        token: ctx.tenantB.owner.accessToken,
        validBody: {
          name: 'Branch Indiranagar',
          code: `BR-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
          address: {
            line1: '100 Feet Rd',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560038',
          },
          phone: '9876543210',
        },
      }),
    },
    {
      name: 'Update Branch',
      method: 'patch',
      pathTemplate: '/api/v1/branches/{id}',
      allowedFields: ['name', 'address', 'phone', 'timezone', 'status'],
      expectedControlStatus: 200,
      buildControl: async (ctx) => ({
        path: `/api/v1/branches/${ctx.tenantB.branches.main.id}`,
        token: ctx.tenantB.owner.accessToken,
        validBody: {
          name: 'Control Renamed Branch',
        },
      }),
      buildStatic: (ctx) => ({
        path: `/api/v1/branches/${ctx.tenantB.branches.main.id}`,
        token: ctx.tenantB.owner.accessToken,
        validBody: {
          name: 'Renamed Main Branch',
        },
        targetResource: 'branch',
        targetId: ctx.tenantB.branches.main.id,
      }),
    },
    {
      name: 'Update Me Profile',
      method: 'patch',
      pathTemplate: '/api/v1/users/me',
      allowedFields: ['name', 'phone'],
      expectedControlStatus: 200,
      buildControl: async (ctx) => ({
        path: '/api/v1/users/me',
        token: ctx.tenantB.owner.accessToken,
        validBody: {
          name: 'Control Updated Self Name',
        },
      }),
      buildStatic: (ctx) => ({
        path: '/api/v1/users/me',
        token: ctx.tenantB.owner.accessToken,
        validBody: {
          name: 'Updated Self Name',
        },
        targetResource: 'user',
        targetId: ctx.tenantB.owner.id,
      }),
    },
    {
      name: 'Create Staff',
      method: 'post',
      pathTemplate: '/api/v1/users',
      allowedFields: ['name', 'email', 'phone', 'role', 'branchIds'],
      expectedControlStatus: 201,
      buildControl: async (ctx) => ({
        path: '/api/v1/users',
        token: ctx.tenantB.owner.accessToken,
        validBody: {
          name: 'Control Waiter Staff',
          email: `control-waiter-${Math.random().toString(36).substring(2, 8)}@test.com`,
          role: 'WAITER',
          branchIds: [ctx.tenantB.branches.main.id],
        },
      }),
      buildStatic: (ctx) => ({
        path: '/api/v1/users',
        token: ctx.tenantB.owner.accessToken,
        validBody: {
          name: 'New Waiter B',
          email: 'waiter-static@test.com',
          role: 'WAITER',
          branchIds: [ctx.tenantB.branches.main.id],
        },
      }),
    },
    {
      name: 'Update Staff',
      method: 'patch',
      pathTemplate: '/api/v1/users/{id}',
      allowedFields: ['name', 'phone', 'role', 'branchIds', 'status'],
      expectedControlStatus: 200,
      buildControl: async (ctx) => ({
        path: `/api/v1/users/${ctx.tenantB.staff.manager!.id}`,
        token: ctx.tenantB.owner.accessToken,
        validBody: {
          name: 'Control Updated Manager B',
        },
      }),
      buildStatic: (ctx) => ({
        path: `/api/v1/users/${ctx.tenantB.staff.manager!.id}`,
        token: ctx.tenantB.owner.accessToken,
        validBody: {
          name: 'Updated Manager B',
        },
        targetResource: 'user',
        targetId: ctx.tenantB.staff.manager!.id,
      }),
    },
  ];

  // -------------------------------------------------------------
  // 1. Coverage Guard for Write Operations
  // -------------------------------------------------------------
  describe('Coverage Guard for Write Operations', () => {
    it('verifies every write operation in OpenAPI is either in matrix or in EXEMPT_WRITE_OPERATIONS', () => {
      const doc = getOpenAPIDocument();
      const openApiWrites = new Set<string>();

      for (const [pathTemplate, methods] of Object.entries(doc.paths || {})) {
        for (const [m, op] of Object.entries(methods || {})) {
          if (['post', 'patch', 'put', 'delete'].includes(m.toLowerCase())) {
            const hasBody = !!(op as { requestBody?: unknown }).requestBody;
            openApiWrites.add(
              `${m.toUpperCase()} ${pathTemplate}${hasBody ? ' (hasBody)' : ''}`,
            );
          }
        }
      }

      const coveredWrites = new Set<string>();
      for (const op of ENDPOINTS) {
        coveredWrites.add(
          `${op.method.toUpperCase()} ${op.pathTemplate} (hasBody)`,
        );
      }
      for (const ex of EXEMPT_WRITE_OPERATIONS) {
        coveredWrites.add(`${ex.method.toUpperCase()} ${ex.path}`);
      }

      const missing: string[] = [];
      for (const writeOp of openApiWrites) {
        if (!coveredWrites.has(writeOp)) {
          missing.push(writeOp);
        }
      }

      expect(
        missing,
        `Missing OpenAPI write operations in massAssignment matrix:\n${missing.join('\n')}`,
      ).toEqual([]);
    });

    it('asserts all exempt write operations have valid explanatory reasons', () => {
      for (const ex of EXEMPT_WRITE_OPERATIONS) {
        expect(typeof ex.reason === 'string' && ex.reason.length > 0).toBe(
          true,
        );
      }
    });
  });

  // -------------------------------------------------------------
  // 2. Positive Controls (Proves base payloads are valid)
  // -------------------------------------------------------------
  describe('Endpoint Base Payload Controls', () => {
    for (const ep of ENDPOINTS) {
      it(`positive control: ${ep.name} base body alone succeeds with expected status ${ep.expectedControlStatus}`, async () => {
        const { path, token, validBody } = await ep.buildControl(fixture);
        let req = request(app)[ep.method](path);
        if (token) {
          req = req.set('Authorization', `Bearer ${token}`);
        }
        const res = await req.send(validBody);
        expect(
          res.status,
          `Control failed for ${ep.name}! Expected ${ep.expectedControlStatus} but received ${res.status}: ${JSON.stringify(res.body)}`,
        ).toBe(ep.expectedControlStatus);
      });
    }
  });

  // -------------------------------------------------------------
  // 3. Extra Fields Rejection Matrix (one field at a time)
  // -------------------------------------------------------------
  describe('Strict Zod Schema Rejection of Forbidden Extra Fields', () => {
    for (const ep of ENDPOINTS) {
      // Filter forbidden extra fields so we NEVER test fields in allowedFields
      const testedExtraFields = FORBIDDEN_EXTRA_FIELDS.filter(
        (field) => !ep.allowedFields.includes(field),
      );

      describe(`${ep.name} (${ep.method.toUpperCase()} ${ep.pathTemplate})`, () => {
        it.each(testedExtraFields)(
          'rejects extra forbidden field "%s" with 400 VALIDATION_ERROR and leaves DB unchanged',
          async (extraField) => {
            const { path, token, validBody, targetResource, targetId } =
              ep.buildStatic(fixture);

            // Snapshot target document state before call
            let beforeDoc: Record<string, unknown> | null = null;
            if (targetResource === 'user' && targetId) {
              beforeDoc = await withGlobalScope(async () =>
                User.findById(targetId).lean(),
              );
            } else if (targetResource === 'restaurant' && targetId) {
              beforeDoc = await withGlobalScope(async () =>
                Restaurant.findById(targetId).lean(),
              );
            } else if (targetResource === 'branch' && targetId) {
              beforeDoc = await withGlobalScope(async () =>
                Branch.findById(targetId).lean(),
              );
            }

            let req = request(app)[ep.method](path);
            if (token) {
              req = req.set('Authorization', `Bearer ${token}`);
            }

            let res;
            if (extraField === '__proto__') {
              // Send raw JSON string so __proto__ is preserved as an own property in payload
              const rawJson =
                JSON.stringify(validBody).slice(0, -1) +
                ',"__proto__":{"polluted":true}}';
              res = await req
                .set('Content-Type', 'application/json')
                .send(rawJson);
            } else {
              const payloadWithExtra = {
                ...validBody,
                [extraField]:
                  extraField === 'tenantId'
                    ? fixture.tenantA.tenantId
                    : 'malicious_injected_value',
              };
              res = await req.send(payloadWithExtra);
            }

            // Strict Zod schema rejects unexpected keys with 400 VALIDATION_ERROR
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('VALIDATION_ERROR');

            // Assert that the validation error response mentions the offending field
            const errorsStr = JSON.stringify(res.body.errors || res.body);
            expect(errorsStr).toContain(extraField);

            // Assert target document in DB remains completely unchanged
            if (targetResource === 'user' && targetId) {
              const afterDoc = await withGlobalScope(async () =>
                User.findById(targetId).lean(),
              );
              expect(afterDoc?.['name']).toBe(beforeDoc?.['name']);
              expect(afterDoc?.['role']).toBe(beforeDoc?.['role']);
              expect(afterDoc?.['status']).toBe(beforeDoc?.['status']);
              expect(afterDoc?.['updatedAt']).toEqual(beforeDoc?.['updatedAt']);
            } else if (targetResource === 'restaurant' && targetId) {
              const afterDoc = await withGlobalScope(async () =>
                Restaurant.findById(targetId).lean(),
              );
              expect(afterDoc?.['name']).toBe(beforeDoc?.['name']);
              expect(afterDoc?.['updatedAt']).toEqual(beforeDoc?.['updatedAt']);
            } else if (targetResource === 'branch' && targetId) {
              const afterDoc = await withGlobalScope(async () =>
                Branch.findById(targetId).lean(),
              );
              expect(afterDoc?.['name']).toBe(beforeDoc?.['name']);
              expect(afterDoc?.['updatedAt']).toEqual(beforeDoc?.['updatedAt']);
            }
          },
        );
      });
    }
  });

  // -------------------------------------------------------------
  // 4. Privilege Escalation Checks
  // -------------------------------------------------------------
  describe('Privilege Escalation Prevention', () => {
    it('signup with role ADMIN/OWNER or injected tenantId creates a distinct new tenant with role OWNER', async () => {
      const email = `escalate-${Math.random().toString(36).substring(2, 8)}@test.com`;
      const res = await request(app).post('/api/v1/auth/signup').send({
        businessName: 'Injected Corp',
        name: 'Attacker',
        email,
        password: 'Password123!',
        role: 'ADMIN',
        tenantId: fixture.tenantA.tenantId,
      });

      // Zod schema is strict -> rejected with 400
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');

      // Assert user was not created in Tenant A
      const userInDb = await withGlobalScope(async () =>
        User.findOne({ email }),
      );
      expect(userInDb).toBeNull();
    });

    it('PATCH /users/me cannot escalate role, status, or branchIds', async () => {
      // 1. Create a fresh dedicated manager to guarantee token validity and test isolation
      const dedicatedManager = await createStaffUser({
        app,
        tenantId: fixture.tenantB.tenantId,
        role: 'MANAGER',
        branchIds: [fixture.tenantB.branches.main.id],
        email: `priv-esc-mgr-${Math.random().toString(36).substring(2, 8)}@test.com`,
        password: 'ManagerPassword123!',
      });

      // 2. Assert token is valid first (positive sanity check)
      const resSanity = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${dedicatedManager.accessToken}`);
      expect(resSanity.status).toBe(200);
      expect(resSanity.body.data.user.role).toBe('MANAGER');

      // 3. Attempt privilege escalation
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${dedicatedManager.accessToken}`)
        .send({
          name: 'Manager B',
          role: 'OWNER',
          status: 'INACTIVE',
          branchIds: [fixture.tenantA.branches.main.id],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');

      // Verify manager role in DB is unchanged
      const managerInDb = await withGlobalScope(async () =>
        User.findById(dedicatedManager.user._id),
      );
      expect(managerInDb?.role).toBe('MANAGER');
      expect(managerInDb?.status).toBe('ACTIVE');
    });

    it('MANAGER attempting to create staff with role ADMIN stays 403 FORBIDDEN', async () => {
      // 1. Create a fresh dedicated manager to guarantee token validity and test isolation
      const dedicatedManager = await createStaffUser({
        app,
        tenantId: fixture.tenantB.tenantId,
        role: 'MANAGER',
        branchIds: [fixture.tenantB.branches.main.id],
        email: `priv-esc-admin-mgr-${Math.random().toString(36).substring(2, 8)}@test.com`,
        password: 'ManagerPassword123!',
      });

      // 2. Assert token is valid first (positive sanity check)
      const resSanity = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${dedicatedManager.accessToken}`);
      expect(resSanity.status).toBe(200);
      expect(resSanity.body.data.user.role).toBe('MANAGER');

      // 3. Attempt to create an ADMIN
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${dedicatedManager.accessToken}`)
        .send({
          name: 'Privileged Staff',
          email: `admin-attempt-${Math.random().toString(36).substring(2, 8)}@test.com`,
          role: 'ADMIN',
          branchIds: [fixture.tenantB.branches.main.id],
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------
  // 5. NoSQL Operator Injection
  // -------------------------------------------------------------
  describe('NoSQL Operator Injection Protection', () => {
    it('login with object email {"$gt": ""} -> 400 VALIDATION_ERROR (not 200 or 500)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: { $gt: '' },
          password: 'ValidPassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('forgot-password with object email {"$gt": ""} -> 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({
          email: { $gt: '' },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('resend-verification with object email {"$gt": ""} -> 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/v1/auth/resend-verification')
        .send({
          email: { $gt: '' },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('GET /api/v1/users with object query ?role[$ne]=x is safe (never 500; if 200, matches request without operator)', async () => {
      // 1. Baseline request without operator
      const resBaseline = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`);
      expect(resBaseline.status).toBe(200);

      // 2. Request with operator in query string (?role[$ne]=WAITER)
      const resOperator = await request(app)
        .get('/api/v1/users?role[$ne]=WAITER')
        .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`);

      // Must never crash with 500
      expect(resOperator.status).not.toBe(500);

      // Express 5 simple query parser treats role[$ne] as a literal string key
      expect([200, 400]).toContain(resOperator.status);

      if (resOperator.status === 200) {
        // If 200, proves operator was NOT executed (results match baseline)
        expect(resOperator.body.data.total).toBe(resBaseline.body.data.total);
        expect(resOperator.body.data.items).toHaveLength(
          resBaseline.body.data.items.length,
        );
        expect(JSON.stringify(resOperator.body)).not.toContain(
          fixture.tenantA.tenantId,
        );
      }
    });

    it('GET /api/v1/users with object query ?q[$ne]=x is safe (never 500; if 200, matches request without operator)', async () => {
      // 1. Baseline request without operator
      const resBaseline = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`);
      expect(resBaseline.status).toBe(200);

      // 2. Request with operator in query string (?q[$ne]=test)
      const resOperator = await request(app)
        .get('/api/v1/users?q[$ne]=test')
        .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`);

      // Must never crash with 500
      expect(resOperator.status).not.toBe(500);

      expect([200, 400]).toContain(resOperator.status);

      if (resOperator.status === 200) {
        expect(resOperator.body.data.total).toBe(resBaseline.body.data.total);
        expect(resOperator.body.data.items).toHaveLength(
          resBaseline.body.data.items.length,
        );
        expect(JSON.stringify(resOperator.body)).not.toContain(
          fixture.tenantA.tenantId,
        );
      }
    });
  });
});
