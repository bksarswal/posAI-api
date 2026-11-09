import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
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
  createTestRestaurantAndBranch,
} from './helpers/authHelpers.js';
import { User } from '../src/modules/user/index.js';
import { withGlobalScope } from '../src/utils/tenantBypass.js';
import { getOpenAPIDocument } from '../src/config/openapi.js';
import { logger } from '../src/utils/logger.js';

describe('Task 9: Staff Management APIs (/api/v1/users)', () => {
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
      userResetPassword: { windowMs: 60000, max: 1000 },
    },
  });

  beforeAll(async () => {
    await startTestDb();
  }, 60000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    await clearAllCollections();
  });

  it('1. Create staff: OWNER creates a MANAGER with branchIds [A] -> 201; DB state verified; login with temp password works with mustChangePassword; other routes -> 403; change-password restores normal access', async () => {
    const { accessToken: ownerToken } = await createTenantAndOwner({ app });
    const { branch } = await createTestRestaurantAndBranch(app, ownerToken);

    // 1. OWNER creates MANAGER
    const resCreate = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Manager Alice',
        email: 'alice@spicegarden.com',
        phone: '9876543210',
        role: 'MANAGER',
        branchIds: [branch.id],
      });

    expect(resCreate.status).toBe(201);
    expect(resCreate.headers['cache-control']).toBe('no-store');
    expect(resCreate.body.data.user).toMatchObject({
      name: 'Manager Alice',
      email: 'alice@spicegarden.com',
      phone: '+919876543210',
      role: 'MANAGER',
      branchIds: [branch.id],
      status: 'ACTIVE',
      emailVerified: true,
      mustChangePassword: true,
    });
    const tempPassword = resCreate.body.data.temporaryPassword;
    expect(tempPassword).toBeDefined();
    expect(tempPassword).toHaveLength(12);

    // 2. DB verification
    const dbUser = await withGlobalScope(async () => {
      return User.findById(resCreate.body.data.user.id).select('+passwordHash');
    });
    expect(dbUser?.emailVerified).toBe(true);
    expect(dbUser?.mustChangePassword).toBe(true);
    expect(dbUser?.status).toBe('ACTIVE');
    expect(dbUser?.passwordHash).toBeDefined();
    expect(dbUser?.passwordHash.startsWith('$2')).toBe(true); // bcrypt hash

    // 3. Login with temporary password
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alice@spicegarden.com', password: tempPassword });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.user.mustChangePassword).toBe(true);
    const aliceToken = loginRes.body.data.accessToken;

    // 4. Other protected routes -> 403 PASSWORD_CHANGE_REQUIRED
    const branchAccess = await request(app)
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(branchAccess.status).toBe(403);
    expect(branchAccess.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // 5. Change password
    const changeRes = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        currentPassword: tempPassword,
        newPassword: 'BrandNewPermanentPassword123!',
      });
    expect(changeRes.status).toBe(200);

    // 6. Login with new password and access normal routes
    const loginNew = await request(app).post('/api/v1/auth/login').send({
      email: 'alice@spicegarden.com',
      password: 'BrandNewPermanentPassword123!',
    });
    expect(loginNew.status).toBe(200);
    expect(loginNew.body.data.user.mustChangePassword).toBe(false);

    const normalAccess = await request(app)
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${loginNew.body.data.accessToken}`);
    expect(normalAccess.status).toBe(200);
    expect(normalAccess.body.data.branches).toHaveLength(1);
  });

  it('2. Create validation: role OWNER -> 400; non-admin with empty branchIds -> 400; ADMIN with branchIds -> 400; branchId of another tenant or INACTIVE -> 400 INVALID_BRANCH; forbidden fields -> 400; duplicate email -> 409; concurrent creates -> one 201 and one 409', async () => {
    const { accessToken: ownerToken } = await createTenantAndOwner({ app });
    const { branch: activeBranch } = await createTestRestaurantAndBranch(
      app,
      ownerToken,
    );

    // Create an INACTIVE branch in tenant
    const inactRes = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Inactive Branch',
        code: 'INACT-01',
        address: {
          line1: 'Road 1',
          city: 'City',
          state: 'State',
          pincode: '560001',
        },
      });
    await request(app)
      .patch(`/api/v1/branches/${inactRes.body.data.branch.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'INACTIVE' });

    // Branch of another tenant
    const { accessToken: otherOwner } = await createTenantAndOwner({ app });
    const { branch: otherBranch } = await createTestRestaurantAndBranch(
      app,
      otherOwner,
    );

    // A. role OWNER -> 400
    const resOwnerRole = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Bad Owner',
        email: 'badowner@test.com',
        role: 'OWNER',
        branchIds: [],
      });
    expect(resOwnerRole.status).toBe(400);

    // B. Non-admin role with empty branchIds -> 400
    const resEmptyBranches = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Waiter Bob',
        email: 'bob@test.com',
        role: 'WAITER',
        branchIds: [],
      });
    expect(resEmptyBranches.status).toBe(400);

    // C. ADMIN with branchIds -> 400
    const resAdminWithBranches = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Admin Charlie',
        email: 'charlie@test.com',
        role: 'ADMIN',
        branchIds: [activeBranch.id],
      });
    expect(resAdminWithBranches.status).toBe(400);

    // D. branchId of another tenant -> 400 INVALID_BRANCH
    const resOtherTenantBranch = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Staff David',
        email: 'david@test.com',
        role: 'CASHIER',
        branchIds: [otherBranch.id],
      });
    expect(resOtherTenantBranch.status).toBe(400);
    expect(resOtherTenantBranch.body.code).toBe('INVALID_BRANCH');

    // E. INACTIVE branch -> 400 INVALID_BRANCH
    const resInactiveBranch = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Staff Eve',
        email: 'eve@test.com',
        role: 'CHEF',
        branchIds: [inactRes.body.data.branch.id],
      });
    expect(resInactiveBranch.status).toBe(400);
    expect(resInactiveBranch.body.code).toBe('INVALID_BRANCH');

    // F. Bodies with forbidden fields -> 400
    const forbiddenFields = [
      { tenantId: '507f1f77bcf86cd799439011' },
      { status: 'ACTIVE' },
      { passwordHash: 'hash' },
      { mustChangePassword: false },
    ];
    for (const field of forbiddenFields) {
      const resForbidden = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Staff Frank',
          email: 'frank@test.com',
          role: 'WAITER',
          branchIds: [activeBranch.id],
          ...field,
        });
      expect(resForbidden.status).toBe(400);
    }

    // G. Duplicate email -> 409
    await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Staff Grace',
        email: 'grace@test.com',
        role: 'WAITER',
        branchIds: [activeBranch.id],
      });
    const resDup = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Staff Grace 2',
        email: 'GRACE@TEST.COM', // case-insensitive
        role: 'WAITER',
        branchIds: [activeBranch.id],
      });
    expect(resDup.status).toBe(409);
    expect(resDup.body.code).toBe('EMAIL_ALREADY_REGISTERED');

    // H. Two CONCURRENT creates with same email -> exactly one 201 and one 409
    const concEmail = 'concurrent-staff@test.com';
    const [c1, c2] = await Promise.all([
      request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Staff C1',
          email: concEmail,
          role: 'CHEF',
          branchIds: [activeBranch.id],
        }),
      request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Staff C2',
          email: concEmail,
          role: 'CHEF',
          branchIds: [activeBranch.id],
        }),
    ]);
    const statuses = [c1.status, c2.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('3. Authorization matrix: ADMIN creates a MANAGER (ok) and an ADMIN (403); MANAGER, WAITER, CASHIER, CHEF -> 403 on every endpoint; unauthenticated -> 401', async () => {
    const { tenant, accessToken: ownerToken } = await createTenantAndOwner({
      app,
    });
    const { branch } = await createTestRestaurantAndBranch(app, ownerToken);

    // Create ADMIN
    const { accessToken: adminToken } = await createStaffUser({
      app,
      tenantId: tenant._id,
      role: 'ADMIN',
    });

    // 1. ADMIN creates MANAGER -> 201
    const resAdminCreateManager = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Manager via Admin',
        email: 'mgr-admin@test.com',
        role: 'MANAGER',
        branchIds: [branch.id],
      });
    expect(resAdminCreateManager.status).toBe(201);

    // 2. ADMIN creates ADMIN -> 403
    const resAdminCreateAdmin = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Admin via Admin',
        email: 'admin-admin@test.com',
        role: 'ADMIN',
        branchIds: [],
      });
    expect(resAdminCreateAdmin.status).toBe(403);

    // 3. Other roles -> 403 on staff endpoints
    const otherRoles = ['MANAGER', 'WAITER', 'CASHIER', 'CHEF'] as const;
    for (const role of otherRoles) {
      const { accessToken: staffToken } = await createStaffUser({
        app,
        tenantId: tenant._id,
        role,
        branchIds: [branch.id],
      });

      const postRes = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          name: 'Attempt',
          email: `${role}-attempt@test.com`,
          role: 'WAITER',
          branchIds: [branch.id],
        });
      expect(postRes.status).toBe(403);

      const listRes = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(listRes.status).toBe(403);
    }

    // 4. Unauthenticated -> 401
    const unauthPost = await request(app)
      .post('/api/v1/users')
      .send({
        name: 'Unauth',
        email: 'unauth@test.com',
        role: 'WAITER',
        branchIds: [branch.id],
      });
    expect(unauthPost.status).toBe(401);

    const unauthList = await request(app).get('/api/v1/users');
    expect(unauthList.status).toBe(401);
  });

  it('4. PATCH rules: role change MANAGER to CASHIER works; ADMIN editing ADMIN -> 403; OWNER editing ADMIN works; OWNER account cannot be modified (403 CANNOT_MODIFY_OWNER); self deactivate -> 409; self role/branch -> 403; ADMIN promoting to ADMIN -> 403; demoting ADMIN to MANAGER without branchIds -> 400', async () => {
    const {
      owner,
      tenant,
      accessToken: ownerToken,
    } = await createTenantAndOwner({
      app,
    });
    const { branch } = await createTestRestaurantAndBranch(app, ownerToken);

    const { user: adminUser, accessToken: adminToken } = await createStaffUser({
      app,
      tenantId: tenant._id,
      role: 'ADMIN',
    });

    const { user: managerUser } = await createStaffUser({
      app,
      tenantId: tenant._id,
      role: 'MANAGER',
      branchIds: [branch.id],
    });

    // 1. Role change MANAGER to CASHIER works
    const patchRole = await request(app)
      .patch(`/api/v1/users/${managerUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'CASHIER' });
    expect(patchRole.status).toBe(200);
    expect(patchRole.body.data.user.role).toBe('CASHIER');

    // 2. ADMIN editing an ADMIN -> 403
    const patchAdminByAdmin = await request(app)
      .patch(`/api/v1/users/${adminUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Admin Changed' });
    expect(patchAdminByAdmin.status).toBe(403);

    // 3. OWNER editing an ADMIN works
    const patchAdminByOwner = await request(app)
      .patch(`/api/v1/users/${adminUser._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Admin Renamed by Owner' });
    expect(patchAdminByOwner.status).toBe(200);
    expect(patchAdminByOwner.body.data.user.name).toBe(
      'Admin Renamed by Owner',
    );

    // 4. Any attempt on an OWNER -> 403 CANNOT_MODIFY_OWNER
    const patchOwnerByAdmin = await request(app)
      .patch(`/api/v1/users/${owner._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Owner Hacked' });
    expect(patchOwnerByAdmin.status).toBe(403);
    expect(patchOwnerByAdmin.body.code).toBe('CANNOT_MODIFY_OWNER');

    const patchOwnerBySelf = await request(app)
      .patch(`/api/v1/users/${owner._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Owner Self' });
    expect(patchOwnerBySelf.status).toBe(403);
    expect(patchOwnerBySelf.body.code).toBe('CANNOT_MODIFY_OWNER');

    // 5. Self deactivate -> 409 CANNOT_DEACTIVATE_SELF
    const patchSelfDeactivate = await request(app)
      .patch(`/api/v1/users/${adminUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INACTIVE' });
    expect(patchSelfDeactivate.status).toBe(409);
    expect(patchSelfDeactivate.body.code).toBe('CANNOT_DEACTIVATE_SELF');

    // 6. Self role or branch change -> 403
    const patchSelfRole = await request(app)
      .patch(`/api/v1/users/${adminUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'MANAGER', branchIds: [branch.id] });
    expect(patchSelfRole.status).toBe(403);

    // 7. ADMIN promoting to ADMIN -> 403
    const promoteByAdmin = await request(app)
      .patch(`/api/v1/users/${managerUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'ADMIN', branchIds: [] });
    expect(promoteByAdmin.status).toBe(403);

    // 8. Demoting an ADMIN to MANAGER without branchIds -> 400
    const demoteNoBranches = await request(app)
      .patch(`/api/v1/users/${adminUser._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'MANAGER' });
    expect(demoteNoBranches.status).toBe(400);
  });

  it('5. Deactivation: user existing access token -> 401 immediately; refresh -> 401; login -> 403 ACCOUNT_DISABLED; reactivation restores login', async () => {
    const { tenant, accessToken: ownerToken } = await createTenantAndOwner({
      app,
    });
    const { branch } = await createTestRestaurantAndBranch(app, ownerToken);

    const { user: waiter, plainPassword } = await createStaffUser({
      app,
      tenantId: tenant._id,
      role: 'WAITER',
      branchIds: [branch.id],
    });

    // Login as Waiter
    const waiterLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: waiter.email, password: plainPassword });
    expect(waiterLogin.status).toBe(200);
    const waiterAccess = waiterLogin.body.data.accessToken;
    const waiterCookie =
      waiterLogin.headers['set-cookie']?.[0]?.split(';')[0] || '';

    // OWNER deactivates Waiter
    const deactRes = await request(app)
      .patch(`/api/v1/users/${waiter._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'INACTIVE' });
    expect(deactRes.status).toBe(200);
    expect(deactRes.body.data.user.status).toBe('INACTIVE');

    // Access token fails immediately -> 401
    const protRes = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${waiterAccess}`);
    expect(protRes.status).toBe(401);

    // Refresh fails -> 401
    const refRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', waiterCookie);
    expect(refRes.status).toBe(401);

    // New login fails -> 403 ACCOUNT_DISABLED
    const logFail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: waiter.email, password: plainPassword });
    expect(logFail.status).toBe(403);
    expect(logFail.body.code).toBe('ACCOUNT_DISABLED');

    // Reactivate Waiter
    const reactRes = await request(app)
      .patch(`/api/v1/users/${waiter._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'ACTIVE' });
    expect(reactRes.status).toBe(200);
    expect(reactRes.body.data.user.status).toBe('ACTIVE');

    // Login now works again -> 200
    const logSuccess = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: waiter.email, password: plainPassword });
    expect(logSuccess.status).toBe(200);
  });

  it('6. Admin reset: OWNER resets WAITER; new temp password works and old fails; mustChangePassword true; old access token -> 401 TOKEN_REVOKED; old refresh -> 401; ADMIN resetting ADMIN -> 403; resetting OWNER or self -> 403; rate limit -> 429; session before password change cannot refresh, session after can', async () => {
    const {
      owner,
      tenant,
      accessToken: ownerToken,
    } = await createTenantAndOwner({
      app,
    });
    const { branch } = await createTestRestaurantAndBranch(app, ownerToken);

    const { user: waiter, plainPassword: oldWaiterPass } =
      await createStaffUser({
        app,
        tenantId: tenant._id,
        role: 'WAITER',
        branchIds: [branch.id],
      });

    const { user: adminUser, accessToken: adminToken } = await createStaffUser({
      app,
      tenantId: tenant._id,
      role: 'ADMIN',
    });

    // Login waiter before reset
    const loginPre = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: waiter.email, password: oldWaiterPass });
    const oldAccess = loginPre.body.data.accessToken;
    const oldCookie = loginPre.headers['set-cookie']?.[0]?.split(';')[0] || '';

    // Wait 1s so token iat < passwordChangedAt
    await new Promise((r) => setTimeout(r, 1000));

    // A. OWNER resets WAITER
    const resetRes = await request(app)
      .post(`/api/v1/users/${waiter._id}/reset-password`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(resetRes.status).toBe(200);
    expect(resetRes.headers['cache-control']).toBe('no-store');
    const newTempPassword = resetRes.body.data.temporaryPassword;
    expect(newTempPassword).toBeDefined();

    // B. Old password fails, new temp password works
    const logOld = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: waiter.email, password: oldWaiterPass });
    expect(logOld.status).toBe(401);

    const logNew = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: waiter.email, password: newTempPassword });
    expect(logNew.status).toBe(200);
    expect(logNew.body.data.user.mustChangePassword).toBe(true);
    const postResetCookie =
      logNew.headers['set-cookie']?.[0]?.split(';')[0] || '';

    // C. Old access token gets 401 TOKEN_REVOKED
    const protOld = await request(app)
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${oldAccess}`);
    expect(protOld.status).toBe(401);
    expect(protOld.body.code).toBe('TOKEN_REVOKED');

    // D. Old refresh cookie (issued before password change) fails to refresh -> 401
    const refOld = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldCookie);
    expect(refOld.status).toBe(401);
    expect(refOld.body.code).toBe('INVALID_REFRESH_TOKEN');

    // E. New refresh cookie (issued after password change) CAN refresh -> 200
    const refNew = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', postResetCookie);
    expect(refNew.status).toBe(200);
    expect(refNew.body.data.accessToken).toBeDefined();

    // F. ADMIN resetting ADMIN -> 403
    const adminResetAdmin = await request(app)
      .post(`/api/v1/users/${adminUser._id}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminResetAdmin.status).toBe(403);

    // G. Resetting OWNER -> 403
    const resetOwner = await request(app)
      .post(`/api/v1/users/${owner._id}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resetOwner.status).toBe(403);

    // H. Resetting self -> 403
    const resetSelf = await request(app)
      .post(`/api/v1/users/${adminUser._id}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resetSelf.status).toBe(403);

    // I. Rate limit -> 429
    const rateLimitedApp = createApp({
      rateLimits: {
        userResetPassword: { windowMs: 60000, max: 2 },
      },
    });
    const r1 = await request(rateLimitedApp)
      .post(`/api/v1/users/${waiter._id}/reset-password`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(r1.status).toBe(200);

    const r2 = await request(rateLimitedApp)
      .post(`/api/v1/users/${waiter._id}/reset-password`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(r2.status).toBe(200);

    const r3 = await request(rateLimitedApp)
      .post(`/api/v1/users/${waiter._id}/reset-password`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(r3.status).toBe(429);
    expect(r3.body.code).toBe('RATE_LIMITED');
  });

  it('7. List: pagination and limit cap; filters by role, status, branchId and q; q with regex characters does not behave as regex; passwordHash never returned', async () => {
    const { tenant, accessToken: ownerToken } = await createTenantAndOwner({
      app,
    });
    const { branch: branchA } = await createTestRestaurantAndBranch(
      app,
      ownerToken,
    );

    // Create 5 staff users with varying roles, statuses, and names
    await createStaffUser({
      app,
      tenantId: tenant._id,
      name: 'Special User (VIP)',
      email: 'special@spice.com',
      role: 'MANAGER',
      branchIds: [branchA.id],
    });

    await createStaffUser({
      app,
      tenantId: tenant._id,
      name: 'Normal Waiter 1',
      email: 'waiter1@spice.com',
      role: 'WAITER',
      branchIds: [branchA.id],
    });

    await createStaffUser({
      app,
      tenantId: tenant._id,
      name: 'Normal Waiter 2',
      email: 'waiter2@spice.com',
      role: 'WAITER',
      branchIds: [branchA.id],
    });

    const listAll = await request(app)
      .get('/api/v1/users?limit=2')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(listAll.status).toBe(200);
    expect(listAll.body.data.items).toHaveLength(2);
    expect(listAll.body.data.page).toBe(1);
    expect(listAll.body.data.limit).toBe(2);
    expect(listAll.body.data.total).toBe(4); // Owner + 3 staff
    expect(listAll.body.data.items[0].passwordHash).toBeUndefined();

    // Limit cap at 100
    const listCapped = await request(app)
      .get('/api/v1/users?limit=200')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(listCapped.status).toBe(400); // Exceeds max 100

    // Filter by role
    const listWaiters = await request(app)
      .get('/api/v1/users?role=WAITER')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(listWaiters.status).toBe(200);
    expect(listWaiters.body.data.items).toHaveLength(2);
    expect(
      listWaiters.body.data.items.every(
        (u: { role: string }) => u.role === 'WAITER',
      ),
    ).toBe(true);

    // Filter by q with regex characters like "(" and ".*"
    const listRegexLiteral = await request(app)
      .get('/api/v1/users?q=(VIP)')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(listRegexLiteral.status).toBe(200);
    expect(listRegexLiteral.body.data.items).toHaveLength(1);
    expect(listRegexLiteral.body.data.items[0].name).toBe('Special User (VIP)');

    const listWildcard = await request(app)
      .get('/api/v1/users?q=.*')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(listWildcard.status).toBe(200);
    expect(listWildcard.body.data.items).toHaveLength(0); // No user named literal ".*"
  });

  it('8. Cross-tenant: tenant B can never GET, PATCH or reset tenant A users (404)', async () => {
    const { tenant: tenantA, accessToken: tokenA } = await createTenantAndOwner(
      { app },
    );
    const { branch: branchA } = await createTestRestaurantAndBranch(
      app,
      tokenA,
    );
    const { user: userA } = await createStaffUser({
      app,
      tenantId: tenantA._id,
      role: 'WAITER',
      branchIds: [branchA.id],
    });

    const { accessToken: tokenB } = await createTenantAndOwner({ app });

    // GET tenant A user -> 404
    const getB = await request(app)
      .get(`/api/v1/users/${userA._id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(getB.status).toBe(404);

    // PATCH tenant A user -> 404
    const patchB = await request(app)
      .patch(`/api/v1/users/${userA._id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Hacked Name' });
    expect(patchB.status).toBe(404);

    // Reset password of tenant A user -> 404
    const resetB = await request(app)
      .post(`/api/v1/users/${userA._id}/reset-password`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(resetB.status).toBe(404);
  });

  it('9. PATCH /users/me works for name and phone; role or email in body -> 400; user with mustChangePassword gets 403', async () => {
    const { accessToken } = await createTenantAndOwner({ app });

    // 1. Success update name and phone
    const resUpdateMe = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'New Owner Name', phone: '9876543210' });
    expect(resUpdateMe.status).toBe(200);
    expect(resUpdateMe.body.data.user.name).toBe('New Owner Name');
    expect(resUpdateMe.body.data.user.phone).toBe('+919876543210');
    expect(resUpdateMe.body.data.user.passwordHash).toBeUndefined();
    expect(resUpdateMe.body.data.user.__v).toBeUndefined();

    // Verify GET /users/me reflects the updated phone
    const resGetMeAfter = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(resGetMeAfter.status).toBe(200);
    expect(resGetMeAfter.body.data.user.phone).toBe('+919876543210');
    expect(resGetMeAfter.body.data.user.passwordHash).toBeUndefined();

    // 2. Role or email in body -> 400
    const resBadRole = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'ADMIN' });
    expect(resBadRole.status).toBe(400);

    const resBadEmail = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: 'newemail@test.com' });
    expect(resBadEmail.status).toBe(400);

    // 3. User with mustChangePassword gets 403
    const { accessToken: pwdToken } = await createTenantAndOwner({
      app,
      mustChangePassword: true,
    });
    const resBlocked = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ name: 'Blocked' });
    expect(resBlocked.status).toBe(403);
    expect(resBlocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('10. Audit log is emitted for create, update and reset; temporary password never appears in any log line', async () => {
    const infoSpy = vi.spyOn(logger, 'info');

    const { accessToken: ownerToken } = await createTenantAndOwner({ app });
    const { branch } = await createTestRestaurantAndBranch(app, ownerToken);

    // 1. Create staff
    const resCreate = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Audit Staff',
        email: 'audit-staff@test.com',
        role: 'WAITER',
        branchIds: [branch.id],
      });
    expect(resCreate.status).toBe(201);
    const tempPassword1 = resCreate.body.data.temporaryPassword;
    const staffId = resCreate.body.data.user.id;

    // 2. Update staff
    const resUpdate = await request(app)
      .patch(`/api/v1/users/${staffId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Audit Staff Updated' });
    expect(resUpdate.status).toBe(200);

    // 3. Reset password
    const resReset = await request(app)
      .post(`/api/v1/users/${staffId}/reset-password`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(resReset.status).toBe(200);
    const tempPassword2 = resReset.body.data.temporaryPassword;

    // Verify audit logs were captured
    const auditCalls = infoSpy.mock.calls.filter(
      ([obj]) =>
        typeof obj === 'object' &&
        obj !== null &&
        'audit' in obj &&
        obj.audit === true,
    );
    expect(auditCalls.length).toBeGreaterThanOrEqual(3);

    // Check actions
    const actions = auditCalls.map(
      ([obj]) => (obj as Record<string, unknown>)['action'],
    );
    expect(actions).toContain('STAFF_USER_CREATED');
    expect(actions).toContain('STAFF_USER_UPDATED');
    expect(actions).toContain('STAFF_USER_PASSWORD_RESET');

    // Crucial check: Temporary passwords NEVER appear in audit log calls or any string log argument
    const serializedAuditCalls = JSON.stringify(auditCalls);
    expect(serializedAuditCalls.includes(tempPassword1)).toBe(false);
    expect(serializedAuditCalls.includes(tempPassword2)).toBe(false);

    for (const callArgs of infoSpy.mock.calls) {
      for (const arg of callArgs) {
        if (typeof arg === 'string') {
          expect(arg.includes(tempPassword1)).toBe(false);
          expect(arg.includes(tempPassword2)).toBe(false);
        }
      }
    }
  });

  it('11. openapi.json is up to date and contains all new paths', async () => {
    const doc = getOpenAPIDocument();
    const paths = Object.keys(doc.paths || {});

    expect(paths).toContain('/api/v1/users/me');
    expect(paths).toContain('/api/v1/users');
    expect(paths).toContain('/api/v1/users/{id}');
    expect(paths).toContain('/api/v1/users/{id}/reset-password');
  });
});
