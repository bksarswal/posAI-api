import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  startTestDb,
  clearAllCollections,
  stopTestDb,
} from './helpers/testDb.js';
import {
  createTenantAndOwner,
  createStaffUser,
} from './helpers/authHelpers.js';
import { getOpenAPIDocument } from '../src/config/openapi.js';

describe('Task 8: Onboarding APIs (GET /users/me, Restaurant & Branch APIs)', () => {
  const app = createApp({
    rateLimits: {
      global: { windowMs: 60000, max: 1000 },
      signupIp: { windowMs: 60000, max: 1000 },
      signupIpEmail: { windowMs: 60000, max: 1000 },
      loginIp: { windowMs: 60000, max: 1000 },
      loginIpEmail: { windowMs: 60000, max: 1000 },
      refreshIp: { windowMs: 60000, max: 1000 },
      changePassword: { windowMs: 60000, max: 1000 },
      verifyEmailIp: { windowMs: 60000, max: 1000 },
      resendVerificationIp: { windowMs: 60000, max: 1000 },
      resendVerificationIpEmail: { windowMs: 60000, max: 1000 },
      forgotPasswordIp: { windowMs: 60000, max: 1000 },
      forgotPasswordIpEmail: { windowMs: 60000, max: 1000 },
      resetPasswordIp: { windowMs: 60000, max: 1000 },
    },
  });

  const validRestaurantPayload = {
    name: 'Tandoori Tales',
    gstin: '29ABCDE1234F1Z5',
    fssai: '12345678901234',
    phone: '9876543210',
    email: 'contact@tandoori.com',
    address: {
      line1: '123 Food Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    },
    logoUrl: 'https://example.com/logo.png',
  };

  const validBranchPayload = {
    name: 'Indiranagar Flagship',
    code: 'INDIRA-01',
    address: {
      line1: '100 Feet Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560038',
    },
    phone: '9876543211',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  };

  beforeAll(async () => {
    await startTestDb();
  }, 60000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    await clearAllCollections();
  });

  it('1. /users/me: a new owner gets restaurant null and branches []; after creating the restaurant and a branch they appear; a user with mustChangePassword can still call it; a WAITER with empty branchIds gets branches []', async () => {
    const { owner, tenant, accessToken } = await createTenantAndOwner({ app });

    // Step A: New owner -> restaurant null, branches []
    const resInitial = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(resInitial.status).toBe(200);
    expect(resInitial.body.data.user).toMatchObject({
      id: owner._id.toString(),
      tenantId: tenant._id.toString(),
      email: owner.email,
      role: 'OWNER',
      branchIds: [],
      emailVerified: true,
      mustChangePassword: false,
    });
    expect(resInitial.body.data.tenant).toMatchObject({
      id: tenant._id.toString(),
      name: tenant.name,
      slug: tenant.slug,
      status: 'ACTIVE',
    });
    expect(resInitial.body.data.restaurant).toBeNull();
    expect(resInitial.body.data.branches).toEqual([]);

    // Step B: Create restaurant & branch -> they appear in /users/me
    const createRest = await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validRestaurantPayload);
    expect(createRest.status).toBe(201);

    const createBranch = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBranchPayload);
    expect(createBranch.status).toBe(201);

    const resUpdated = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(resUpdated.status).toBe(200);
    expect(resUpdated.body.data.restaurant).not.toBeNull();
    expect(resUpdated.body.data.restaurant.name).toBe('Tandoori Tales');
    expect(resUpdated.body.data.branches).toHaveLength(1);
    expect(resUpdated.body.data.branches[0].code).toBe('INDIRA-01');

    // Step C: A user with mustChangePassword = true can still call /users/me
    const { accessToken: pwdMustChangeToken } = await createTenantAndOwner({
      app,
      mustChangePassword: true,
    });
    const resExempt = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${pwdMustChangeToken}`);
    expect(resExempt.status).toBe(200);
    expect(resExempt.body.data.user.mustChangePassword).toBe(true);

    // Step D: A WAITER with empty branchIds gets branches []
    const { accessToken: waiterToken } = await createStaffUser({
      app,
      tenantId: tenant._id,
      role: 'WAITER',
      branchIds: [],
    });
    const resWaiter = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${waiterToken}`);
    expect(resWaiter.status).toBe(200);
    expect(resWaiter.body.data.branches).toEqual([]);
  });

  it('2. POST /restaurant: 201; a second one -> 409 RESTAURANT_ALREADY_EXISTS; two CONCURRENT creates -> one 201 and one 409; invalid GSTIN, FSSAI, phone, pincode -> 400; a lowercase GSTIN is stored uppercase; phone is stored as +91...; a body with tenantId or role -> 400; MANAGER, WAITER, CASHIER, CHEF and ADMIN -> 403; unauthenticated -> 401', async () => {
    const { tenant, accessToken: ownerToken } = await createTenantAndOwner({
      app,
    });

    // Case A: 201 Success
    const res1 = await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        ...validRestaurantPayload,
        gstin: '29abcde1234f1z5', // lowercase test
        phone: '9876543210', // unformatted phone test
      });
    expect(res1.status).toBe(201);
    expect(res1.body.data.restaurant.gstin).toBe('29ABCDE1234F1Z5');
    expect(res1.body.data.restaurant.phone).toBe('+919876543210');

    // Case B: A second one -> 409 RESTAURANT_ALREADY_EXISTS
    const resSecond = await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validRestaurantPayload);
    expect(resSecond.status).toBe(409);
    expect(resSecond.body.code).toBe('RESTAURANT_ALREADY_EXISTS');

    // Case C: Concurrent creates on a fresh tenant -> exactly one 201 and one 409
    const { accessToken: freshOwnerToken } = await createTenantAndOwner({
      app,
    });
    const [c1, c2] = await Promise.all([
      request(app)
        .post('/api/v1/restaurant')
        .set('Authorization', `Bearer ${freshOwnerToken}`)
        .send(validRestaurantPayload),
      request(app)
        .post('/api/v1/restaurant')
        .set('Authorization', `Bearer ${freshOwnerToken}`)
        .send(validRestaurantPayload),
    ]);
    const concurrentStatuses = [c1.status, c2.status].sort();
    expect(concurrentStatuses).toEqual([201, 409]);
    const errRes = c1.status === 409 ? c1 : c2;
    expect(errRes.body.code).toBe('RESTAURANT_ALREADY_EXISTS');

    // Case D: Validation failures (invalid GSTIN, FSSAI, phone, pincode, unknown keys)
    const { accessToken: valOwnerToken } = await createTenantAndOwner({ app });

    // Invalid GSTIN
    const resBadGstin = await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${valOwnerToken}`)
      .send({ ...validRestaurantPayload, gstin: 'BADGSTIN123' });
    expect(resBadGstin.status).toBe(400);

    // Invalid FSSAI
    const resBadFssai = await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${valOwnerToken}`)
      .send({ ...validRestaurantPayload, fssai: '123' });
    expect(resBadFssai.status).toBe(400);

    // Invalid phone
    const resBadPhone = await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${valOwnerToken}`)
      .send({ ...validRestaurantPayload, phone: '5999999999' });
    expect(resBadPhone.status).toBe(400);

    // Invalid pincode
    const resBadPin = await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${valOwnerToken}`)
      .send({
        ...validRestaurantPayload,
        address: { ...validRestaurantPayload.address, pincode: '012345' },
      });
    expect(resBadPin.status).toBe(400);

    // Body with tenantId or role -> 400
    const resUnknownKey = await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${valOwnerToken}`)
      .send({
        ...validRestaurantPayload,
        tenantId: tenant._id.toString(),
      });
    expect(resUnknownKey.status).toBe(400);

    const resUnknownRole = await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${valOwnerToken}`)
      .send({
        ...validRestaurantPayload,
        role: 'OWNER',
      });
    expect(resUnknownRole.status).toBe(400);

    // Case E: Role restrictions: MANAGER, WAITER, CASHIER, CHEF, ADMIN -> 403
    const roles = ['ADMIN', 'MANAGER', 'WAITER', 'CASHIER', 'CHEF'] as const;
    for (const role of roles) {
      const { accessToken: staffToken } = await createStaffUser({
        app,
        tenantId: tenant._id,
        role,
      });
      const resForbidden = await request(app)
        .post('/api/v1/restaurant')
        .set('Authorization', `Bearer ${staffToken}`)
        .send(validRestaurantPayload);
      expect(resForbidden.status).toBe(403);
    }

    // Case F: Unauthenticated -> 401
    const resUnauth = await request(app)
      .post('/api/v1/restaurant')
      .send(validRestaurantPayload);
    expect(resUnauth.status).toBe(401);
  });

  it('3. PATCH /restaurant: ADMIN can; MANAGER -> 403; an empty body -> 400', async () => {
    const { tenant, accessToken: ownerToken } = await createTenantAndOwner({
      app,
    });

    // Create restaurant
    await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validRestaurantPayload);

    // ADMIN can update
    const { accessToken: adminToken } = await createStaffUser({
      app,
      tenantId: tenant._id,
      role: 'ADMIN',
    });
    const resAdmin = await request(app)
      .patch('/api/v1/restaurant')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Tandoori Tales Updated' });
    expect(resAdmin.status).toBe(200);
    expect(resAdmin.body.data.restaurant.name).toBe('Tandoori Tales Updated');

    // MANAGER -> 403
    const { accessToken: managerToken } = await createStaffUser({
      app,
      tenantId: tenant._id,
      role: 'MANAGER',
    });
    const resManager = await request(app)
      .patch('/api/v1/restaurant')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Manager Attempt' });
    expect(resManager.status).toBe(403);

    // Empty body -> 400
    const resEmpty = await request(app)
      .patch('/api/v1/restaurant')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(resEmpty.status).toBe(400);
  });

  it('4. Branches create: before a restaurant exists -> 409 RESTAURANT_REQUIRED; the first branch is isMain true and the second is false; isMain in the body -> 400; duplicate code in a different case -> 409; the same code in another tenant works; invalid timezone or a currency other than INR -> 400; two CONCURRENT first-branch creates -> exactly one isMain=true branch and no 500', async () => {
    const { accessToken: ownerToken } = await createTenantAndOwner({
      app,
    });

    // 1. Before restaurant exists -> 409 RESTAURANT_REQUIRED
    const resNoRest = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validBranchPayload);
    expect(resNoRest.status).toBe(409);
    expect(resNoRest.body.code).toBe('RESTAURANT_REQUIRED');

    // Create restaurant
    await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validRestaurantPayload);

    // 2. First branch created -> isMain = true
    const b1 = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validBranchPayload);
    expect(b1.status).toBe(201);
    expect(b1.body.data.branch.isMain).toBe(true);
    expect(b1.body.data.branch.code).toBe('INDIRA-01');

    // 3. Second branch created -> isMain = false
    const b2 = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        ...validBranchPayload,
        name: 'Koramangala Branch',
        code: 'KORA-02',
      });
    expect(b2.status).toBe(201);
    expect(b2.body.data.branch.isMain).toBe(false);

    // 4. isMain in body -> 400
    const bIsMain = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validBranchPayload, code: 'TEST-03', isMain: true });
    expect(bIsMain.status).toBe(400);

    // 5. Duplicate code in different case -> 409 BRANCH_CODE_EXISTS
    const bDup = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validBranchPayload, code: 'indira-01' });
    expect(bDup.status).toBe(409);
    expect(bDup.body.code).toBe('BRANCH_CODE_EXISTS');

    // 6. Same code in another tenant works -> 201
    const { accessToken: ownerBToken } = await createTenantAndOwner({ app });
    await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send(validRestaurantPayload);

    const bTenantB = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ ...validBranchPayload, code: 'INDIRA-01' });
    expect(bTenantB.status).toBe(201);
    expect(bTenantB.body.data.branch.code).toBe('INDIRA-01');

    // 7. Invalid timezone -> 400
    const bBadTz = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validBranchPayload, code: 'TZ-01', timezone: 'Invalid/Zone' });
    expect(bBadTz.status).toBe(400);

    // 8. Currency other than INR -> 400
    const bBadCurr = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validBranchPayload, code: 'CURR-01', currency: 'USD' });
    expect(bBadCurr.status).toBe(400);

    // 9. Two CONCURRENT first-branch creates -> exactly one isMain=true and no 500
    const { accessToken: freshOwner } = await createTenantAndOwner({ app });
    await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${freshOwner}`)
      .send(validRestaurantPayload);

    const [cb1, cb2] = await Promise.all([
      request(app)
        .post('/api/v1/branches')
        .set('Authorization', `Bearer ${freshOwner}`)
        .send({ ...validBranchPayload, code: 'CONC-1' }),
      request(app)
        .post('/api/v1/branches')
        .set('Authorization', `Bearer ${freshOwner}`)
        .send({ ...validBranchPayload, code: 'CONC-2' }),
    ]);

    const concBranchStatuses = [cb1.status, cb2.status].sort();
    expect(concBranchStatuses).toEqual([201, 409]);
  });

  it('5. Branch reads: OWNER sees all; a MANAGER with branchIds [A] sees only A; a WAITER with empty branchIds sees none; GET :id of an inaccessible branch -> 404; of another tenant branch -> 404; invalid id -> 400', async () => {
    const { tenant, accessToken: ownerToken } = await createTenantAndOwner({
      app,
    });

    await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validRestaurantPayload);

    const bResA = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validBranchPayload, name: 'Branch A', code: 'BR-A' });
    const branchA = bResA.body.data.branch;

    const bResB = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validBranchPayload, name: 'Branch B', code: 'BR-B' });
    const branchB = bResB.body.data.branch;

    // OWNER sees all
    const ownerList = await request(app)
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ownerList.status).toBe(200);
    expect(ownerList.body.data.branches).toHaveLength(2);

    // MANAGER with branchIds [A] sees only A
    const { accessToken: managerToken } = await createStaffUser({
      app,
      tenantId: tenant._id,
      role: 'MANAGER',
      branchIds: [branchA.id],
    });
    const managerList = await request(app)
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(managerList.status).toBe(200);
    expect(managerList.body.data.branches).toHaveLength(1);
    expect(managerList.body.data.branches[0].id).toBe(branchA.id);

    // WAITER with empty branchIds sees none
    const { accessToken: waiterToken } = await createStaffUser({
      app,
      tenantId: tenant._id,
      role: 'WAITER',
      branchIds: [],
    });
    const waiterList = await request(app)
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${waiterToken}`);
    expect(waiterList.status).toBe(200);
    expect(waiterList.body.data.branches).toEqual([]);

    // GET :id of inaccessible branch (Branch B for Manager) -> 404 BRANCH_NOT_FOUND (never 403)
    const getInaccessible = await request(app)
      .get(`/api/v1/branches/${branchB.id}`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(getInaccessible.status).toBe(404);
    expect(getInaccessible.body.code).toBe('BRANCH_NOT_FOUND');

    // GET :id of another tenant's branch -> 404
    const { accessToken: otherTenantToken } = await createTenantAndOwner({
      app,
    });
    const getOtherTenant = await request(app)
      .get(`/api/v1/branches/${branchA.id}`)
      .set('Authorization', `Bearer ${otherTenantToken}`);
    expect(getOtherTenant.status).toBe(404);
    expect(getOtherTenant.body.code).toBe('BRANCH_NOT_FOUND');

    // Invalid id -> 400 INVALID_ID
    const getInvalidId = await request(app)
      .get('/api/v1/branches/not-a-valid-id')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(getInvalidId.status).toBe(400);
    expect(getInvalidId.body.code).toBe('INVALID_ID');
  });

  it('6. Branch update: fields update; code or isMain in the body -> 400; deactivating the main branch -> 409; MANAGER -> 403; another tenant branch -> 404', async () => {
    const { tenant, accessToken: ownerToken } = await createTenantAndOwner({
      app,
    });

    await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validRestaurantPayload);

    // First branch (main)
    const bMainRes = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validBranchPayload, code: 'MAIN-01' });
    const mainBranch = bMainRes.body.data.branch;

    // Second branch
    const bSecRes = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validBranchPayload, code: 'SEC-02' });
    const secBranch = bSecRes.body.data.branch;

    // Fields update
    const patchRes = await request(app)
      .patch(`/api/v1/branches/${secBranch.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Sec Branch Renamed' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.branch.name).toBe('Sec Branch Renamed');

    // code in body -> 400
    const patchCode = await request(app)
      .patch(`/api/v1/branches/${secBranch.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ code: 'NEW-CODE' });
    expect(patchCode.status).toBe(400);

    // isMain in body -> 400
    const patchIsMain = await request(app)
      .patch(`/api/v1/branches/${secBranch.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isMain: true });
    expect(patchIsMain.status).toBe(400);

    // Deactivating the main branch -> 409 CANNOT_DEACTIVATE_MAIN_BRANCH
    const patchDeactivateMain = await request(app)
      .patch(`/api/v1/branches/${mainBranch.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'INACTIVE' });
    expect(patchDeactivateMain.status).toBe(409);
    expect(patchDeactivateMain.body.code).toBe('CANNOT_DEACTIVATE_MAIN_BRANCH');

    // Deactivating a non-main branch succeeds -> 200
    const patchDeactivateSec = await request(app)
      .patch(`/api/v1/branches/${secBranch.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'INACTIVE' });
    expect(patchDeactivateSec.status).toBe(200);
    expect(patchDeactivateSec.body.data.branch.status).toBe('INACTIVE');

    // MANAGER -> 403
    const { accessToken: managerToken } = await createStaffUser({
      app,
      tenantId: tenant._id,
      role: 'MANAGER',
    });
    const patchManager = await request(app)
      .patch(`/api/v1/branches/${secBranch.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Manager Patch' });
    expect(patchManager.status).toBe(403);

    // Another tenant's branch -> 404
    const { accessToken: otherToken } = await createTenantAndOwner({ app });
    const patchOther = await request(app)
      .patch(`/api/v1/branches/${secBranch.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Cross Tenant Attempt' });
    expect(patchOther.status).toBe(404);
    expect(patchOther.body.code).toBe('BRANCH_NOT_FOUND');
  });

  it('7. Cross-tenant: tenant B can never read or modify tenant A restaurant or branches', async () => {
    // Tenant A with restaurant and branch
    const { accessToken: tokenA } = await createTenantAndOwner({ app });
    await request(app)
      .post('/api/v1/restaurant')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validRestaurantPayload);
    const bA = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validBranchPayload);

    // Tenant B
    const { accessToken: tokenB } = await createTenantAndOwner({ app });

    // Tenant B cannot read Tenant A's restaurant
    const getRestB = await request(app)
      .get('/api/v1/restaurant')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(getRestB.status).toBe(404);

    // Tenant B cannot modify Tenant A's restaurant
    const patchRestB = await request(app)
      .patch('/api/v1/restaurant')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Hacked Name' });
    expect(patchRestB.status).toBe(404);

    // Tenant B cannot read Tenant A's branches
    const getBranchesB = await request(app)
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(getBranchesB.status).toBe(200);
    expect(getBranchesB.body.data.branches).toEqual([]);

    const getBranchIdB = await request(app)
      .get(`/api/v1/branches/${bA.body.data.branch.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(getBranchIdB.status).toBe(404);

    // Tenant B cannot modify Tenant A's branch
    const patchBranchB = await request(app)
      .patch(`/api/v1/branches/${bA.body.data.branch.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Hacked Branch' });
    expect(patchBranchB.status).toBe(404);
  });

  it('8. openapi.json is up to date and contains the new paths. All existing tests pass.', async () => {
    const doc = getOpenAPIDocument();
    const paths = Object.keys(doc.paths || {});

    expect(paths).toContain('/api/v1/users/me');
    expect(paths).toContain('/api/v1/restaurant');
    expect(paths).toContain('/api/v1/branches');
    expect(paths).toContain('/api/v1/branches/{id}');
  });
});
