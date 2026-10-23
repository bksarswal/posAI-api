// Ensure required environment variables exist for tests without requiring a .env file
process.env.NODE_ENV = 'test';
process.env.PORT = '8080';
process.env.MONGODB_URI = 'mongodb://localhost:27017/posai-test';
process.env.JWT_ACCESS_SECRET =
  'test_jwt_access_secret_at_least_32_characters_long';
process.env.JWT_REFRESH_SECRET =
  'test_jwt_refresh_secret_at_least_32_characters_long';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.BCRYPT_SALT_ROUNDS = '10';
process.env.LOG_LEVEL = 'silent';
