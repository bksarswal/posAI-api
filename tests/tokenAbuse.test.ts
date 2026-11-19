import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
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
import { env } from '../src/config/env.js';
import { getRefreshTokenCookieOptions } from '../src/modules/auth/auth.constants.js';

describe('Task 10c - Part B: Token Abuse & Auth Edge Case Tests', () => {
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

  // -------------------------------------------------------------
  // Access Token (JWT) Abuse Tests
  // -------------------------------------------------------------
  describe('Access Token Abuse', () => {
    it('1. missing header, empty token, wrong scheme, garbage string, two segments -> 401 UNAUTHORIZED', async () => {
      // Missing header
      const resMissing = await request(app).get('/api/v1/users/me');
      expect(resMissing.status).toBe(401);
      expect(resMissing.body.code).toBe('UNAUTHORIZED');

      // Empty token after Bearer
      const resEmpty = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer ');
      expect(resEmpty.status).toBe(401);
      expect(resEmpty.body.code).toBe('UNAUTHORIZED');

      // Wrong scheme (Basic)
      const resBasic = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', 'Basic dXNlcjpwYXNz');
      expect(resBasic.status).toBe(401);
      expect(resBasic.body.code).toBe('UNAUTHORIZED');

      // Garbage string
      const resGarbage = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer not-even-a-jwt');
      expect(resGarbage.status).toBe(401);
      expect(resGarbage.body.code).toBe('UNAUTHORIZED');

      // Token with only two segments
      const resTwoSegments = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer header.payload');
      expect(resTwoSegments.status).toBe(401);
      expect(resTwoSegments.body.code).toBe('UNAUTHORIZED');
    });

    it('2. expired access token (exp in past, valid signature) -> 401 TOKEN_EXPIRED', async () => {
      const expiredToken = jwt.sign(
        {
          sub: fixture.tenantB.owner.id,
          tid: fixture.tenantB.tenantId,
          role: 'OWNER',
          exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        },
        env.JWT_ACCESS_SECRET,
        { algorithm: 'HS256', issuer: 'posai-api' },
      );

      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_EXPIRED');
    });

    it('3. tampered payload (tid or role changed in middle segment without re-signing) -> 401 UNAUTHORIZED', async () => {
      const validToken = fixture.tenantB.owner.accessToken;
      const parts = validToken.split('.');
      expect(parts).toHaveLength(3);

      // Decode payload, modify role and tid, re-encode base64
      const payload = JSON.parse(
        Buffer.from(parts[1]!, 'base64').toString('utf8'),
      );
      payload.role = 'SUPERADMIN';
      payload.tid = fixture.tenantA.tenantId;

      const tamperedPayloadB64 = Buffer.from(JSON.stringify(payload)).toString(
        'base64url',
      );
      const tamperedToken = `${parts[0]}.${tamperedPayloadB64}.${parts[2]}`;

      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${tamperedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('4. alg: none, different algorithm (HS512), or different secret -> 401 UNAUTHORIZED', async () => {
      // alg: none
      const headerNone = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT' }),
      ).toString('base64url');
      const payloadData = Buffer.from(
        JSON.stringify({
          sub: fixture.tenantB.owner.id,
          tid: fixture.tenantB.tenantId,
          role: 'OWNER',
          iss: 'posai-api',
        }),
      ).toString('base64url');
      const tokenNone = `${headerNone}.${payloadData}.`;

      const resNone = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenNone}`);
      expect(resNone.status).toBe(401);
      expect(resNone.body.code).toBe('UNAUTHORIZED');

      // Signed with different secret
      const wrongSecretToken = jwt.sign(
        {
          sub: fixture.tenantB.owner.id,
          tid: fixture.tenantB.tenantId,
          role: 'OWNER',
        },
        'completely_different_fake_secret_key_32_characters_long',
        { algorithm: 'HS256', issuer: 'posai-api' },
      );

      const resWrongSecret = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${wrongSecretToken}`);
      expect(resWrongSecret.status).toBe(401);
      expect(resWrongSecret.body.code).toBe('UNAUTHORIZED');

      // Signed with HS512 instead of pinned HS256
      const hs512Token = jwt.sign(
        {
          sub: fixture.tenantB.owner.id,
          tid: fixture.tenantB.tenantId,
          role: 'OWNER',
        },
        env.JWT_ACCESS_SECRET,
        { algorithm: 'HS512', issuer: 'posai-api' },
      );

      const resHs512 = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${hs512Token}`);
      expect(resHs512.status).toBe(401);
      expect(resHs512.body.code).toBe('UNAUTHORIZED');
    });

    it('5. correctly signed token with elevated role claim: server uses DB role (OWNER endpoint returns 403 for WAITER)', async () => {
      // Sign token for Tenant A's WAITER user, but elevate the role in token claims to 'OWNER'
      const elevatedToken = jwt.sign(
        {
          sub: fixture.tenantA.staff.waiter!.id,
          tid: fixture.tenantA.tenantId,
          role: 'OWNER', // forged claim
        },
        env.JWT_ACCESS_SECRET,
        { algorithm: 'HS256', issuer: 'posai-api', expiresIn: '15m' },
      );

      // Try calling an OWNER-only endpoint (e.g. POST /api/v1/users to create staff)
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${elevatedToken}`)
        .send({
          name: 'Should Fail Staff',
          email: 'shouldfail@test.com',
          role: 'WAITER',
          branchIds: [fixture.tenantA.branches.main.id],
        });

      // Server must enforce DB role (WAITER cannot create staff) -> 403 FORBIDDEN
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('6. correctly signed token where tid is Tenant B but sub is Tenant A user: rejected with 401 UNAUTHORIZED', async () => {
      // Sub points to Tenant A's user, but tid points to Tenant B
      const mismatchToken = jwt.sign(
        {
          sub: fixture.tenantA.owner.id,
          tid: fixture.tenantB.tenantId,
          role: 'OWNER',
        },
        env.JWT_ACCESS_SECRET,
        { algorithm: 'HS256', issuer: 'posai-api', expiresIn: '15m' },
      );

      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${mismatchToken}`);

      // Middleware queries User inside runWithTenant(payload.tid) -> Tenant A user not found in Tenant B -> 401
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(JSON.stringify(res.body)).not.toContain(
        fixture.tenantA.owner.email,
      );
    });
  });

  // -------------------------------------------------------------
  // Refresh Token (Cookie) Abuse Tests
  // -------------------------------------------------------------
  describe('Refresh Token Cookie Abuse', () => {
    it('8. missing cookie, garbage cookie, random 64-hex cookie -> 401 INVALID_REFRESH_TOKEN and cookie is cleared where applicable', async () => {
      // Missing cookie
      const resMissing = await request(app).post('/api/v1/auth/refresh');
      expect(resMissing.status).toBe(401);
      expect(resMissing.body.code).toBe('INVALID_REFRESH_TOKEN');

      // Garbage cookie
      const resGarbage = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', ['refreshToken=garbage_value']);
      expect(resGarbage.status).toBe(401);
      expect(resGarbage.body.code).toBe('INVALID_REFRESH_TOKEN');
      const garbageCookie = resGarbage.headers['set-cookie']?.[0] || '';
      expect(garbageCookie).toMatch(/^refreshToken=;/);
      expect(
        garbageCookie.includes('Max-Age=0') ||
          garbageCookie.includes('Expires=Thu, 01 Jan 1970 00:00:00 GMT'),
      ).toBe(true);

      // Random 64-hex string cookie
      const randomHexCookie = 'c'.repeat(64);
      const resRandomHex = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refreshToken=${randomHexCookie}`]);
      expect(resRandomHex.status).toBe(401);
      expect(resRandomHex.body.code).toBe('INVALID_REFRESH_TOKEN');
      const randomHexSetCookie = resRandomHex.headers['set-cookie']?.[0] || '';
      expect(randomHexSetCookie).toMatch(/^refreshToken=;/);
      expect(
        randomHexSetCookie.includes('Max-Age=0') ||
          randomHexSetCookie.includes('Expires=Thu, 01 Jan 1970 00:00:00 GMT'),
      ).toBe(true);
    });

    it('9. using an access token as refresh cookie -> 401 INVALID_REFRESH_TOKEN; using refresh token as Bearer token -> 401 UNAUTHORIZED', async () => {
      // Access token in Cookie header -> rejected by refresh controller as INVALID_REFRESH_TOKEN
      const resAccessAsCookie = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refreshToken=${fixture.tenantB.owner.accessToken}`]);
      expect(resAccessAsCookie.status).toBe(401);
      expect(resAccessAsCookie.body.code).toBe('INVALID_REFRESH_TOKEN');

      // Refresh token raw string in Authorization header -> rejected by authenticate middleware as UNAUTHORIZED
      const rawRefreshCookieVal = fixture.tenantB.owner.cookie.replace(
        'refreshToken=',
        '',
      );
      const resRefreshAsBearer = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${rawRefreshCookieVal}`);
      expect(resRefreshAsBearer.status).toBe(401);
      expect(resRefreshAsBearer.body.code).toBe('UNAUTHORIZED');
    });

    it('11. refresh token of Tenant A cannot obtain tokens for Tenant B (issued token tid matches A)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', [fixture.tenantA.owner.cookie]);

      expect(res.status).toBe(200);
      const newAccessToken = res.body.data.accessToken as string;
      const decoded = jwt.decode(newAccessToken) as {
        tid: string;
        sub: string;
      };

      expect(decoded.tid).toBe(fixture.tenantA.tenantId);
      expect(decoded.sub).toBe(fixture.tenantA.owner.id);
      expect(decoded.tid).not.toBe(fixture.tenantB.tenantId);
    });

    it('12. cookie attributes on login and refresh Set-Cookie match src definition (HttpOnly, Path, SameSite, Max-Age)', async () => {
      const expectedCookieOptions = getRefreshTokenCookieOptions();

      const resLogin = await request(app).post('/api/v1/auth/login').send({
        email: fixture.tenantB.owner.email,
        password: 'ValidPassword123!',
      });

      expect(resLogin.status).toBe(200);
      const cookieHeader = resLogin.headers['set-cookie']?.[0] || '';

      if (expectedCookieOptions.httpOnly) {
        expect(cookieHeader).toContain('HttpOnly');
      }
      expect(cookieHeader).toContain(`Path=${expectedCookieOptions.path}`);

      // SameSite configured as 'lax' in getRefreshTokenCookieOptions
      const expectedSameSite = (
        expectedCookieOptions.sameSite as string
      ).toLowerCase();
      expect(cookieHeader.toLowerCase()).toContain(
        `samesite=${expectedSameSite}`,
      );

      // Max-Age matches configured TTL (7 days in seconds = 604800)
      const expectedMaxAgeSeconds = (expectedCookieOptions.maxAge ?? 0) / 1000;
      expect(cookieHeader).toContain(`Max-Age=${expectedMaxAgeSeconds}`);
    });
  });

  // -------------------------------------------------------------
  // Leaks, Headers & Error Sanitation
  // -------------------------------------------------------------
  describe('Leaks, Headers & Error Sanitation', () => {
    it('14. error responses never leak stack traces, passwordHash, token hashes; x-powered-by header is absent', async () => {
      const res = await request(app)
        .get('/api/v1/branches/invalid-non-object-id')
        .set('Authorization', `Bearer ${fixture.tenantB.owner.accessToken}`);

      expect(res.status).toBe(400);

      // x-powered-by header must be stripped (helmet/app config)
      expect(res.headers['x-powered-by']).toBeUndefined();

      // Error response payload must not leak internals
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain('stack');
      expect(bodyStr).not.toContain('passwordHash');
      expect(bodyStr).not.toContain('tokenHash');
      expect(bodyStr).not.toContain('MongoError');
    });
  });
});
