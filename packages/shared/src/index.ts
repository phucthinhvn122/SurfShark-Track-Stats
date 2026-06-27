// packages/shared/src/index.ts
// Shared Zod schemas + types — imported by web, api, and worker.
import { z } from 'zod';

export const LICENSE_REGEX = /^VPN-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
export const DEVICE_CODE_REGEX = /^[A-Z0-9]{6}$/;
export const KEY_DURATION_DAYS = [0, 7, 30, 365] as const;
export type KeyDurationDays = (typeof KEY_DURATION_DAYS)[number];
export const keyDurationSchema = z.union([z.literal(0), z.literal(7), z.literal(30), z.literal(365)]);

/** Legacy license-key activation (kept for admin-side license management). */
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

/** Public /login endpoint — 6-character device code (A–Z, 0–9). */
export const deviceLoginSchema = z.object({
  deviceCode: z
    .string()
    .trim()
    .min(6)
    .max(6)
    .transform((s) => s.toUpperCase())
    .pipe(
      z.string().regex(DEVICE_CODE_REGEX, 'Device code must be 6 uppercase letters/digits'),
    ),
  license: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(LICENSE_REGEX, 'Invalid format. Use VPN-XXXX-XXXX')),
});
export type DeviceLoginInput = z.infer<typeof deviceLoginSchema>;

export const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const bulkCreateSchema = z.object({
  count: z.number().int().min(1).max(1000),
  durationDays: keyDurationSchema.default(30),
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
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

export type ActivationState = 'processing' | 'success' | 'failed';

export interface StatusResponse {
  state: ActivationState;
  deviceCode?: string;
  licenseKey?: string;
  durationDays?: number;
  activatedAt?: string;
  expiredAt?: string;
  error?: { code: string; message: string };
}

// Uniform API error codes
export const ErrorCode = {
  VALIDATION: 'ERR_VALIDATION',
  KEY_NOT_FOUND: 'ERR_KEY_NOT_FOUND',
  KEY_BANNED: 'ERR_KEY_BANNED',
  KEY_EXPIRED: 'ERR_KEY_EXPIRED',
  KEY_IN_USE: 'ERR_KEY_IN_USE',
  KEY_OUT_OF_USES: 'ERR_KEY_OUT_OF_USES',
  DEVICE_CODE_UNAVAILABLE: 'ERR_DEVICE_CODE_UNAVAILABLE',
  TELEGRAM_UNAVAILABLE: 'ERR_TELEGRAM_UNAVAILABLE',
  TELEGRAM_RATE_LIMITED: 'ERR_TELEGRAM_RATE_LIMITED',
  RATE_LIMITED: 'ERR_RATE_LIMITED',
  UNAUTHORIZED: 'ERR_UNAUTHORIZED',
  INTERNAL: 'ERR_INTERNAL',
} as const;

/** Input for POST /key-redeem — the user only enters a key. */
export const redeemKeySchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Key is required')
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(LICENSE_REGEX, 'Invalid format. Use VPN-XXXX-XXXX')),
});
export type RedeemKeyInput = z.infer<typeof redeemKeySchema>;

/** Result returned to the user. */
export type RedeemResultCode =
  | 'success'
  | 'invalid_key'
  | 'key_banned'
  | 'key_expired'
  | 'key_in_use'
  | 'key_out_of_uses'
  | 'device_code_unavailable'
  | 'telegram_unavailable'
  | 'telegram_timeout'
  | 'telegram_rate_limited'
  | 'bot_rejected'
  | 'internal_error';

export interface RedeemResult {
  success: boolean;
  code: RedeemResultCode;
  message: string;
  deviceCode?: string;   // masked unless caller is admin
  botReply?: string;
  durationDays?: number;
  expiredAt?: string;
}
