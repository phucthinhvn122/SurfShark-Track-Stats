// packages/shared/src/index.ts
// Shared Zod schemas + types — imported by web, api, and worker.
import { z } from 'zod';

export const LICENSE_REGEX = /^VPN-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export const activateSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers and underscore'),
  license: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(LICENSE_REGEX, 'Invalid format. Use VPN-XXXX-XXXX')),
});
export type ActivateInput = z.infer<typeof activateSchema>;

export const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const bulkCreateSchema = z.object({
  count: z.number().int().min(1).max(1000),
  notes: z.string().max(200).optional(),
});

export const keyActionSchema = z.object({
  licenseKey: z.string().regex(LICENSE_REGEX),
  days: z.number().int().min(1).max(3650).optional(),
});

export const settingsUpdateSchema = z
  .object({
    telegramSession: z.string().min(1).max(8000).optional(),
    botUsername: z.string().min(1).max(64).optional(),
    durationDays: z.number().int().min(1).max(3650).optional(),
    rateLimitPerMin: z.number().int().min(1).max(1000).optional(),
  })
  .strict(); // reject unknown fields — prevents arbitrary column writes

export type ActivationState = 'processing' | 'success' | 'failed';

export interface StatusResponse {
  state: ActivationState;
  username?: string;
  license?: string;
  activatedAt?: string;
  expiredAt?: string;
  remainingDays?: number;
  error?: { code: string; message: string };
}

// Uniform API error codes
export const ErrorCode = {
  VALIDATION: 'ERR_VALIDATION',
  KEY_NOT_FOUND: 'ERR_KEY_NOT_FOUND',
  KEY_BANNED: 'ERR_KEY_BANNED',
  KEY_EXPIRED: 'ERR_KEY_EXPIRED',
  KEY_IN_USE: 'ERR_KEY_IN_USE',
  RATE_LIMITED: 'ERR_RATE_LIMITED',
  UNAUTHORIZED: 'ERR_UNAUTHORIZED',
  INTERNAL: 'ERR_INTERNAL',
} as const;
