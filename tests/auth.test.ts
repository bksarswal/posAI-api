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
import { env } from '../src/config/env.js';
import { authenticate } from '../src/middleware/authenticate.js';
import { authorize } from '../src/middleware/authorize.js';

describe('Task 5: Auth Module (Login, Logout, Authenticate, Authorize)', () => {
  // Relax rate limits for non-rate-limit tests
  const testApp = createApp({
    rateLimits: {
      global: { windowMs: 60000, max: 1000 },
      loginIp: { windowMs: 60000, max: 1000 },
      loginIpEmail: { windowMs: 60000, max: 1000 },
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

    // Logout with unknown token cookie -> 200
    const logoutUnknown = await request(testApp)
      .post('/api/v1/auth/logout')
      .set('Cookie', 'refreshToken=unknown_dummy_token_123');
    expect(logoutUnknown.status).toBe(200);
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

      return app;
    }

    it('7. authenticate enforces valid HS256 tokens, reloads DB role, checks passwordChangedAt and mustChangePassword', async () => {
      const protectedApp = buildProtectedApp();
      const { tenant, user, plainPassword } = await createTestTenantAndUser();

      // Login to get valid token
      const loginRes = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: plainPassword });
      const validToken = loginRes.body.data.accessToken as string;

      // 7a. Missing header -> 401 UNAUTHORIZED
      const resMissing = await request(protectedApp).get('/test-protected');
      expect(resMissing.status).toBe(401);
      expect(resMissing.body.code).toBe('UNAUTHORIZED');

      // 7b. Garbage token -> 401 UNAUTHORIZED
      const resGarbage = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', 'Bearer invalid.garbage.token');
      expect(resGarbage.status).toBe(401);
      expect(resGarbage.body.code).toBe('UNAUTHORIZED');

      // 7c. Wrong secret -> 401 UNAUTHORIZED
      const wrongSecretToken = jwt.sign(
        { sub: user._id.toString(), tid: tenant._id.toString(), role: 'OWNER' },
        'wrong_secret_key_at_least_32_chars_long_123',
        { algorithm: 'HS256', issuer: 'posai-api' },
      );
      const resWrongSecret = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${wrongSecretToken}`);
      expect(resWrongSecret.status).toBe(401);
      expect(resWrongSecret.body.code).toBe('UNAUTHORIZED');

      // 7d. Algorithm "none" token -> 401 UNAUTHORIZED
      const algNoneToken = jwt.sign(
        { sub: user._id.toString(), tid: tenant._id.toString(), role: 'OWNER' },
        '',
        { algorithm: 'none' as unknown as 'HS256' },
      );
      const resAlgNone = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${algNoneToken}`);
      expect(resAlgNone.status).toBe(401);
      expect(resAlgNone.body.code).toBe('UNAUTHORIZED');

      // 7e. Expired token -> 401 TOKEN_EXPIRED
      const expiredToken = jwt.sign(
        { sub: user._id.toString(), tid: tenant._id.toString(), role: 'OWNER' },
        env.JWT_ACCESS_SECRET,
        { algorithm: 'HS256', issuer: 'posai-api', expiresIn: '-1s' },
      );
      const resExpired = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${expiredToken}`);
      expect(resExpired.status).toBe(401);
      expect(resExpired.body.code).toBe('TOKEN_EXPIRED');

      // 7f. Valid token -> 200, downstream handler sees getTenantId() matching token's tenant
      const resValid = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${validToken}`);
      expect(resValid.status).toBe(200);
      expect(resValid.body.currentTenant).toBe(tenant._id.toString());
      expect(resValid.body.auth.userId).toBe(user._id.toString());

      // 7g. User deactivated after token was issued -> 401
      await withGlobalScope(async () => {
        await User.updateOne(
          { _id: user._id },
          { $set: { status: 'INACTIVE' } },
        );
      });
      const resDeactivated = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${validToken}`);
      expect(resDeactivated.status).toBe(401);

      // Reactivate user
      await withGlobalScope(async () => {
        await User.updateOne({ _id: user._id }, { $set: { status: 'ACTIVE' } });
      });

      // 7h. Role changed in DB after token was issued -> DB role wins
      await withGlobalScope(async () => {
        await User.updateOne({ _id: user._id }, { $set: { role: 'MANAGER' } });
      });
      const resRoleChanged = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${validToken}`);
      expect(resRoleChanged.status).toBe(200);
      expect(resRoleChanged.body.auth.role).toBe('MANAGER'); // DB role wins over token 'OWNER'

      // 7i. Token with tid of another tenant with valid sub -> 401
      const otherTenant = await Tenant.create({
        name: 'Other Tenant',
        slug: 'other-tenant-slug-123',
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
      const resSpoofed = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${spoofedTenantToken}`);
      expect(resSpoofed.status).toBe(401);

      // 7j. passwordChangedAt after iat -> 401
      await withGlobalScope(async () => {
        await User.updateOne(
          { _id: user._id },
          { $set: { passwordChangedAt: new Date(Date.now() + 10000) } },
        );
      });
      const resPassChanged = await request(protectedApp)
        .get('/test-protected')
        .set('Authorization', `Bearer ${validToken}`);
      expect(resPassChanged.status).toBe(401);

      // 7k. mustChangePassword -> 403 PASSWORD_CHANGE_REQUIRED except on exempt routes
      const { user: userMustChange, plainPassword: p3 } =
        await createTestTenantAndUser({
          email: 'mustchange@spice.com',
          mustChangePassword: true,
        });

      const loginMustChange = await request(testApp)
        .post('/api/v1/auth/login')
        .send({ email: userMustChange.email, password: p3 });
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
});
