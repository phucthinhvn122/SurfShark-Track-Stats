// apps/api/test/env.config.spec.ts
import { loadEnv, resetEnvCache } from '../src/config/env.config';

const originalEnv = process.env;

const validEnv = {
  NODE_ENV: 'production',
  PORT: '3001',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/app',
  DIRECT_URL: 'postgresql://user:password@localhost:5432/app',
  REDIS_URL: 'rediss://default:password@example.com:6379',
  JWT_SECRET: 'x'.repeat(32),
  SESSION_ENC_KEY: 'y'.repeat(32),
  WEB_ORIGIN: 'https://surfshark-activate.vercel.app',
};

describe('loadEnv', () => {
  beforeEach(() => {
    jest.resetModules();
    resetEnvCache();
    process.env = { ...originalEnv, ...validEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnvCache();
  });

  it('accepts a comma-separated WEB_ORIGIN allowlist', () => {
    process.env.WEB_ORIGIN = 'https://surfshark-activate.vercel.app, http://localhost:3000';

    expect(loadEnv().WEB_ORIGIN).toBe('https://surfshark-activate.vercel.app, http://localhost:3000');
  });

  it('rejects invalid URLs inside WEB_ORIGIN', () => {
    process.env.WEB_ORIGIN = 'https://surfshark-activate.vercel.app,not-a-url';

    expect(() => loadEnv()).toThrow(/Invalid URL in WEB_ORIGIN: not-a-url/);
  });
});
