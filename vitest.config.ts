import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    env: {
      NODE_ENV: 'test',
      PORT: '8080',
      MONGODB_URI: 'mongodb://localhost:27017/posai-test',
      JWT_ACCESS_SECRET: 'test_jwt_access_secret_at_least_32_characters_long',
      JWT_REFRESH_SECRET: 'test_jwt_refresh_secret_at_least_32_characters_long',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      CLIENT_URL: 'http://localhost:3000',
      BCRYPT_SALT_ROUNDS: '10',
      LOG_LEVEL: 'silent',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'coverage/**',
        'tests/**',
        'eslint.config.js',
        'vitest.config.ts',
      ],
    },
  },
});
