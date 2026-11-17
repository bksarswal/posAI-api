import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import request from 'supertest';
import { createLogger, REDACT_PATHS } from '../../src/utils/logger.js';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';

describe('Logger redaction and configuration', () => {
  it('has redaction paths covering all required sensitive keys', () => {
    const requiredKeys = [
      'password',
      'temporaryPassword',
      'token',
      'accessToken',
      'refreshToken',
      'verificationToken',
      'resetToken',
      'authorization',
      'cookie',
      'SMTP_PASS',
      'smtpPass',
      'body',
    ];

    for (const key of requiredKeys) {
      const isCovered = REDACT_PATHS.some(
        (p) => p === key || p === `*.${key}` || p.endsWith(`.${key}`),
      );
      expect(isCovered, `Expected redaction paths to cover key: ${key}`).toBe(
        true,
      );
    }
  });

  it('redacts sensitive fields in logged objects across top-level and nested paths', () => {
    let output = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });

    const testLogger = createLogger({ level: 'info' }, destination);

    const secretPassword = 'MySecretPassword123!';
    const secretTempPassword = 'TempSecretPassword99!';
    const secretAccessToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretAccess';
    const secretRefreshToken = 'f7c8d9e0a1b2c3d4e5f6a7b8c9d0e1f2';
    const secretAuthHeader = 'Bearer secret-jwt-bearer-token';
    const secretCookie = 'refreshToken=super-secret-cookie-val';
    const secretSmtpPass = 'super-smtp-api-key';

    testLogger.info({
      message: 'Processing sensitive event',
      password: secretPassword,
      temporaryPassword: secretTempPassword,
      token: secretAccessToken,
      accessToken: secretAccessToken,
      refreshToken: secretRefreshToken,
      authorization: secretAuthHeader,
      cookie: secretCookie,
      SMTP_PASS: secretSmtpPass,
      nested: {
        password: secretPassword,
        token: secretRefreshToken,
        body: { creditCard: '411111111111' },
      },
      user: {
        password: secretPassword,
      },
      data: {
        temporaryPassword: secretTempPassword,
      },
      headers: {
        authorization: secretAuthHeader,
        cookie: secretCookie,
      },
      wrapper: {
        user: {
          password: secretPassword,
        },
        data: {
          temporaryPassword: secretTempPassword,
        },
        headers: {
          authorization: secretAuthHeader,
          cookie: secretCookie,
        },
      },
      usersList: [
        {
          password: secretPassword,
          token: secretAccessToken,
        },
      ],
      req: {
        headers: {
          authorization: secretAuthHeader,
          cookie: secretCookie,
        },
        body: {
          password: secretPassword,
        },
      },
    });

    const parsed = JSON.parse(output);

    // Verify all sensitive keys are replaced with [REDACTED]
    expect(parsed.password).toBe('[REDACTED]');
    expect(parsed.temporaryPassword).toBe('[REDACTED]');
    expect(parsed.token).toBe('[REDACTED]');
    expect(parsed.accessToken).toBe('[REDACTED]');
    expect(parsed.refreshToken).toBe('[REDACTED]');
    expect(parsed.authorization).toBe('[REDACTED]');
    expect(parsed.cookie).toBe('[REDACTED]');
    expect(parsed.SMTP_PASS).toBe('[REDACTED]');
    expect(parsed.nested.password).toBe('[REDACTED]');
    expect(parsed.nested.token).toBe('[REDACTED]');
    expect(parsed.nested.body).toBe('[REDACTED]');
    expect(parsed.user.password).toBe('[REDACTED]');
    expect(parsed.data.temporaryPassword).toBe('[REDACTED]');
    expect(parsed.headers.authorization).toBe('[REDACTED]');
    expect(parsed.headers.cookie).toBe('[REDACTED]');
    expect(parsed.wrapper.user.password).toBe('[REDACTED]');
    expect(parsed.wrapper.data.temporaryPassword).toBe('[REDACTED]');
    expect(parsed.wrapper.headers.authorization).toBe('[REDACTED]');
    expect(parsed.wrapper.headers.cookie).toBe('[REDACTED]');
    expect(parsed.usersList[0].password).toBe('[REDACTED]');
    expect(parsed.usersList[0].token).toBe('[REDACTED]');
    expect(parsed.req.headers.authorization).toBe('[REDACTED]');
    expect(parsed.req.headers.cookie).toBe('[REDACTED]');
    expect(parsed.req.body).toBe('[REDACTED]');

    // Verify raw secret strings NEVER appear anywhere in the serialized log output
    expect(output).not.toContain(secretPassword);
    expect(output).not.toContain(secretTempPassword);
    expect(output).not.toContain(secretAccessToken);
    expect(output).not.toContain(secretRefreshToken);
    expect(output).not.toContain(secretAuthHeader);
    expect(output).not.toContain(secretCookie);
    expect(output).not.toContain(secretSmtpPass);
    expect(output).not.toContain('411111111111');
  });

  it('defaults log level to silent under test environment', () => {
    expect(env.LOG_LEVEL).toBe('silent');
  });

  it('captures single set of fields, full path without query string, and final status for nested routes', async () => {
    const logLines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        const line = chunk.toString().trim();
        if (line) {
          logLines.push(line);
        }
        callback();
      },
    });

    const testLogger = createLogger({ level: 'info' }, destination);
    const testApp = createApp({ customLogger: testLogger });

    // 1. Nested route with sensitive query string
    const res = await request(testApp).post(
      '/api/v1/auth/logout?token=sensitive-query-token-12345',
    );
    expect(res.status).toBe(200);

    expect(logLines.length).toBe(1);
    const logRaw = logLines[0] as string;

    // Verify raw JSON string does not have duplicate keys (e.g. "path": appearing twice)
    const methodMatches = logRaw.match(/"method":/g);
    expect(methodMatches).toHaveLength(1);

    const pathMatches = logRaw.match(/"path":/g);
    expect(pathMatches).toHaveLength(1);

    const statusMatches = logRaw.match(/"status":/g);
    expect(statusMatches).toHaveLength(1);

    const parsed = JSON.parse(logRaw);
    expect(parsed.method).toBe('POST');
    // Full req.originalUrl, NOT router-relative '/' or '/logout'
    expect(parsed.path).toBe('/api/v1/auth/logout');
    // Final response status, NOT premature 200
    expect(parsed.status).toBe(200);
    expect(parsed.msg).toMatch(/^POST \/api\/v1\/auth\/logout 200 \d+ms$/);
    expect(parsed.requestId).toBeDefined();

    // Query string tokens, bodies, and headers MUST NEVER appear
    expect(logRaw).not.toContain('sensitive-query-token-12345');
    expect(logRaw).not.toContain('"headers":');
    expect(logRaw).not.toContain('"body":');

    // 2. Health-check and OpenAPI static/docs routes stay at debug and do NOT emit info logs
    await request(testApp).get('/health');
    await request(testApp).get('/api/v1/docs/openapi.json');

    // Count remains 1 — /health and /api/v1/docs were not logged at info
    expect(logLines.length).toBe(1);
  });
});
