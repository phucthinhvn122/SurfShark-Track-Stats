// apps/api/src/common/crypto.util.ts
// AES-256-GCM helpers for encrypting secrets at rest (e.g. Telegram session).
// Single source of truth — used by both the API and the worker (when needed).
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const SALT = 'surfshark-salt';

function deriveKey(): Buffer {
  const secret = process.env.SESSION_ENC_KEY;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_ENC_KEY is missing or shorter than 32 characters');
  }
  return scryptSync(secret, SALT, KEY_LEN);
}

export function encryptString(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

export function decryptString(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Encrypted payload must be iv:tag:data');
  }
  const [ivH, tagH, dataH] = parts;
  const decipher = createDecipheriv(ALGO, deriveKey(), Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataH, 'hex')), decipher.final()]).toString('utf8');
}

/** Returns the input unchanged if it doesn't look encrypted (legacy/plain sessions). */
export function decryptIfEncrypted(value: string | null | undefined): string {
  if (!value) return '';
  return value.split(':').length === 3 ? decryptString(value) : value;
}
