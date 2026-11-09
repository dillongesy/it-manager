// Unit tests import config/index.js, which insists on the required secrets.
// Provide throwaway values so the suite runs without any .env file.
process.env.DB_PASSWORD ??= 'test';
process.env.ACCESS_TOKEN_SECRET ??= 'test-access';
process.env.REFRESH_TOKEN_SECRET ??= 'test-refresh';
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
