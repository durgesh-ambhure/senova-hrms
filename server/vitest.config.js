import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/globalSetup.js'],
    setupFiles: ['./test/setup.js'],
    include: ['src/**/*.test.js', 'test/**/*.test.js'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      SESSION_SECRET: 'test-session-secret-that-is-long-enough-123',
      CLIENT_ORIGINS: 'http://localhost:5173',
      AUTH_RATE_LIMIT: '1000',
      DATA_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      UPLOAD_DIR: '.data/test-uploads',
      APP_URL: 'http://localhost:5173',
      MONGODB_URI: 'mongodb://placeholder-set-by-global-setup',
    },
  },
});
