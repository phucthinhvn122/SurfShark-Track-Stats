// apps/api/src/common/masking.util.ts
// Helpers to redact sensitive values in logs / API responses.
// Never log raw keys, sessions, or device codes.
export function maskKey(key: string | null | undefined, visible = 4): string {
  if (!key) return '<empty>';
  if (key.length <= visible * 2) return '*'.repeat(key.length);
  return `${key.slice(0, visible)}${'*'.repeat(Math.max(0, key.length - visible * 2))}${key.slice(-visible)}`;
}

export function maskDeviceCode(code: string | null | undefined): string {
  if (!code) return '<empty>';
  if (code.length <= 4) return '*'.repeat(code.length);
  return `${code.slice(0, 2)}${'*'.repeat(code.length - 4)}${code.slice(-2)}`;
}

export function maskSession(_session?: string | null | undefined): string {
  return '<redacted>';
}
