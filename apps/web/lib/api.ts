// apps/web/lib/api.ts
import type { StatusResponse } from '@surfshark/shared';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const json = await res.json();
  if (!res.ok || json.success === false) {
    const err = json?.error ?? { code: 'ERR_INTERNAL', message: 'Request failed' };
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  return json.data as T;
}

export const api = {
  login: (deviceCode: string) =>
    req<{ requestId: string; state: 'processing' }>('/login', {
      method: 'POST',
      body: JSON.stringify({ deviceCode }),
    }),
  // legacy: license-key activation (kept for backward compatibility)
  activate: (username: string, license: string) =>
    req<{ requestId: string; state: 'processing' }>('/activate', {
      method: 'POST',
      body: JSON.stringify({ username, license }),
    }),
  status: (requestId: string) => req<StatusResponse>(`/status/${requestId}`),
  adminLogin: (username: string, password: string) =>
    req<{ accessToken: string; expiresIn: number }>('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  // authed admin helpers
  authed: (token: string) => {
    const auth = { Authorization: `Bearer ${token}` };
    return {
      dashboard: () => req<any>('/admin/dashboard', { headers: auth }),
      keys: (q = '') => req<any>(`/admin/keys${q}`, { headers: auth }),
      users: (q = '') => req<any>(`/admin/users${q}`, { headers: auth }),
      logs: (type: string) => req<any>(`/admin/logs?type=${type}`, { headers: auth }),
      getSettings: () => req<any>('/admin/settings', { headers: auth }),
      updateSettings: (patch: Record<string, unknown>) =>
        req<any>('/admin/settings', { method: 'PATCH', headers: auth, body: JSON.stringify(patch) }),
      bulkCreate: (count: number) =>
        req<any>('/admin/keys/bulk-create', { method: 'POST', headers: auth, body: JSON.stringify({ count }) }),
      keyAction: (action: 'ban' | 'unban' | 'extend', licenseKey: string) =>
        req<any>(`/admin/keys/${action}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ licenseKey }) }),
      remove: (licenseKey: string) =>
        req<any>('/admin/keys/delete', { method: 'DELETE', headers: auth, body: JSON.stringify({ licenseKey }) }),
      exportCsvUrl: `${BASE}/admin/keys/export`,
    };
  },
};
