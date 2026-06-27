// apps/api/src/config/env.config.ts
// Single source of truth for environment variables.
// Imported by main.ts and by any module that needs typed config.
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SESSION_ENC_KEY: z.string().min(32, 'SESSION_ENC_KEY must be at least 32 characters'),

  WEB_ORIGIN: z.string().url(),

  // Telegram user account (used by key-redeem's TelegramService and worker).
  TG_API_ID: z.coerce.number().int().positive().optional(),
  TG_API_HASH: z.string().min(1).optional(),
  TG_SESSION: z.string().min(1).optional(),
  BOT_USERNAME: z.string().min(1).default('@SurfsharkBot'),

  // Optional — where to fetch the device code from.
  SURFSHARK_DEVICE_CODE_FILE: z.string().optional(),
  SURFSHARK_DEVICE_CODE_URL: z.string().url().optional(),
  SURFSHARK_DEVICE_CODE_CLI: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests: reset the cache so updated process.env takes effect. */
export function resetEnvCache(): void {
  cached = null;
}
