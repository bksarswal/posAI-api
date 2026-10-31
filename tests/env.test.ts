import { describe, it, expect, afterEach } from 'vitest';
import {
  parseEnv,
  setEnvForTesting,
  resetEnvForTesting,
} from '../src/config/env.js';

describe('parseEnv', () => {
  const validConfig = {
    NODE_ENV: 'test',
    PORT: '8080',
    MONGODB_URI: 'mongodb://localhost:27017/posai-test',
    JWT_ACCESS_SECRET: 'a_very_long_valid_access_secret_32_chars_min',
    JWT_REFRESH_SECRET: 'a_very_long_valid_refresh_secret_32_chars_min',
    ACCESS_TOKEN_TTL_MINUTES: '15',
    REFRESH_TOKEN_TTL_DAYS: '7',
    CLIENT_URL: 'http://localhost:3000',
    BCRYPT_ROUNDS: '12',
    AUTO_VERIFY_EMAIL: 'false',
    TRUST_PROXY: '0',
    LOG_LEVEL: 'silent',
  };

  const validProdConfig = {
    ...validConfig,
    NODE_ENV: 'production',
    BCRYPT_ROUNDS: '12',
    EMAIL_PROVIDER: 'smtp',
    EMAIL_FROM: 'noreply@posai.app',
    SMTP_HOST: 'smtp.mailgun.org',
    SMTP_PORT: '587',
    SMTP_USER: 'postmaster@posai.app',
    SMTP_PASS: 'secret-smtp-password',
  };

  it('successfully parses valid environment variables and returns a frozen object', () => {
    const parsed = parseEnv(validConfig);
    expect(parsed.PORT).toBe(8080);
    expect(parsed.NODE_ENV).toBe('test');
    expect(parsed.MONGODB_URI).toBe('mongodb://localhost:27017/posai-test');
    expect(parsed.CLIENT_URL).toBe('http://localhost:3000');
    expect(parsed.BCRYPT_ROUNDS).toBe(12);
    expect(parsed.ACCESS_TOKEN_TTL_MINUTES).toBe(15);
    expect(parsed.REFRESH_TOKEN_TTL_DAYS).toBe(7);
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

  it('rejects JWT_ACCESS_SECRET starting with "change-me" in production', () => {
    const prodConfig = {
      ...validProdConfig,
      JWT_ACCESS_SECRET: 'change-me-to-a-very-long-secret-key-32-chars-long',
    };

    expect(() => parseEnv(prodConfig)).toThrowError(
      /JWT_ACCESS_SECRET: JWT_ACCESS_SECRET cannot start with "change-me" in production/,
    );
  });

  it('accepts valid JWT_ACCESS_SECRET in production that does not start with "change-me"', () => {
    const prodConfig = {
      ...validProdConfig,
      JWT_ACCESS_SECRET: 'secure_production_secret_key_at_least_32_chars_long',
    };

    const parsed = parseEnv(prodConfig);
    expect(parsed.JWT_ACCESS_SECRET).toBe(
      'secure_production_secret_key_at_least_32_chars_long',
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
      ...validProdConfig,
      BCRYPT_ROUNDS: '9',
    };

    expect(() => parseEnv(prodInvalidConfig)).toThrowError(
      /BCRYPT_ROUNDS: BCRYPT_ROUNDS must be at least 10 in production/,
    );
  });

  it('accepts BCRYPT_ROUNDS >= 10 in production', () => {
    const prodValidConfig = {
      ...validProdConfig,
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
      ...validProdConfig,
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

  describe('EMAIL_PROVIDER and SMTP configuration', () => {
    it('defaults EMAIL_PROVIDER to "log"', () => {
      const parsed = parseEnv(validConfig);
      expect(parsed.EMAIL_PROVIDER).toBe('log');
    });

    it('fails startup if NODE_ENV=production and EMAIL_PROVIDER="log"', () => {
      const prodLogConfig = {
        ...validConfig,
        NODE_ENV: 'production',
        BCRYPT_ROUNDS: '12',
        EMAIL_PROVIDER: 'log',
      };

      expect(() => parseEnv(prodLogConfig)).toThrowError(
        /EMAIL_PROVIDER: EMAIL_PROVIDER cannot be "log" in production/,
      );
    });

    it('requires all SMTP_* and EMAIL_FROM fields when EMAIL_PROVIDER="smtp"', () => {
      const smtpMissingAll = {
        ...validConfig,
        EMAIL_PROVIDER: 'smtp',
      };

      expect(() => parseEnv(smtpMissingAll)).toThrowError(
        /EMAIL_FROM: EMAIL_FROM is required when EMAIL_PROVIDER is smtp/,
      );
      expect(() => parseEnv(smtpMissingAll)).toThrowError(
        /SMTP_HOST: SMTP_HOST is required when EMAIL_PROVIDER is smtp/,
      );
      expect(() => parseEnv(smtpMissingAll)).toThrowError(
        /SMTP_PORT: SMTP_PORT is required when EMAIL_PROVIDER is smtp/,
      );
      expect(() => parseEnv(smtpMissingAll)).toThrowError(
        /SMTP_USER: SMTP_USER is required when EMAIL_PROVIDER is smtp/,
      );
      expect(() => parseEnv(smtpMissingAll)).toThrowError(
        /SMTP_PASS: SMTP_PASS is required when EMAIL_PROVIDER is smtp/,
      );
    });

    it('accepts valid SMTP configuration in production and development', () => {
      const validSmtp = {
        ...validConfig,
        NODE_ENV: 'production',
        BCRYPT_ROUNDS: '12',
        EMAIL_PROVIDER: 'smtp',
        EMAIL_FROM: 'noreply@posai.app',
        SMTP_HOST: 'smtp.mailgun.org',
        SMTP_PORT: '587',
        SMTP_USER: 'postmaster@posai.app',
        SMTP_PASS: 'secret-smtp-password',
      };

      const parsed = parseEnv(validSmtp);
      expect(parsed.EMAIL_PROVIDER).toBe('smtp');
      expect(parsed.EMAIL_FROM).toBe('noreply@posai.app');
      expect(parsed.SMTP_HOST).toBe('smtp.mailgun.org');
      expect(parsed.SMTP_PORT).toBe(587);
      expect(parsed.SMTP_USER).toBe('postmaster@posai.app');
      expect(parsed.SMTP_PASS).toBe('secret-smtp-password');
    });
  });

  describe('setEnvForTesting / resetEnvForTesting safety guard', () => {
    const originalNodeEnv = process.env['NODE_ENV'];

    afterEach(() => {
      process.env['NODE_ENV'] = originalNodeEnv;
    });

    it('throws if called when NODE_ENV is not test', () => {
      process.env['NODE_ENV'] = 'production';

      expect(() => setEnvForTesting({ PORT: 9999 })).toThrowError(
        /setEnvForTesting is only permitted when NODE_ENV === "test"/,
      );

      expect(() => resetEnvForTesting()).toThrowError(
        /resetEnvForTesting is only permitted when NODE_ENV === "test"/,
      );
    });

    it('works when NODE_ENV is test', () => {
      process.env['NODE_ENV'] = 'test';
      setEnvForTesting({ PORT: 9090 });
      resetEnvForTesting();
    });
  });
});
