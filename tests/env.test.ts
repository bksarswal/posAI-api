import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/config/env.js';

describe('parseEnv', () => {
  const validConfig = {
    NODE_ENV: 'test',
    PORT: '8080',
    MONGODB_URI: 'mongodb://localhost:27017/posai-test',
    JWT_ACCESS_SECRET: 'a_very_long_valid_access_secret_32_chars_min',
    JWT_REFRESH_SECRET: 'a_very_long_valid_refresh_secret_32_chars_min',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    CLIENT_URL: 'http://localhost:3000',
    BCRYPT_ROUNDS: '12',
    AUTO_VERIFY_EMAIL: 'false',
    TRUST_PROXY: '0',
    LOG_LEVEL: 'silent',
  };

  it('successfully parses valid environment variables and returns a frozen object', () => {
    const parsed = parseEnv(validConfig);
    expect(parsed.PORT).toBe(8080);
    expect(parsed.NODE_ENV).toBe('test');
    expect(parsed.MONGODB_URI).toBe('mongodb://localhost:27017/posai-test');
    expect(parsed.CLIENT_URL).toBe('http://localhost:3000');
    expect(parsed.BCRYPT_ROUNDS).toBe(12);
    expect(parsed.AUTO_VERIFY_EMAIL).toBe(false);
    expect(parsed.TRUST_PROXY).toBe(0);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it('throws an error listing missing required variables', () => {
    const invalidConfig = { ...validConfig };
    delete (invalidConfig as Record<string, unknown>)['MONGODB_URI'];

    expect(() => parseEnv(invalidConfig)).toThrowError(
      /MONGODB_URI: Invalid input: expected string, received undefined/,
    );
  });

  it('throws an error when JWT secrets are shorter than 32 characters', () => {
    const invalidConfig = {
      ...validConfig,
      JWT_ACCESS_SECRET: 'short_secret',
    };

    expect(() => parseEnv(invalidConfig)).toThrowError(
      /JWT_ACCESS_SECRET: JWT_ACCESS_SECRET must be at least 32 characters/,
    );
  });

  it('throws an error when numeric fields have an invalid format', () => {
    const invalidConfig = {
      ...validConfig,
      BCRYPT_ROUNDS: 'not-a-number',
    };

    expect(() => parseEnv(invalidConfig)).toThrowError(/BCRYPT_ROUNDS:/);
  });

  it('fails startup if NODE_ENV=production and BCRYPT_ROUNDS < 10', () => {
    const prodInvalidConfig = {
      ...validConfig,
      NODE_ENV: 'production',
      BCRYPT_ROUNDS: '9',
    };

    expect(() => parseEnv(prodInvalidConfig)).toThrowError(
      /BCRYPT_ROUNDS: BCRYPT_ROUNDS must be at least 10 in production/,
    );
  });

  it('accepts BCRYPT_ROUNDS >= 10 in production', () => {
    const prodValidConfig = {
      ...validConfig,
      NODE_ENV: 'production',
      BCRYPT_ROUNDS: '10',
    };

    const parsed = parseEnv(prodValidConfig);
    expect(parsed.BCRYPT_ROUNDS).toBe(10);
  });

  it('parses AUTO_VERIFY_EMAIL stringbool correctly and defaults to false', () => {
    const withTrue = { ...validConfig, AUTO_VERIFY_EMAIL: 'true' };
    expect(parseEnv(withTrue).AUTO_VERIFY_EMAIL).toBe(true);

    const withFalse = { ...validConfig, AUTO_VERIFY_EMAIL: 'false' };
    expect(parseEnv(withFalse).AUTO_VERIFY_EMAIL).toBe(false);

    const withoutVar = { ...validConfig };
    delete (withoutVar as Record<string, unknown>)['AUTO_VERIFY_EMAIL'];
    expect(parseEnv(withoutVar).AUTO_VERIFY_EMAIL).toBe(false);
  });

  it('fails startup if NODE_ENV=production and AUTO_VERIFY_EMAIL=true', () => {
    const prodInvalidConfig = {
      ...validConfig,
      NODE_ENV: 'production',
      BCRYPT_ROUNDS: '12',
      AUTO_VERIFY_EMAIL: 'true',
    };

    expect(() => parseEnv(prodInvalidConfig)).toThrowError(
      /AUTO_VERIFY_EMAIL: AUTO_VERIFY_EMAIL cannot be true in production/,
    );
  });

  it('parses TRUST_PROXY integer and defaults to 0', () => {
    const withProxy = { ...validConfig, TRUST_PROXY: '2' };
    expect(parseEnv(withProxy).TRUST_PROXY).toBe(2);

    const withoutProxy = { ...validConfig };
    delete (withoutProxy as Record<string, unknown>)['TRUST_PROXY'];
    expect(parseEnv(withoutProxy).TRUST_PROXY).toBe(0);
  });
});
