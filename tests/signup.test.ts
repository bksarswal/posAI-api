import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  startTestDb,
  clearAllCollections,
  stopTestDb,
} from './helpers/testDb.js';
import { Tenant } from '../src/modules/tenant/index.js';
import { User } from '../src/modules/user/index.js';
import { withGlobalScope } from '../src/utils/tenantBypass.js';
import { verifyPassword } from '../src/utils/password.js';
import { setEnvForTesting, resetEnvForTesting } from '../src/config/env.js';

describe('POST /api/v1/auth/signup', () => {
  // Test app with relaxed rate limits for happy path and error validation tests
  const testApp = createApp({
    rateLimits: {
      global: { windowMs: 60000, max: 1000 },
      signupIp: { windowMs: 60000, max: 1000 },
      signupIpEmail: { windowMs: 60000, max: 1000 },
    },
  });

  beforeAll(async () => {
    await startTestDb();
  }, 60000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    resetEnvForTesting();
    await clearAllCollections();
  });

  it('1. Happy path: creates Tenant + OWNER, returns 201 without passwordHash or Set-Cookie', async () => {
    const payload = {
      businessName: 'Royal Spice Resto',
      name: 'Vikram Singh',
      email: 'vikram@royalspice.com',
      password: 'StrongPassword123!',
      phone: '+919876543210',
    };

    const res = await request(testApp)
      .post('/api/v1/auth/signup')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.headers['set-cookie']).toBeUndefined();

    expect(res.body).toEqual({
      success: true,
      message: 'Account created successfully',
      data: {
        user: {
          id: expect.any(String),
          tenantId: expect.any(String),
          name: 'Vikram Singh',
          email: 'vikram@royalspice.com',
          role: 'OWNER',
          emailVerified: false,
        },
      },
    });

    const userInResponse = res.body.data.user as Record<string, unknown>;
    expect(userInResponse['passwordHash']).toBeUndefined();
    expect(userInResponse['password']).toBeUndefined();

    // Verify database state: Tenant exists
    const tenant = await Tenant.findById(userInResponse['tenantId']);
    expect(tenant).not.toBeNull();
    expect(tenant?.name).toBe('Royal Spice Resto');
    expect(tenant?.slug).toMatch(/^royal-spice-resto-[a-z0-9]{6}$/);

    // Verify database state: User exists with tenantId matching tenant._id
    const userInDb = await withGlobalScope(async () => {
      return User.findById(userInResponse['id']).select('+passwordHash');
    });

    expect(userInDb).not.toBeNull();
    expect(userInDb?.tenantId.toString()).toBe(tenant?._id.toString());
    expect(userInDb?.role).toBe('OWNER');
    expect(userInDb?.status).toBe('ACTIVE');
    expect(userInDb?.emailVerified).toBe(false);

    // Verify password is encrypted with bcrypt
    expect(userInDb?.passwordHash).toBeDefined();
    expect(userInDb?.passwordHash).not.toBe('StrongPassword123!');
    expect(userInDb?.passwordHash.startsWith('$2')).toBe(true);

    const isMatch = await verifyPassword(
      'StrongPassword123!',
      userInDb!.passwordHash,
    );
    expect(isMatch).toBe(true);
  });

  it('2. emailVerified accurately follows AUTO_VERIFY_EMAIL (true and false)', async () => {
    // Case A: AUTO_VERIFY_EMAIL = false (default)
    const res1 = await request(testApp).post('/api/v1/auth/signup').send({
      businessName: 'Unverified Cafe',
      name: 'Alice',
      email: 'alice@cafe.com',
      password: 'Password123!',
    });
    expect(res1.status).toBe(201);
    expect(res1.body.data.user.emailVerified).toBe(false);

    // Case B: AUTO_VERIFY_EMAIL = true
    setEnvForTesting({ AUTO_VERIFY_EMAIL: true });
    const res2 = await request(testApp).post('/api/v1/auth/signup').send({
      businessName: 'Verified Cafe',
      name: 'Bob',
      email: 'bob@cafe.com',
      password: 'Password123!',
    });
    expect(res2.status).toBe(201);
    expect(res2.body.data.user.emailVerified).toBe(true);
  });

  it('3. rejects duplicate email (including different casing) with 409 EMAIL_ALREADY_REGISTERED', async () => {
    // Initial signup with lowercase email
    const firstRes = await request(testApp).post('/api/v1/auth/signup').send({
      businessName: 'First Place',
      name: 'First User',
      email: 'duplicate@test.com',
      password: 'Password123!',
    });
    expect(firstRes.status).toBe(201);

    // Second signup with UPPERCASE email
    const secondRes = await request(testApp).post('/api/v1/auth/signup').send({
      businessName: 'Second Place',
      name: 'Second User',
      email: 'DUPLICATE@TEST.COM',
      password: 'Password123!',
    });

    expect(secondRes.status).toBe(409);
    expect(secondRes.body).toEqual({
      success: false,
      message: 'Email is already registered',
      code: 'EMAIL_ALREADY_REGISTERED',
    });
  });

  it('4. TWO CONCURRENT signups with the same email result in exactly one 201, one 409, and no orphan tenant', async () => {
    const signupData = {
      businessName: 'Race Condition Kitchen',
      name: 'Concurrent Tester',
      email: 'concurrent@race.com',
      password: 'Password123!',
    };

    // Fire both requests concurrently
    const [resA, resB] = await Promise.all([
      request(testApp).post('/api/v1/auth/signup').send(signupData),
      request(testApp).post('/api/v1/auth/signup').send(signupData),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const failedRes = resA.status === 409 ? resA : resB;
    expect(failedRes.body.code).toBe('EMAIL_ALREADY_REGISTERED');

    // Exactly ONE tenant and ONE user exist in the database (transaction atomicity)
    const tenantCount = await Tenant.countDocuments({
      name: 'Race Condition Kitchen',
    });
    expect(tenantCount).toBe(1);

    const userCount = await withGlobalScope(async () => {
      return User.countDocuments({ email: 'concurrent@race.com' });
    });
    expect(userCount).toBe(1);
  });

  it('5. returns 400 VALIDATION_ERROR on invalid payload, password > 72 bytes, or forbidden fields', async () => {
    // 5a. Bad email
    const resBadEmail = await request(testApp)
      .post('/api/v1/auth/signup')
      .send({
        businessName: 'Valid Name',
        name: 'Valid User',
        email: 'not-an-email',
        password: 'Password123!',
      });
    expect(resBadEmail.status).toBe(400);
    expect(resBadEmail.body.code).toBe('VALIDATION_ERROR');

    // 5b. Short password (< 8 chars)
    const resShortPass = await request(testApp)
      .post('/api/v1/auth/signup')
      .send({
        businessName: 'Valid Name',
        name: 'Valid User',
        email: 'user@test.com',
        password: '123',
      });
    expect(resShortPass.status).toBe(400);
    expect(resShortPass.body.code).toBe('VALIDATION_ERROR');

    // 5c. Password exceeding 72 bytes
    const longPassword = 'a'.repeat(73);
    const resLongPass = await request(testApp)
      .post('/api/v1/auth/signup')
      .send({
        businessName: 'Valid Name',
        name: 'Valid User',
        email: 'user@test.com',
        password: longPassword,
      });
    expect(resLongPass.status).toBe(400);
    expect(resLongPass.body.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(resLongPass.body)).toContain(
      'cannot exceed 72 bytes',
    );

    // 5d. Missing businessName
    const resMissingBusiness = await request(testApp)
      .post('/api/v1/auth/signup')
      .send({
        name: 'Valid User',
        email: 'user@test.com',
        password: 'Password123!',
      });
    expect(resMissingBusiness.status).toBe(400);
    expect(resMissingBusiness.body.code).toBe('VALIDATION_ERROR');

    // 5e. Body containing role (must never be accepted)
    const resWithRole = await request(testApp)
      .post('/api/v1/auth/signup')
      .send({
        businessName: 'Valid Name',
        name: 'Valid User',
        email: 'user@test.com',
        password: 'Password123!',
        role: 'ADMIN',
      });
    expect(resWithRole.status).toBe(400);
    expect(resWithRole.body.code).toBe('VALIDATION_ERROR');

    // 5f. Body containing tenantId (must never be accepted)
    const resWithTenant = await request(testApp)
      .post('/api/v1/auth/signup')
      .send({
        businessName: 'Valid Name',
        name: 'Valid User',
        email: 'user@test.com',
        password: 'Password123!',
        tenantId: '60c72b2f9b1d8b0015f8a000',
      });
    expect(resWithTenant.status).toBe(400);
    expect(resWithTenant.body.code).toBe('VALIDATION_ERROR');
  });

  it('6. same businessName creates distinct slugs, and Devanagari businessName uses fallback slug', async () => {
    // Same businessName twice
    const res1 = await request(testApp).post('/api/v1/auth/signup').send({
      businessName: 'Paradise Biryani',
      name: 'Owner 1',
      email: 'p1@paradise.com',
      password: 'Password123!',
    });
    const res2 = await request(testApp).post('/api/v1/auth/signup').send({
      businessName: 'Paradise Biryani',
      name: 'Owner 2',
      email: 'p2@paradise.com',
      password: 'Password123!',
    });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const tenant1 = await Tenant.findById(res1.body.data.user.tenantId);
    const tenant2 = await Tenant.findById(res2.body.data.user.tenantId);

    expect(tenant1?.slug).toMatch(/^paradise-biryani-[a-z0-9]{6}$/);
    expect(tenant2?.slug).toMatch(/^paradise-biryani-[a-z0-9]{6}$/);
    expect(tenant1?.slug).not.toBe(tenant2?.slug);

    // Devanagari-only businessName
    const resDevanagari = await request(testApp)
      .post('/api/v1/auth/signup')
      .send({
        businessName: 'मसाला रेस्टोरेंट',
        name: 'Shree Ram',
        email: 'shree@masala.com',
        password: 'Password123!',
      });

    expect(resDevanagari.status).toBe(201);
    const devanagariTenant = await Tenant.findById(
      resDevanagari.body.data.user.tenantId,
    );
    expect(devanagariTenant?.slug).toMatch(/^restaurant-[a-z0-9]{6}$/);
  });

  it('7. returns 429 RATE_LIMITED in standard error shape when rate limit is exceeded', async () => {
    // Build isolated app with strict test rate limit (max 2)
    const rateLimitedApp = createApp({
      rateLimits: {
        signupIp: { windowMs: 60000, max: 2 },
        signupIpEmail: { windowMs: 60000, max: 2 },
      },
    });

    // 1st request succeeds
    const res1 = await request(rateLimitedApp)
      .post('/api/v1/auth/signup')
      .send({
        businessName: 'Rate Limit Test 1',
        name: 'User 1',
        email: 'rl1@test.com',
        password: 'Password123!',
      });
    expect(res1.status).toBe(201);

    // 2nd request succeeds
    const res2 = await request(rateLimitedApp)
      .post('/api/v1/auth/signup')
      .send({
        businessName: 'Rate Limit Test 2',
        name: 'User 2',
        email: 'rl2@test.com',
        password: 'Password123!',
      });
    expect(res2.status).toBe(201);

    // 3rd request exceeds limit -> 429 RATE_LIMITED
    const res3 = await request(rateLimitedApp)
      .post('/api/v1/auth/signup')
      .send({
        businessName: 'Rate Limit Test 3',
        name: 'User 3',
        email: 'rl3@test.com',
        password: 'Password123!',
      });

    expect(res3.status).toBe(429);
    expect(res3.body).toEqual({
      success: false,
      message: expect.any(String),
      code: 'RATE_LIMITED',
    });
  });
});
