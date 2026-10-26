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
import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import pino from 'pino';
import { createApp } from '../src/app.js';
import {
  startTestDb,
  clearAllCollections,
  stopTestDb,
} from './helpers/testDb.js';
import { Tenant } from '../src/modules/tenant/index.js';
import { User, UserService } from '../src/modules/user/index.js';
import { RefreshToken } from '../src/modules/auth/index.js';
import { Restaurant } from '../src/modules/restaurant/restaurant.model.js';
import { withGlobalScope } from '../src/utils/tenantBypass.js';
import { runWithTenant, getTenantId } from '../src/utils/tenantContext.js';
import * as passwordModule from '../src/utils/password.js';
import {
  setEnvForTesting,
  resetEnvForTesting,
  env,
} from '../src/config/env.js';
import { authenticate } from '../src/middleware/authenticate.js';
import { authorize } from '../src/middleware/authorize.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { getRefreshTokenCookieOptions } from '../src/modules/auth/index.js';

describe('Task 5: Auth Module (Login, Logout, Authenticate, Authorize)', () => {
  // Relax rate limits for non-rate-limit tests
  const testApp = createApp({
    rateLimits: {
      global: { windowMs: 60000, max: 1000 },
      loginIp: { windowMs: 60000, max: 1000 },
      loginIpEmail: { windowMs: 60000, max: 1000 },
      refreshIp: { windowMs: 60000, max: 1000 },
      changePassword: { windowMs: 60000, max: 1000 },
    },
  });

  beforeAll(async () => {
    await startTestDb();
  }, 60000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearAllCollections();
  });

  async function createTestTenantAndUser(
    options: {
      email?: string;
      password?: string;
      emailVerified?: boolean;
      status?: 'ACTIVE' | 'INACTIVE';
      tenantStatus?: 'ACTIVE' | 'SUSPENDED';
      role?: 'OWNER' | 'ADMIN' | 'MANAGER' | 'WAITER' | 'CASHIER' | 'CHEF';
      mustChangePassword?: boolean;
      passwordChangedAt?: Date;
    } = {},
  ) {
    const tenant = await Tenant.create({
      name: 'Spice Garden',
      slug: `spice-${Math.random().toString(36).substring(2, 8)}`,
      status: options.tenantStatus ?? 'ACTIVE',
    });

    const password = options.password ?? 'ValidPassword123!';
    const passwordHash = await passwordModule.hashPassword(password);

    const user = await runWithTenant(tenant._id, async () => {
      return UserService.createUser({
        name: 'Test Owner',
        email: (options.email ?? 'owner@spice.com').toLowerCase().trim(),
        passwordHash,
        role: options.role ?? 'OWNER',
        emailVerified: options.emailVerified ?? true,
      });
    });

    if (
      options.status === 'INACTIVE' ||
      options.mustChangePassword ||
      options.passwordChangedAt
    ) {
      await withGlobalScope(async () => {
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              ...(options.status && { status: options.status }),
              ...(options.mustChangePassword !== undefined && {
                mustChangePassword: options.mustChangePassword,
              }),
              ...(options.passwordChangedAt && {
                passwordChangedAt: options.passwordChangedAt,
              }),
            },
          },
        );
      });
    }

    return { tenant, user, plainPassword: password };
  }

  it('1. Login success: sets HttpOnly cookie, returns accessToken without passwordHash, stores token hash in DB', async () => {
    const { user, plainPassword } = await createTestTenantAndUser();

    const res = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: plainPassword });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.email).toBe(user.email);
    expect(res.body.data.user.role).toBe('OWNER');
    expect(res.body.data.user.passwordHash).toBeUndefined();

    // Verify Set-Cookie header
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    expect(cookies).toBeDefined();
    const cookieHeader = cookies?.join(';') || '';
    expect(cookieHeader).toContain('refreshToken=');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('Path=/api/v1/auth');
    expect(cookieHeader).toContain('SameSite=Lax');

    // Verify RefreshToken in DB stores only the hash, not the raw token
    const rawRefreshToken = cookieHeader.match(/refreshToken=([^;]+)/)?.[1];
    expect(rawRefreshToken).toBeDefined();

    const tokenInDb = await withGlobalScope(async () => {
      return RefreshToken.findOne({ userId: user._id });
    });

    expect(tokenInDb).not.toBeNull();
    expect(tokenInDb?.tokenHash).toBeDefined();
    expect(tokenInDb?.tokenHash).not.toBe(rawRefreshToken);
    expect(tokenInDb?.tokenHash).toHaveLength(64);

    // Verify Access JWT claims
    const decoded = jwt.verify(
      res.body.data.accessToken,
      env.JWT_ACCESS_SECRET,
    ) as jwt.JwtPayload;

    expect(decoded.sub).toBe(user._id.toString());
    expect(decoded['tid']).toBe(user.tenantId.toString());
    expect(decoded['role']).toBe('OWNER');
    expect(decoded.iss).toBe('posai-api');
    expect(decoded.exp).toBeDefined();
  });

  it('2. Wrong password and unknown email return identical 401 bodies and invoke verifyPassword exactly once', async () => {
    const { user } = await createTestTenantAndUser({
      email: 'known@spice.com',
    });
    const spy = vi.spyOn(passwordModule, 'verifyPassword');

    // Case A: Known user, wrong password
    const resWrongPass = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'WrongPassword999!' });

    expect(resWrongPass.status).toBe(401);
    expect(resWrongPass.body).toEqual({
      success: false,
      message: 'Invalid email or password',
      code: 'INVALID_CREDENTIALS',
    });
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockClear();

    // Case B: Unknown user
    const resUnknown = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@nowhere.com', password: 'AnyPassword123!' });

    expect(resUnknown.status).toBe(401);
    expect(resUnknown.body).toEqual({
      success: false,
      message: 'Invalid email or password',
      code: 'INVALID_CREDENTIALS',
    });
    // Dummy hash comparison executed for uniform timing defense
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('3. Unverified email: 403 EMAIL_NOT_VERIFIED with correct password; 401 with wrong password', async () => {
    const { user, plainPassword } = await createTestTenantAndUser({
      email: 'unverified@spice.com',
      emailVerified: false,
    });

    // Wrong password -> 401 (checked before email status)
    const resWrong = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'WrongPassword!' });
    expect(resWrong.status).toBe(401);
    expect(resWrong.body.code).toBe('INVALID_CREDENTIALS');

    // Correct password -> 403 EMAIL_NOT_VERIFIED
    const resCorrect = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: plainPassword });
    expect(resCorrect.status).toBe(403);
    expect(resCorrect.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('4. INACTIVE user -> 403 ACCOUNT_DISABLED; SUSPENDED tenant -> 403 TENANT_SUSPENDED', async () => {
    // Inactive user
    const { user: inactiveUser, plainPassword: pass1 } =
      await createTestTenantAndUser({
        email: 'inactive@spice.com',
        status: 'INACTIVE',
      });

    const resInactive = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: inactiveUser.email, password: pass1 });
    expect(resInactive.status).toBe(403);
    expect(resInactive.body.code).toBe('ACCOUNT_DISABLED');

    // Suspended tenant
    const { user: suspendedUser, plainPassword: pass2 } =
      await createTestTenantAndUser({
        email: 'suspended@spice.com',
        tenantStatus: 'SUSPENDED',
      });

    const resSuspended = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: suspendedUser.email, password: pass2 });
    expect(resSuspended.status).toBe(403);
    expect(resSuspended.body.code).toBe('TENANT_SUSPENDED');
  });

  it('5. Login rate limit: returns 429 RATE_LIMITED when threshold exceeded', async () => {
    const rateLimitedApp = createApp({
      rateLimits: {
        loginIp: { windowMs: 60000, max: 2 },
        loginIpEmail: { windowMs: 60000, max: 2 },
      },
    });

    const { user, plainPassword } = await createTestTenantAndUser({
      email: 'ratelimit@test.com',
    });

    const payload = { email: user.email, password: plainPassword };

    // Request 1 & 2 succeed
    const res1 = await request(rateLimitedApp)
      .post('/api/v1/auth/login')
      .send(payload);
    expect(res1.status).toBe(200);

    const res2 = await request(rateLimitedApp)
      .post('/api/v1/auth/login')
      .send(payload);
    expect(res2.status).toBe(200);

    // Request 3 is blocked
    const res3 = await request(rateLimitedApp)
      .post('/api/v1/auth/login')
      .send(payload);
    expect(res3.status).toBe(429);
    expect(res3.body.code).toBe('RATE_LIMITED');
  });

  it('6. Logout revokes the whole family, clears cookie, and succeeds idempotently without cookie', async () => {
    const { user, plainPassword } = await createTestTenantAndUser();

    // Login to obtain cookie
    const loginRes = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: plainPassword });

    const cookies = loginRes.headers['set-cookie'] as string[];
    expect(cookies).toBeDefined();
    const cookieVal = cookies[0]?.split(';')[0];

    // Logout with cookie
    const logoutRes = await request(testApp)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookieVal || '');

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    // Check cookie clear header
    const clearCookieHeader = logoutRes.headers['set-cookie']?.join(';') || '';
    expect(clearCookieHeader).toMatch(/refreshToken=;.*(Expires|Max-Age=0)/i);

    // Verify token family in DB was marked revoked
    const tokenInDb = await withGlobalScope(async () => {
      return RefreshToken.findOne({ userId: user._id });
    });
    expect(tokenInDb?.revokedAt).toBeDefined();

    // Logout with no cookie -> 200
    const logoutNoCookie = await request(testApp).post('/api/v1/auth/logout');
    expect(logoutNoCookie.status).toBe(200);
  });

  it('logout with an unknown cookie -> 200', async () => {
    const res = await request(testApp)
      .post('/api/v1/auth/logout')
      .set('Cookie', 'refreshToken=unknown_dummy_token_123');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const clearCookieHeader = res.headers['set-cookie']?.join(';') || '';
    expect(clearCookieHeader).toMatch(/refreshToken=;.*(Expires|Max-Age=0)/i);
  });

  it('refresh cookie has Secure only in production config (test the cookie option builder)', () => {
    // Current test environment (NODE_ENV=test)
    const testOptions = getRefreshTokenCookieOptions();
    expect(testOptions.secure).toBe(false);
    expect(testOptions.httpOnly).toBe(true);
    expect(testOptions.sameSite).toBe('lax');
    expect(testOptions.path).toBe('/api/v1/auth');

    // Simulate production environment
    setEnvForTesting({
      NODE_ENV: 'production' as 'production' | 'test' | 'development',
    });
    try {
      const prodOptions = getRefreshTokenCookieOptions();
      expect(prodOptions.secure).toBe(true);
      expect(prodOptions.httpOnly).toBe(true);
    } finally {
      resetEnvForTesting();
    }
  });

  describe('Part C: authenticate and authorize middleware', () => {
    function buildProtectedApp() {
      const app = express();
      app.use(cookieParser());
      app.use(express.json());

      // Test route protected by authenticate
      app.get(
        '/test-protected',
        authenticate,
        (req: Request, res: Response) => {
          return res.json({
            auth: req.auth,
            currentTenant: getTenantId()?.toString(),
          });
        },
      );

      // Exempt route for mustChangePassword test
      app.get(
        '/api/v1/users/me',
        authenticate,
        (_req: Request, res: Response) => {
          return res.json({ success: true, message: 'exempt route reached' });
        },
      );

      // Role authorization test route
      app.get(
        '/test-admin-only',
        authenticate,
        authorize('OWNER', 'ADMIN'),
        (_req: Request, res: Response) => {
          return res.json({ success: true, message: 'admin access granted' });
        },
      );

      // Model query test route to verify tenant isolation
      app.get(
        '/test-query-restaurants',
        authenticate,
        async (_req: Request, res: Response) => {
          const restaurants = await Restaurant.find();
          return res.json({
            count: restaurants.length,
            names: restaurants.map((r) => r.name),
          });
        },
      );

      // Downstream async handler that throws
      app.get('/test-async-throw', authenticate, async () => {
        throw new Error('Downstream async failure');
      });

      // Central error handler
      app.use(errorHandler);

      return app;
    }

    it('authenticate: missing header -> 401 UNAUTHORIZED', async () => {
      const protectedApp = buildProtectedApp();
      const res = await request(protectedApp).get('/test-protected');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('authenticate: garbage token -> 401 UNAUTHORIZED', async () => {
      const protectedApp = buildProtectedApp();
      const res = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', 'Bearer invalid.garbage.token');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('authenticate: token signed with another secret -> 401 UNAUTHORIZED', async () => {
      const protectedApp = buildProtectedApp();
      const { tenant, user } = await createTestTenantAndUser();
      const wrongSecretToken = jwt.sign(
        { sub: user._id.toString(), tid: tenant._id.toString(), role: 'OWNER' },
        'wrong_secret_key_at_least_32_chars_long_123',
        { algorithm: 'HS256', issuer: 'posai-api' },
      );
      const res = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${wrongSecretToken}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('authenticate: an alg "none" token -> 401 UNAUTHORIZED', async () => {
      const protectedApp = buildProtectedApp();
      const { tenant, user } = await createTestTenantAndUser();
      const algNoneToken = jwt.sign(
        { sub: user._id.toString(), tid: tenant._id.toString(), role: 'OWNER' },
        '',
        { algorithm: 'none' as unknown as 'HS256' },
      );
      const res = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${algNoneToken}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('authenticate: an expired token -> 401 TOKEN_EXPIRED', async () => {
      const protectedApp = buildProtectedApp();
      const { tenant, user } = await createTestTenantAndUser();
      const expiredToken = jwt.sign(
        { sub: user._id.toString(), tid: tenant._id.toString(), role: 'OWNER' },
        env.JWT_ACCESS_SECRET,
        { algorithm: 'HS256', issuer: 'posai-api', expiresIn: '-1s' },
      );
      const res = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${expiredToken}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_EXPIRED');
    });

    it('authenticate: a user deactivated after the token was issued -> 401 UNAUTHORIZED', async () => {
      const protectedApp = buildProtectedApp();
      const { user, plainPassword } = await createTestTenantAndUser();

      const loginRes = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });
      const validToken = loginRes.body.data.accessToken as string;

      // Deactivate user in DB
      await withGlobalScope(async () => {
        await User.updateOne(
          { _id: user._id },
          { $set: { status: 'INACTIVE' } },
        );
      });

      const res = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${validToken}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('authenticate: role changed in the DB after issue -> the DB role wins', async () => {
      const protectedApp = buildProtectedApp();
      const { user, plainPassword } = await createTestTenantAndUser();

      const loginRes = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });
      const validToken = loginRes.body.data.accessToken as string;

      // Update role to MANAGER in DB
      await withGlobalScope(async () => {
        await User.updateOne({ _id: user._id }, { $set: { role: 'MANAGER' } });
      });

      const res = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${validToken}`);
      expect(res.status).toBe(200);
      expect(res.body.auth.role).toBe('MANAGER');
    });

    it('authenticate: tid of another tenant with a valid sub -> 401 UNAUTHORIZED', async () => {
      const protectedApp = buildProtectedApp();
      const { user } = await createTestTenantAndUser();

      const otherTenant = await Tenant.create({
        name: 'Other Tenant',
        slug: 'other-tenant-slug-999',
      });

      const spoofedTenantToken = jwt.sign(
        {
          sub: user._id.toString(),
          tid: otherTenant._id.toString(),
          role: 'OWNER',
        },
        env.JWT_ACCESS_SECRET,
        { algorithm: 'HS256', issuer: 'posai-api' },
      );

      const res = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${spoofedTenantToken}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('authenticate: token issued right after password change (same second) is not rejected', async () => {
      const protectedApp = buildProtectedApp();
      const { tenant, user } = await createTestTenantAndUser();

      const now = new Date();
      await withGlobalScope(async () => {
        await User.updateOne(
          { _id: user._id },
          { $set: { passwordChangedAt: now } },
        );
      });

      // Token issued in the exact same second: Math.floor(now/1000) === iat
      const token = jwt.sign(
        {
          sub: user._id.toString(),
          tid: tenant._id.toString(),
          role: 'OWNER',
          iat: Math.floor(now.getTime() / 1000),
        },
        env.JWT_ACCESS_SECRET,
        { algorithm: 'HS256', issuer: 'posai-api', expiresIn: '15m' },
      );

      const res = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.auth.userId).toBe(user._id.toString());
    });

    it('authenticate: token issued before password change is rejected -> 401 TOKEN_REVOKED', async () => {
      const protectedApp = buildProtectedApp();
      const { user, plainPassword } = await createTestTenantAndUser();

      const loginRes = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });
      const validToken = loginRes.body.data.accessToken as string;

      // Set passwordChangedAt to future second
      await withGlobalScope(async () => {
        await User.updateOne(
          { _id: user._id },
          { $set: { passwordChangedAt: new Date(Date.now() + 10000) } },
        );
      });

      const res = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${validToken}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_REVOKED');
    });

    it('authenticate: mustChangePassword blocks non-exempt routes (403 PASSWORD_CHANGE_REQUIRED) but allows exempt routes', async () => {
      const protectedApp = buildProtectedApp();
      const { user: userMustChange, plainPassword } =
        await createTestTenantAndUser({
          email: 'mustchange@spice.com',
          mustChangePassword: true,
        });

      const loginMustChange = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: userMustChange.email, password: plainPassword });
      const mustChangeToken = loginMustChange.body.data.accessToken as string;

      // Access non-exempt route -> 403
      const resBlocked = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${mustChangeToken}`);
      expect(resBlocked.status).toBe(403);
      expect(resBlocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

      // Access exempt route -> 200
      const resExempt = await request(protectedApp)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${mustChangeToken}`);
      expect(resExempt.status).toBe(200);
    });

    it('authenticate: a downstream async handler that throws still reaches errorHandler (JSON 500, no hang, no unhandled rejection), proving runWithTenant wrapper is safe', async () => {
      const protectedApp = buildProtectedApp();
      const { user, plainPassword } = await createTestTenantAndUser();

      const loginRes = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });
      const token = loginRes.body.data.accessToken as string;

      const res = await request(protectedApp)
        .get('/test-async-throw')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('8. authorize allows and denies correctly based on roles', async () => {
      const protectedApp = buildProtectedApp();

      // Create OWNER user
      const { plainPassword: pOwner, user: ownerUser } =
        await createTestTenantAndUser({
          role: 'OWNER',
          email: 'owner_auth@test.com',
        });
      const loginOwner = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: ownerUser.email, password: pOwner });
      const ownerToken = loginOwner.body.data.accessToken as string;

      // Create WAITER user
      const { plainPassword: pWaiter, user: waiterUser } =
        await createTestTenantAndUser({
          role: 'WAITER',
          email: 'waiter_auth@test.com',
        });
      const loginWaiter = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: waiterUser.email, password: pWaiter });
      const waiterToken = loginWaiter.body.data.accessToken as string;

      // OWNER accesses /test-admin-only -> 200
      const resOwner = await request(protectedApp)
        .get('/test-admin-only')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(resOwner.status).toBe(200);

      // WAITER accesses /test-admin-only -> 403 FORBIDDEN
      const resWaiter = await request(protectedApp)
        .get('/test-admin-only')
        .set('Authorization', `Bearer ${waiterToken}`);
      expect(resWaiter.status).toBe(403);
      expect(resWaiter.body.code).toBe('FORBIDDEN');
    });

    it('9. Cross-tenant isolation: a user from tenant A querying a scoped model inside a protected route never sees tenant B data', async () => {
      const protectedApp = buildProtectedApp();

      // Tenant A
      const {
        tenant: tenantA,
        user: userA,
        plainPassword: pA,
      } = await createTestTenantAndUser({ email: 'ownerA@isolated.com' });
      await runWithTenant(tenantA._id, async () => {
        await Restaurant.create({
          name: 'Restaurant Alpha',
          phone: '+919876543210',
          email: 'alpha@rest.com',
          address: {
            line1: 'Alpha St',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560001',
          },
        });
      });

      // Tenant B
      const { tenant: tenantB } = await createTestTenantAndUser({
        email: 'ownerB@isolated.com',
      });
      await runWithTenant(tenantB._id, async () => {
        await Restaurant.create({
          name: 'Restaurant Beta Secret',
          phone: '+919876543211',
          email: 'beta@rest.com',
          address: {
            line1: 'Beta St',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400001',
          },
        });
      });

      // Login as user A
      const loginA = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: userA.email, password: pA });
      const tokenA = loginA.body.data.accessToken as string;

      // Query restaurants through protected route
      const resA = await request(protectedApp)
        .get('/test-query-restaurants')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(resA.status).toBe(200);
      expect(resA.body.count).toBe(1);
      expect(resA.body.names).toEqual(['Restaurant Alpha']);
      expect(resA.body.names).not.toContain('Restaurant Beta Secret');
    });

    it('10. Request logging: wrong password login does not put password in log output', async () => {
      let logOutput = '';
      const captureStream = {
        write: (chunk: string) => {
          logOutput += chunk;
          return true;
        },
      };

      const testLogger = pino({ level: 'info' }, captureStream);
      const appWithLogging = createApp({
        customLogger: testLogger,
        rateLimits: {
          loginIp: { max: 1000 },
          loginIpEmail: { max: 1000 },
        },
      });

      const { user } = await createTestTenantAndUser({
        email: 'logtest@spice.com',
      });

      await request(appWithLogging)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'SuperSecretLeakedPassword999!' });

      expect(logOutput).not.toContain('SuperSecretLeakedPassword999!');
    });
  });

  describe('Part B & C: Refresh Token Rotation and Change Password', () => {
    it('Refresh 1. Happy path: login then refresh -> 200; new accessToken and different cookie value; old row rotatedAt; new row same familyId; only hashes stored', async () => {
      const { user, plainPassword } = await createTestTenantAndUser();
      const loginRes = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });

      const loginCookieHeader = loginRes.headers['set-cookie'] as string[];
      const loginCookie = loginCookieHeader[0]?.split(';')[0];
      const rawLoginToken = loginCookie?.match(/refreshToken=([^;]+)/)?.[1];
      expect(rawLoginToken).toBeDefined();

      // Delay at least 1s so JWT iat increments and access token is fresh
      await new Promise((r) => setTimeout(r, 1000));

      // Call /refresh
      const refreshRes = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', loginCookie || '');

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.success).toBe(true);
      expect(refreshRes.body.data.accessToken).toBeDefined();
      expect(refreshRes.body.data.accessToken).not.toBe(
        loginRes.body.data.accessToken,
      );

      const refreshCookieHeader = refreshRes.headers['set-cookie'] as string[];
      const refreshCookie = refreshCookieHeader[0]?.split(';')[0];
      const rawRefreshToken = refreshCookie?.match(/refreshToken=([^;]+)/)?.[1];
      expect(rawRefreshToken).toBeDefined();
      expect(rawRefreshToken).not.toBe(rawLoginToken);

      // Check DB rows
      const allTokens = await withGlobalScope(async () => {
        return RefreshToken.find({ userId: user._id }).sort({ createdAt: 1 });
      });

      expect(allTokens).toHaveLength(2);
      const [oldToken, newToken] = allTokens;
      expect(oldToken.rotatedAt).toBeDefined();
      expect(newToken.rotatedAt).toBeUndefined();
      expect(oldToken.familyId).toBe(newToken.familyId);
      // Verify only hashes stored
      expect(oldToken.tokenHash).not.toBe(rawLoginToken);
      expect(newToken.tokenHash).not.toBe(rawRefreshToken);
      expect(oldToken.tokenHash).toHaveLength(64);
      expect(newToken.tokenHash).toHaveLength(64);
    });

    it('Refresh 2. No cookie, unknown token, and expired row -> 401 and cookie cleared', async () => {
      // Case A: No cookie
      const resNoCookie = await request(testApp).post('/api/v1/auth/refresh');
      expect(resNoCookie.status).toBe(401);
      expect(resNoCookie.body.code).toBe('INVALID_REFRESH_TOKEN');
      expect(resNoCookie.headers['set-cookie']?.join(';')).toMatch(
        /refreshToken=;.*(Expires|Max-Age=0)/i,
      );

      // Case B: Unknown token
      const resUnknown = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', 'refreshToken=completely_unknown_token_hash_abc123');
      expect(resUnknown.status).toBe(401);
      expect(resUnknown.body.code).toBe('INVALID_REFRESH_TOKEN');
      expect(resUnknown.headers['set-cookie']?.join(';')).toMatch(
        /refreshToken=;.*(Expires|Max-Age=0)/i,
      );

      // Case C: Expired row
      const { user, plainPassword } = await createTestTenantAndUser();
      const loginRes = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });
      const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';

      // Set expiresAt to the past
      await withGlobalScope(async () => {
        await RefreshToken.updateOne(
          { userId: user._id },
          { $set: { expiresAt: new Date(Date.now() - 60000) } },
        );
      });

      const resExpired = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie);
      expect(resExpired.status).toBe(401);
      expect(resExpired.body.code).toBe('INVALID_REFRESH_TOKEN');
      expect(resExpired.headers['set-cookie']?.join(';')).toMatch(
        /refreshToken=;.*(Expires|Max-Age=0)/i,
      );
    });

    it('Refresh 3. Two CONCURRENT refreshes with the same cookie: exactly one 200 and one 401 REFRESH_TOKEN_ROTATED; family not revoked; new token works; ROTATED does not clear cookie; family has 2 token rows', async () => {
      const { user, plainPassword } = await createTestTenantAndUser();
      const loginRes = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });
      const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';

      // Fire two concurrent refresh requests
      const [res1, res2] = await Promise.all([
        request(testApp).post('/api/v1/auth/refresh').set('Cookie', cookie),
        request(testApp).post('/api/v1/auth/refresh').set('Cookie', cookie),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 401]);

      const successRes = res1.status === 200 ? res1 : res2;
      const rotatedRes = res1.status === 401 ? res1 : res2;

      expect(rotatedRes.body.code).toBe('REFRESH_TOKEN_ROTATED');
      // ROTATED response must NOT clear the cookie
      const rotatedClearCookie = rotatedRes.headers['set-cookie'];
      expect(rotatedClearCookie).toBeUndefined();

      // Family is not revoked, exactly 2 rows
      const allTokens = await withGlobalScope(async () => {
        return RefreshToken.find({ userId: user._id });
      });
      expect(allTokens).toHaveLength(2);
      expect(allTokens.every((t) => !t.revokedAt)).toBe(true);

      // The new token issued in successRes works
      const newCookie =
        successRes.headers['set-cookie']?.[0]?.split(';')[0] || '';
      const secondRefresh = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', newCookie);
      expect(secondRefresh.status).toBe(200);
    });

    it('Refresh 4. Sequential replay within 10s -> 401 REFRESH_TOKEN_ROTATED with family intact', async () => {
      const { user, plainPassword } = await createTestTenantAndUser();
      const loginRes = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });
      const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';

      // First refresh -> 200
      const firstRefresh = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie);
      expect(firstRefresh.status).toBe(200);

      // Sequential replay with old cookie immediately (<10s)
      const replayRes = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie);
      expect(replayRes.status).toBe(401);
      expect(replayRes.body.code).toBe('REFRESH_TOKEN_ROTATED');
      expect(replayRes.headers['set-cookie']).toBeUndefined();

      // Family remains intact
      const tokens = await withGlobalScope(async () => {
        return RefreshToken.find({ userId: user._id });
      });
      expect(tokens.every((t) => !t.revokedAt)).toBe(true);
    });

    it('Refresh 5. Replay after grace window (rotatedAt 11s ago) -> 401 REFRESH_TOKEN_REUSED; ALL tokens revoked including newest; cookie cleared', async () => {
      const { user, plainPassword } = await createTestTenantAndUser();
      const loginRes = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });
      const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';

      // Rotate first to create new token
      const firstRefresh = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie);
      expect(firstRefresh.status).toBe(200);
      const newestCookie =
        firstRefresh.headers['set-cookie']?.[0]?.split(';')[0] || '';

      // Set the first token's rotatedAt to 11 seconds ago
      await withGlobalScope(async () => {
        await RefreshToken.updateOne(
          { rotatedAt: { $ne: null } },
          { $set: { rotatedAt: new Date(Date.now() - 11000) } },
        );
      });

      // Replay the old token
      const reusedRes = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie);
      expect(reusedRes.status).toBe(401);
      expect(reusedRes.body.code).toBe('REFRESH_TOKEN_REUSED');
      expect(reusedRes.headers['set-cookie']?.join(';')).toMatch(
        /refreshToken=;.*(Expires|Max-Age=0)/i,
      );

      // ALL tokens of family are revoked
      const tokens = await withGlobalScope(async () => {
        return RefreshToken.find({ userId: user._id });
      });
      expect(
        tokens.every((t) => t.revokedAt !== null && t.revokedAt !== undefined),
      ).toBe(true);

      // The newest token now also fails
      const newestRefresh = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', newestCookie);
      expect(newestRefresh.status).toBe(401);
      expect(newestRefresh.body.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('Refresh 6. After logout -> 401. User deactivated, tenant suspended, or email unverified -> 401 and family revoked', async () => {
      // Case A: After logout
      const { user: userA, plainPassword: pA } = await createTestTenantAndUser({
        email: 'logout_ref@spice.com',
      });
      const loginA = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: userA.email, password: pA });
      const cookieA = loginA.headers['set-cookie']?.[0]?.split(';')[0] || '';
      await request(testApp).post('/api/v1/auth/logout').set('Cookie', cookieA);

      const resAfterLogout = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieA);
      expect(resAfterLogout.status).toBe(401);
      expect(resAfterLogout.body.code).toBe('INVALID_REFRESH_TOKEN');

      // Case B: User deactivated after login
      const { user: userB, plainPassword: pB } = await createTestTenantAndUser({
        email: 'deactivated_ref@spice.com',
      });
      const loginB = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: userB.email, password: pB });
      const cookieB = loginB.headers['set-cookie']?.[0]?.split(';')[0] || '';

      await withGlobalScope(async () => {
        await User.updateOne(
          { _id: userB._id },
          { $set: { status: 'INACTIVE' } },
        );
      });

      const resDeactivated = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieB);
      expect(resDeactivated.status).toBe(401);
      expect(resDeactivated.body.code).toBe('INVALID_REFRESH_TOKEN');

      // Verify family was revoked
      const tokensB = await withGlobalScope(async () => {
        return RefreshToken.find({ userId: userB._id });
      });
      expect(tokensB.every((t) => t.revokedAt)).toBe(true);

      // Case C: Tenant suspended after login
      const {
        tenant: tenantC,
        user: userC,
        plainPassword: pC,
      } = await createTestTenantAndUser({ email: 'suspended_ref@spice.com' });
      const loginC = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: userC.email, password: pC });
      const cookieC = loginC.headers['set-cookie']?.[0]?.split(';')[0] || '';

      await withGlobalScope(async () => {
        await Tenant.updateOne(
          { _id: tenantC._id },
          { $set: { status: 'SUSPENDED' } },
        );
      });

      const resSuspended = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieC);
      expect(resSuspended.status).toBe(401);
      expect(resSuspended.body.code).toBe('INVALID_REFRESH_TOKEN');

      // Case D: Email unverified after login
      const { user: userD, plainPassword: pD } = await createTestTenantAndUser({
        email: 'unverified_ref@spice.com',
      });
      const loginD = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: userD.email, password: pD });
      const cookieD = loginD.headers['set-cookie']?.[0]?.split(';')[0] || '';

      await withGlobalScope(async () => {
        await User.updateOne(
          { _id: userD._id },
          { $set: { emailVerified: false } },
        );
      });

      const resUnverified = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieD);
      expect(resUnverified.status).toBe(401);
      expect(resUnverified.body.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('Refresh 7. A role changed in the DB shows up in the new access token. Rate limit -> 429', async () => {
      const { user, plainPassword } = await createTestTenantAndUser();
      const loginRes = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });
      const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';

      // Change user role in DB to ADMIN
      await withGlobalScope(async () => {
        await User.updateOne({ _id: user._id }, { $set: { role: 'ADMIN' } });
      });

      const refreshRes = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie);
      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.data.user.role).toBe('ADMIN');

      const decoded = jwt.verify(
        refreshRes.body.data.accessToken,
        env.JWT_ACCESS_SECRET,
      ) as jwt.JwtPayload;
      expect(decoded['role']).toBe('ADMIN');

      // Rate limiting test
      const rateLimitedApp = createApp({
        rateLimits: {
          refreshIp: { windowMs: 60000, max: 2 },
        },
      });

      const nextCookie =
        refreshRes.headers['set-cookie']?.[0]?.split(';')[0] || '';
      const r1 = await request(rateLimitedApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', nextCookie);
      expect(r1.status).toBe(200);

      const r1Cookie = r1.headers['set-cookie']?.[0]?.split(';')[0] || '';
      const r2 = await request(rateLimitedApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', r1Cookie);
      expect(r2.status).toBe(200);

      // 3rd request blocked
      const r3 = await request(rateLimitedApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', 'any');
      expect(r3.status).toBe(429);
      expect(r3.body.code).toBe('RATE_LIMITED');
    });

    it('Change-password 8. Success: new password works IMMEDIATELY (same second), old password fails; mustChangePassword false; passwordChangedAt set; two logins revoked; old access token -> 401 TOKEN_REVOKED; cookie cleared', async () => {
      const { user, plainPassword } = await createTestTenantAndUser({
        mustChangePassword: true,
      });

      // Device 1 login
      const loginDev1 = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });
      const tokenDev1 = loginDev1.body.data.accessToken as string;
      const cookieDev1 =
        loginDev1.headers['set-cookie']?.[0]?.split(';')[0] || '';

      // Device 2 login
      const loginDev2 = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });
      const tokenDev2 = loginDev2.body.data.accessToken as string;
      const cookieDev2 =
        loginDev2.headers['set-cookie']?.[0]?.split(';')[0] || '';

      const newPassword = 'NewSecretPassword123!';

      // Ensure at least 1s passes after login so pre-change token iat < passwordChangedAt second
      await new Promise((r) => setTimeout(r, 1000));

      // Call /change-password using Device 1's token
      const changeRes = await request(testApp)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${tokenDev1}`)
        .set('Cookie', cookieDev1)
        .send({
          currentPassword: plainPassword,
          newPassword,
        });

      expect(changeRes.status).toBe(200);
      expect(changeRes.body.message).toBe(
        'Password changed. Please log in again.',
      );
      expect(changeRes.headers['set-cookie']?.join(';')).toMatch(
        /refreshToken=;.*(Expires|Max-Age=0)/i,
      );

      // New password works for login IMMEDIATELY
      const newLogin = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: newPassword });
      expect(newLogin.status).toBe(200);
      expect(newLogin.body.data.accessToken).toBeDefined();

      // Old password fails
      const oldLogin = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });
      expect(oldLogin.status).toBe(401);

      // In DB: mustChangePassword is false, passwordChangedAt is set
      const dbUser = await withGlobalScope(async () => {
        return User.findById(user._id);
      });
      expect(dbUser?.mustChangePassword).toBe(false);
      expect(dbUser?.passwordChangedAt).toBeDefined();

      // Both device refresh cookies are revoked
      const refreshDev1 = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieDev1);
      expect(refreshDev1.status).toBe(401);
      const refreshDev2 = await request(testApp)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieDev2);
      expect(refreshDev2.status).toBe(401);

      // Old access tokens from both devices return 401 TOKEN_REVOKED
      const protDev1 = await request(testApp)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${tokenDev1}`)
        .send({
          currentPassword: newPassword,
          newPassword: 'AnotherPassword123!',
        });
      expect(protDev1.status).toBe(401);
      expect(protDev1.body.code).toBe('TOKEN_REVOKED');

      const protDev2 = await request(testApp)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${tokenDev2}`)
        .send({
          currentPassword: newPassword,
          newPassword: 'AnotherPassword123!',
        });
      expect(protDev2.status).toBe(401);
      expect(protDev2.body.code).toBe('TOKEN_REVOKED');
    });

    it('Change-password 9. Wrong current password -> 400 INVALID_CURRENT_PASSWORD. New equals current -> 400. New >72 bytes or <8 -> 400. Unauthenticated -> 401. Rate limit -> 429', async () => {
      const { user, plainPassword } = await createTestTenantAndUser();
      const loginRes = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });
      const token = loginRes.body.data.accessToken as string;

      // Unauthenticated -> 401
      const resUnauth = await request(testApp)
        .post('/api/v1/auth/change-password')
        .send({
          currentPassword: plainPassword,
          newPassword: 'BrandNewPassword123!',
        });
      expect(resUnauth.status).toBe(401);

      // Wrong current password -> 400 INVALID_CURRENT_PASSWORD
      const resWrongCur = await request(testApp)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'WrongPassword999!',
          newPassword: 'BrandNewPassword123!',
        });
      expect(resWrongCur.status).toBe(400);
      expect(resWrongCur.body.code).toBe('INVALID_CURRENT_PASSWORD');

      // New equals current -> 400
      const resEqual = await request(testApp)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: plainPassword, newPassword: plainPassword });
      expect(resEqual.status).toBe(400);
      expect(resEqual.body.code).toBe('VALIDATION_ERROR');

      // New password shorter than 8 chars -> 400
      const resShort = await request(testApp)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: plainPassword, newPassword: '123' });
      expect(resShort.status).toBe(400);
      expect(resShort.body.code).toBe('VALIDATION_ERROR');

      // New password > 72 bytes -> 400
      const longPass = 'a'.repeat(73);
      const resLong = await request(testApp)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: plainPassword, newPassword: longPass });
      expect(resLong.status).toBe(400);
      expect(resLong.body.code).toBe('VALIDATION_ERROR');

      // Rate limit -> 429
      const rateLimitedApp = createApp({
        rateLimits: {
          changePassword: { windowMs: 60000, max: 2 },
        },
      });

      const r1 = await request(rateLimitedApp)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'wrong',
          newPassword: 'ValidNewPassword123!',
        });
      expect(r1.status).toBe(400);

      const r2 = await request(rateLimitedApp)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'wrong',
          newPassword: 'ValidNewPassword123!',
        });
      expect(r2.status).toBe(400);

      const r3 = await request(rateLimitedApp)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'wrong',
          newPassword: 'ValidNewPassword123!',
        });
      expect(r3.status).toBe(429);
      expect(r3.body.code).toBe('RATE_LIMITED');
    });

    it('Change-password 10. A user with mustChangePassword = true can call change-password (exempt) but gets 403 PASSWORD_CHANGE_REQUIRED on another protected route', async () => {
      const { user, plainPassword } = await createTestTenantAndUser({
        mustChangePassword: true,
      });

      const loginRes = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });
      const token = loginRes.body.data.accessToken as string;

      // Access exempt change-password route -> succeeds
      const changeRes = await request(testApp)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: plainPassword,
          newPassword: 'BrandNewSecurePassword123!',
        });
      expect(changeRes.status).toBe(200);

      // A user who has NOT changed password yet gets 403 on operational routes
      const { user: user2, plainPassword: pass2 } =
        await createTestTenantAndUser({
          email: 'mustchange2@spice.com',
          mustChangePassword: true,
        });
      const login2 = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user2.email, password: pass2 });
      const token2 = login2.body.data.accessToken as string;

      const app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.get('/api/v1/operational-endpoint', authenticate, (_req, res) =>
        res.json({ ok: true }),
      );

      const resBlocked = await request(app)
        .get('/api/v1/operational-endpoint')
        .set('Authorization', `Bearer ${token2}`);
      expect(resBlocked.status).toBe(403);
      expect(resBlocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    });
  });
});
