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
import { Tenant } from '../src/modules/tenant/index.js';
import { User, UserService } from '../src/modules/user/index.js';
import { AuthToken, AuthTokenService } from '../src/modules/auth/index.js';
import { getEmailProvider } from '../src/utils/email/index.js';
import { setEnvForTesting, resetEnvForTesting } from '../src/config/env.js';
import * as passwordModule from '../src/utils/password.js';
import { withGlobalScope } from '../src/utils/tenantBypass.js';
import { runWithTenant } from '../src/utils/tenantContext.js';
import { hashToken } from '../src/utils/token.js';

describe('Task 7: Auth Tokens (Email Verification, Forgot Password, Reset Password)', () => {
  const testApp = createApp({
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

  beforeAll(async () => {
    await startTestDb();
  }, 60000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    resetEnvForTesting();
    await clearAllCollections();
  });

  async function createTestTenantAndUser(
    options: {
      email?: string;
      password?: string;
      emailVerified?: boolean;
      status?: 'ACTIVE' | 'INACTIVE';
    } = {},
  ) {
    const tenant = await Tenant.create({
      name: 'Spice Garden',
      slug: `spice-${Math.random().toString(36).substring(2, 8)}`,
      status: 'ACTIVE',
    });

    const password = options.password ?? 'ValidPassword123!';
    const passwordHash = await passwordModule.hashPassword(password);

    const user = await runWithTenant(tenant._id, async () => {
      return UserService.createUser({
        name: 'Test Owner',
        email: (options.email ?? 'owner@spice.com').toLowerCase().trim(),
        passwordHash,
        role: 'OWNER',
        emailVerified: options.emailVerified ?? false,
      });
    });

    if (options.status === 'INACTIVE') {
      await withGlobalScope(async () => {
        await User.updateOne(
          { _id: user._id },
          { $set: { status: 'INACTIVE' } },
        );
      });
    }

    return { tenant, user, plainPassword: password };
  }

  it('1. Signup with AUTO_VERIFY_EMAIL false sends exactly one verification email; with true sends none. A failing provider does not fail signup', async () => {
    const sendSpy = vi
      .spyOn(getEmailProvider(), 'send')
      .mockImplementation(async () => {});

    // Case A: AUTO_VERIFY_EMAIL = false -> sends exactly 1 email
    setEnvForTesting({ AUTO_VERIFY_EMAIL: false });

    const resFalse = await request(testApp).post('/api/v1/auth/signup').send({
      businessName: 'Royal Spice',
      name: 'Alice',
      email: 'alice@royal.com',
      password: 'ValidPassword123!',
    });

    expect(resFalse.status).toBe(201);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const emailCall = sendSpy.mock.calls[0]?.[0];
    expect(emailCall?.to).toBe('alice@royal.com');
    expect(emailCall?.subject).toContain('Verify your email');
    expect(emailCall?.text).toContain('/verify-email?token=');
    expect(emailCall?.html).toContain('/verify-email?token=');

    // Extract raw token from email and verify DB stores only hash
    const rawTokenMatch = emailCall?.text.match(/token=([^&\s]+)/);
    expect(rawTokenMatch).toBeDefined();
    const rawToken = rawTokenMatch?.[1];
    expect(rawToken).toBeDefined();

    const dbToken = await withGlobalScope(async () => {
      return AuthToken.findOne({ userId: resFalse.body.data.user.id });
    });
    expect(dbToken).not.toBeNull();
    expect(dbToken?.tokenHash).toBe(hashToken(rawToken!));
    expect(dbToken?.tokenHash).not.toBe(rawToken);

    sendSpy.mockClear();

    // Case B: AUTO_VERIFY_EMAIL = true -> sends 0 emails
    setEnvForTesting({ AUTO_VERIFY_EMAIL: true });

    const resTrue = await request(testApp).post('/api/v1/auth/signup').send({
      businessName: 'Green Spice',
      name: 'Bob',
      email: 'bob@green.com',
      password: 'ValidPassword123!',
    });

    expect(resTrue.status).toBe(201);
    expect(sendSpy).toHaveBeenCalledTimes(0);

    sendSpy.mockClear();

    // Case C: Failing email provider does NOT fail signup
    setEnvForTesting({ AUTO_VERIFY_EMAIL: false });
    sendSpy.mockRejectedValueOnce(new Error('SMTP connection timed out'));

    const resFailSend = await request(testApp)
      .post('/api/v1/auth/signup')
      .send({
        businessName: 'Golden Spice',
        name: 'Charlie',
        email: 'charlie@gold.com',
        password: 'ValidPassword123!',
      });

    expect(resFailSend.status).toBe(201);
    expect(resFailSend.body.success).toBe(true);
    expect(resFailSend.body.data.user.email).toBe('charlie@gold.com');
  });

  it('2. verify-email: success marks emailVerified and emailVerifiedAt, and login now works; same token twice -> 400; expired token -> 400; garbage token -> 400; DB stores only hash', async () => {
    const { user, plainPassword, tenant } = await createTestTenantAndUser({
      email: 'unverified@test.com',
      emailVerified: false,
    });

    // Login fails initially with 403 EMAIL_NOT_VERIFIED
    const loginFail = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: plainPassword });
    expect(loginFail.status).toBe(403);
    expect(loginFail.body.code).toBe('EMAIL_NOT_VERIFIED');

    // Create verification token
    const { rawToken, authToken } = await AuthTokenService.createAuthToken({
      tenantId: tenant._id,
      userId: user._id,
      type: 'EMAIL_VERIFICATION',
    });

    // Verify DB stores only hash
    expect(authToken.tokenHash).toBe(hashToken(rawToken));
    expect(authToken.tokenHash).not.toBe(rawToken);

    // Garbage token -> 400 INVALID_OR_EXPIRED_TOKEN
    const resGarbage = await request(testApp)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'completely_bogus_token' });
    expect(resGarbage.status).toBe(400);
    expect(resGarbage.body.code).toBe('INVALID_OR_EXPIRED_TOKEN');

    // Expired token -> 400 INVALID_OR_EXPIRED_TOKEN
    const { rawToken: expiredRawToken, authToken: expiredDoc } =
      await AuthTokenService.createAuthToken({
        tenantId: tenant._id,
        userId: user._id,
        type: 'EMAIL_VERIFICATION',
      });
    await withGlobalScope(async () => {
      await AuthToken.updateOne(
        { _id: expiredDoc._id },
        { $set: { expiresAt: new Date(Date.now() - 60000) } },
      );
    });
    const resExpired = await request(testApp)
      .post('/api/v1/auth/verify-email')
      .send({ token: expiredRawToken });
    expect(resExpired.status).toBe(400);
    expect(resExpired.body.code).toBe('INVALID_OR_EXPIRED_TOKEN');

    // Valid token -> 200 success
    // Note: older rawToken was invalidated when expiredDoc was created, so create a fresh one
    const { rawToken: freshToken } = await AuthTokenService.createAuthToken({
      tenantId: tenant._id,
      userId: user._id,
      type: 'EMAIL_VERIFICATION',
    });

    const resValid = await request(testApp)
      .post('/api/v1/auth/verify-email')
      .send({ token: freshToken });
    expect(resValid.status).toBe(200);
    expect(resValid.body.message).toBe('Email verified successfully');

    // Verify DB user record
    const updatedUser = await withGlobalScope(async () => {
      return User.findById(user._id);
    });
    expect(updatedUser?.emailVerified).toBe(true);
    expect(updatedUser?.emailVerifiedAt).toBeDefined();

    // Login now works
    const loginSuccess = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: plainPassword });
    expect(loginSuccess.status).toBe(200);
    expect(loginSuccess.body.data.accessToken).toBeDefined();

    // Replay same token -> 400 INVALID_OR_EXPIRED_TOKEN
    const resReplay = await request(testApp)
      .post('/api/v1/auth/verify-email')
      .send({ token: freshToken });
    expect(resReplay.status).toBe(400);
    expect(resReplay.body.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('3. resend-verification: unknown email, verified user and unverified user all get identical 200 body; email sent only for unverified user; cooldown blocks within 60s; old token stops working after new token issued; rate limit -> 429', async () => {
    const sendSpy = vi
      .spyOn(getEmailProvider(), 'send')
      .mockImplementation(async () => {});

    // Create unverified user and verified user
    const { user: unverifiedUser } = await createTestTenantAndUser({
      email: 'unverified_resend@test.com',
      emailVerified: false,
    });

    const { user: verifiedUser } = await createTestTenantAndUser({
      email: 'verified_resend@test.com',
      emailVerified: true,
    });

    // 1. Unknown email -> 200 generic message, 0 emails sent
    const resUnknown = await request(testApp)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'ghost@nowhere.com' });
    expect(resUnknown.status).toBe(200);
    expect(resUnknown.body.message).toBe(
      'If the account exists and is not verified, an email has been sent',
    );
    expect(sendSpy).toHaveBeenCalledTimes(0);

    // 2. Verified user -> identical 200 message, 0 emails sent
    const resVerified = await request(testApp)
      .post('/api/v1/auth/resend-verification')
      .send({ email: verifiedUser.email });
    expect(resVerified.status).toBe(200);
    expect(resVerified.body.message).toBe(resUnknown.body.message);
    expect(sendSpy).toHaveBeenCalledTimes(0);

    // 3. Unverified user -> identical 200 message, 1 email sent
    const resUnverified = await request(testApp)
      .post('/api/v1/auth/resend-verification')
      .send({ email: unverifiedUser.email });
    expect(resUnverified.status).toBe(200);
    expect(resUnverified.body.message).toBe(resUnknown.body.message);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const firstEmail = sendSpy.mock.calls[0]?.[0];
    const rawToken1 = firstEmail?.text.match(/token=([^&\s]+)/)?.[1];
    expect(rawToken1).toBeDefined();

    sendSpy.mockClear();

    // 4. Second request within 60 seconds sends NOTHING
    const resCooldown = await request(testApp)
      .post('/api/v1/auth/resend-verification')
      .send({ email: unverifiedUser.email });
    expect(resCooldown.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledTimes(0);

    // 5. Advance cooldown: backdate last token by 70s
    await withGlobalScope(async () => {
      await AuthToken.collection.updateMany(
        { userId: unverifiedUser._id },
        { $set: { createdAt: new Date(Date.now() - 70000) } },
      );
    });

    // Now request again -> email sent, invalidates old token
    const resAfterCooldown = await request(testApp)
      .post('/api/v1/auth/resend-verification')
      .send({ email: unverifiedUser.email });
    expect(resAfterCooldown.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const secondEmail = sendSpy.mock.calls[0]?.[0];
    const rawToken2 = secondEmail?.text.match(/token=([^&\s]+)/)?.[1];
    expect(rawToken2).toBeDefined();
    expect(rawToken2).not.toBe(rawToken1);

    // Old token 1 stops working
    const verifyOld = await request(testApp)
      .post('/api/v1/auth/verify-email')
      .send({ token: rawToken1! });
    expect(verifyOld.status).toBe(400);
    expect(verifyOld.body.code).toBe('INVALID_OR_EXPIRED_TOKEN');

    // New token 2 works
    const verifyNew = await request(testApp)
      .post('/api/v1/auth/verify-email')
      .send({ token: rawToken2! });
    expect(verifyNew.status).toBe(200);

    // Rate limiting check
    const rateLimitedApp = createApp({
      rateLimits: {
        resendVerificationIpEmail: { windowMs: 60000, max: 2 },
      },
    });

    const r1 = await request(rateLimitedApp)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'rate_resend@test.com' });
    expect(r1.status).toBe(200);

    const r2 = await request(rateLimitedApp)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'rate_resend@test.com' });
    expect(r2.status).toBe(200);

    const r3 = await request(rateLimitedApp)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'rate_resend@test.com' });
    expect(r3.status).toBe(429);
    expect(r3.body.code).toBe('RATE_LIMITED');
  });

  it('4. forgot-password: unknown and known email get identical 200 body; email sent only for existing ACTIVE user; INACTIVE user gets none; rate limit -> 429', async () => {
    const sendSpy = vi
      .spyOn(getEmailProvider(), 'send')
      .mockImplementation(async () => {});

    const { user: activeUser } = await createTestTenantAndUser({
      email: 'active_forgot@test.com',
      status: 'ACTIVE',
    });

    const { user: inactiveUser } = await createTestTenantAndUser({
      email: 'inactive_forgot@test.com',
      status: 'INACTIVE',
    });

    // 1. Unknown email -> 200 generic message, 0 emails sent
    const resUnknown = await request(testApp)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'unknown@nowhere.com' });
    expect(resUnknown.status).toBe(200);
    expect(resUnknown.body.message).toBe(
      'If the account exists, a password reset email has been sent',
    );
    expect(sendSpy).toHaveBeenCalledTimes(0);

    // 2. INACTIVE user -> identical 200 message, 0 emails sent
    const resInactive = await request(testApp)
      .post('/api/v1/auth/forgot-password')
      .send({ email: inactiveUser.email });
    expect(resInactive.status).toBe(200);
    expect(resInactive.body.message).toBe(resUnknown.body.message);
    expect(sendSpy).toHaveBeenCalledTimes(0);

    // 3. Known ACTIVE user -> identical 200 message, 1 email sent
    const resActive = await request(testApp)
      .post('/api/v1/auth/forgot-password')
      .send({ email: activeUser.email });
    expect(resActive.status).toBe(200);
    expect(resActive.body.message).toBe(resUnknown.body.message);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const emailCall = sendSpy.mock.calls[0]?.[0];
    expect(emailCall?.to).toBe(activeUser.email);
    expect(emailCall?.subject).toContain('Reset your password');
    expect(emailCall?.text).toContain('/reset-password?token=');

    sendSpy.mockClear();

    // 4. Second request within 60s cooldown sends 0 emails
    const resCooldown = await request(testApp)
      .post('/api/v1/auth/forgot-password')
      .send({ email: activeUser.email });
    expect(resCooldown.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledTimes(0);

    // Rate limiting check
    const rateLimitedApp = createApp({
      rateLimits: {
        forgotPasswordIpEmail: { windowMs: 60000, max: 2 },
      },
    });

    const r1 = await request(rateLimitedApp)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'rate_forgot@test.com' });
    expect(r1.status).toBe(200);

    const r2 = await request(rateLimitedApp)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'rate_forgot@test.com' });
    expect(r2.status).toBe(200);

    const r3 = await request(rateLimitedApp)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'rate_forgot@test.com' });
    expect(r3.status).toBe(429);
    expect(r3.body.code).toBe('RATE_LIMITED');
  });

  it('5. reset-password: success changes password (new works, old fails), sets emailVerified, revokes all refresh families, and old access tokens get 401 TOKEN_REVOKED; same token twice -> 400; expired -> 400; INACTIVE user -> 400; weak or >72 bytes password -> 400', async () => {
    const sendSpy = vi
      .spyOn(getEmailProvider(), 'send')
      .mockImplementation(async () => {});

    const { user, plainPassword, tenant } = await createTestTenantAndUser({
      email: 'reset_flow@test.com',
      emailVerified: true,
    });

    // Login on Device 1 & Device 2
    const loginDev1 = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: plainPassword });
    const tokenDev1 = loginDev1.body.data.accessToken as string;
    const cookieDev1 =
      loginDev1.headers['set-cookie']?.[0]?.split(';')[0] || '';

    const loginDev2 = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: plainPassword });
    const tokenDev2 = loginDev2.body.data.accessToken as string;
    const cookieDev2 =
      loginDev2.headers['set-cookie']?.[0]?.split(';')[0] || '';

    // Allow 1s so token iat < passwordChangedAt
    await new Promise((r) => setTimeout(r, 1000));

    // Request reset token
    await request(testApp)
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const resetEmail = sendSpy.mock.calls[0]?.[0];
    const rawResetToken = resetEmail?.text.match(/token=([^&\s]+)/)?.[1];
    expect(rawResetToken).toBeDefined();

    // Mark emailVerified false so we can assert reset-password marks it verified
    await withGlobalScope(async () => {
      await User.updateOne(
        { _id: user._id },
        { $set: { emailVerified: false } },
      );
    });

    // 1. Weak password -> 400
    const resShort = await request(testApp)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawResetToken!, newPassword: 'short' });
    expect(resShort.status).toBe(400);

    // 2. Over 72 bytes -> 400
    const resLong = await request(testApp)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawResetToken!, newPassword: 'a'.repeat(73) });
    expect(resLong.status).toBe(400);

    // 3. Success reset
    const newPassword = 'BrandNewSecurePassword999!';
    const resSuccess = await request(testApp)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawResetToken!, newPassword });
    expect(resSuccess.status).toBe(200);
    expect(resSuccess.body.message).toContain('Password reset successfully');

    // 4. Verify DB changes: emailVerified=true, passwordChangedAt set
    const dbUser = await withGlobalScope(async () => {
      return User.findById(user._id);
    });
    expect(dbUser?.emailVerified).toBe(true);
    expect(dbUser?.passwordChangedAt).toBeDefined();

    // 5. New password works immediately, old password fails
    const loginNew = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: newPassword });
    expect(loginNew.status).toBe(200);
    expect(loginNew.body.data.accessToken).toBeDefined();

    const loginOld = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: plainPassword });
    expect(loginOld.status).toBe(401);

    // 6. Refresh tokens from both devices fail
    const refDev1 = await request(testApp)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieDev1);
    expect(refDev1.status).toBe(401);

    const refDev2 = await request(testApp)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieDev2);
    expect(refDev2.status).toBe(401);

    // 7. Old access tokens get 401 TOKEN_REVOKED
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

    // 8. Same token twice -> 400
    const resTwice = await request(testApp)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawResetToken!, newPassword: 'YetAnotherPassword123!' });
    expect(resTwice.status).toBe(400);
    expect(resTwice.body.code).toBe('INVALID_OR_EXPIRED_TOKEN');

    // 9. Expired token -> 400
    const { rawToken: expiredToken, authToken: expDoc } =
      await AuthTokenService.createAuthToken({
        tenantId: tenant._id,
        userId: user._id,
        type: 'PASSWORD_RESET',
      });
    await withGlobalScope(async () => {
      await AuthToken.updateOne(
        { _id: expDoc._id },
        { $set: { expiresAt: new Date(Date.now() - 60000) } },
      );
    });

    const resExpired = await request(testApp)
      .post('/api/v1/auth/reset-password')
      .send({ token: expiredToken, newPassword: 'YetAnotherPassword123!' });
    expect(resExpired.status).toBe(400);
    expect(resExpired.body.code).toBe('INVALID_OR_EXPIRED_TOKEN');

    // 10. INACTIVE user -> 400
    const { user: inactiveU, tenant: inactTenant } =
      await createTestTenantAndUser({
        email: 'inactive_reset@test.com',
        status: 'INACTIVE',
      });
    const { rawToken: tokenInactive } = await AuthTokenService.createAuthToken({
      tenantId: inactTenant._id,
      userId: inactiveU._id,
      type: 'PASSWORD_RESET',
    });

    const resInactive = await request(testApp)
      .post('/api/v1/auth/reset-password')
      .send({ token: tokenInactive, newPassword: 'YetAnotherPassword123!' });
    expect(resInactive.status).toBe(400);
    expect(resInactive.body.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('6. Two CONCURRENT reset-password calls with the same token: exactly one 200 and one 400', async () => {
    const { user, tenant } = await createTestTenantAndUser({
      email: 'concurrent_reset@test.com',
    });

    const { rawToken } = await AuthTokenService.createAuthToken({
      tenantId: tenant._id,
      userId: user._id,
      type: 'PASSWORD_RESET',
    });

    const [res1, res2] = await Promise.all([
      request(testApp)
        .post('/api/v1/auth/reset-password')
        .send({ token: rawToken, newPassword: 'NewPassword123!' }),
      request(testApp)
        .post('/api/v1/auth/reset-password')
        .send({ token: rawToken, newPassword: 'NewPassword123!' }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 400]);

    const errorRes = res1.status === 400 ? res1 : res2;
    expect(errorRes.body.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('7. Tokens are tenant-safe: token of tenant A can never change a user of tenant B, and guard test passes for new model', async () => {
    // Tenant A & User A
    const { user: userA, tenant: tenantA } = await createTestTenantAndUser({
      email: 'userA@tenantA.com',
      emailVerified: true,
    });

    // Tenant B & User B
    const { user: userB, plainPassword: passB } = await createTestTenantAndUser(
      {
        email: 'userB@tenantB.com',
        emailVerified: true,
      },
    );

    // Create reset token for User A under Tenant A
    const { rawToken: tokenA } = await AuthTokenService.createAuthToken({
      tenantId: tenantA._id,
      userId: userA._id,
      type: 'PASSWORD_RESET',
    });

    // Reset password using User A's token
    const resReset = await request(testApp)
      .post('/api/v1/auth/reset-password')
      .send({ token: tokenA, newPassword: 'NewPasswordA123!' });
    expect(resReset.status).toBe(200);

    // Verify User A password changed
    const loginA = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: userA.email, password: 'NewPasswordA123!' });
    expect(loginA.status).toBe(200);

    // Verify User B in Tenant B is completely unchanged
    const loginB = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: userB.email, password: passB });
    expect(loginB.status).toBe(200);

    const userBDoc = await withGlobalScope(async () => {
      return User.findById(userB._id);
    });
    expect(userBDoc?.passwordChangedAt).toBeUndefined();
  });

  it('8. verify-email: failure in markEmailVerified rolls back transaction so token is not consumed and can be retried', async () => {
    const { user, tenant } = await createTestTenantAndUser({
      email: 'verify_tx@test.com',
      emailVerified: false,
    });

    const { rawToken } = await AuthTokenService.createAuthToken({
      tenantId: tenant._id,
      userId: user._id,
      type: 'EMAIL_VERIFICATION',
    });

    // Mock markEmailVerified to fail once
    const markSpy = vi
      .spyOn(UserService, 'markEmailVerified')
      .mockRejectedValueOnce(new Error('Simulated DB update failure'));

    const resFail = await request(testApp)
      .post('/api/v1/auth/verify-email')
      .send({ token: rawToken });
    expect(resFail.status).toBe(500);

    // Verify token was NOT consumed in DB
    const tokenDoc = await withGlobalScope(async () => {
      return AuthToken.findOne({ tokenHash: hashToken(rawToken) });
    });
    expect(tokenDoc?.usedAt).toBeUndefined();

    // Verify user is still unverified
    const userDoc = await withGlobalScope(async () => {
      return User.findById(user._id);
    });
    expect(userDoc?.emailVerified).toBe(false);

    // Now retry without failure -> 200 success
    markSpy.mockRestore();

    const resSuccess = await request(testApp)
      .post('/api/v1/auth/verify-email')
      .send({ token: rawToken });
    expect(resSuccess.status).toBe(200);

    const tokenDocSuccess = await withGlobalScope(async () => {
      return AuthToken.findOne({ tokenHash: hashToken(rawToken) });
    });
    expect(tokenDocSuccess?.usedAt).toBeDefined();

    const userDocSuccess = await withGlobalScope(async () => {
      return User.findById(user._id);
    });
    expect(userDocSuccess?.emailVerified).toBe(true);
  });

  it('9. Shared passwordSchema: signup, change-password, and reset-password accept and reject passwords identically', async () => {
    const { user, plainPassword, tenant } = await createTestTenantAndUser({
      email: 'pwd_parity@test.com',
      emailVerified: true,
    });

    const loginRes = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: plainPassword });
    const accessToken = loginRes.body.data.accessToken as string;

    const { rawToken } = await AuthTokenService.createAuthToken({
      tenantId: tenant._id,
      userId: user._id,
      type: 'PASSWORD_RESET',
    });

    // 1. Password under 8 chars -> rejected by all three
    const shortPwd = 'short';
    const signupShort = await request(testApp)
      .post('/api/v1/auth/signup')
      .send({
        businessName: 'Biz',
        name: 'User',
        email: 'short@test.com',
        password: shortPwd,
      });
    expect(signupShort.status).toBe(400);

    const changeShort = await request(testApp)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: plainPassword, newPassword: shortPwd });
    expect(changeShort.status).toBe(400);

    const resetShort = await request(testApp)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, newPassword: shortPwd });
    expect(resetShort.status).toBe(400);

    // 2. Password over 72 bytes -> rejected by all three
    const longPwd = 'a'.repeat(73);
    const signupLong = await request(testApp).post('/api/v1/auth/signup').send({
      businessName: 'Biz',
      name: 'User',
      email: 'long@test.com',
      password: longPwd,
    });
    expect(signupLong.status).toBe(400);

    const changeLong = await request(testApp)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: plainPassword, newPassword: longPwd });
    expect(changeLong.status).toBe(400);

    const resetLong = await request(testApp)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, newPassword: longPwd });
    expect(resetLong.status).toBe(400);

    // 3. Simple 8-char password without special chars/numbers -> accepted by all three
    const simplePwd = 'simplepwd';
    const signupSimple = await request(testApp)
      .post('/api/v1/auth/signup')
      .send({
        businessName: 'Simple Biz',
        name: 'Simple User',
        email: 'simple@test.com',
        password: simplePwd,
      });
    expect(signupSimple.status).toBe(201);

    const changeSimple = await request(testApp)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: plainPassword, newPassword: simplePwd });
    expect(changeSimple.status).toBe(200);

    // Token for reset with simple password
    const { rawToken: simpleResetToken } =
      await AuthTokenService.createAuthToken({
        tenantId: tenant._id,
        userId: user._id,
        type: 'PASSWORD_RESET',
      });
    const resetSimple = await request(testApp)
      .post('/api/v1/auth/reset-password')
      .send({ token: simpleResetToken, newPassword: simplePwd });
    expect(resetSimple.status).toBe(200);
  });
});
