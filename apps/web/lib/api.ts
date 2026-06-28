// apps/web/lib/api.ts
import type { StatusResponse } from '@surfshark/shared';

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').trim().replace(/\/+$/, '');

/** Error thrown for network/CORS failures so callers can distinguish them
 *  from API-side errors and surface a useful message. */
export class ApiUnreachableError extends Error {
  readonly cause?: unknown;
  readonly url: string;
  constructor(message: string, url: string, cause?: unknown) {
    super(message);
    this.name = 'ApiUnreachableError';
    this.url = url;
    this.cause = cause;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (e) {
    // fetch() rejects on DNS, connection refused, mixed-content, or CORS block.
    // The browser hides the real reason; surface something actionable.
    // eslint-disable-next-line no-console
    console.error(`[api] network error hitting ${url}`, e);
    throw new ApiUnreachableError(
      `Cannot reach API at ${BASE}. Check your network, or contact the admin if the service is down.`,
      url,
      e,
    );
  }

  let json: any;
  try {
    json = await res.json();
  } catch (e) {
    // Non-JSON response (e.g. HTML 502 from a proxy). Treat as unreachable so
    // the user sees a clear message instead of a raw parse error.
    // eslint-disable-next-line no-console
    console.error(`[api] non-JSON response from ${url} (status ${res.status})`, e);
    throw new ApiUnreachableError(
      `API at ${BASE} returned a non-JSON response (HTTP ${res.status}). The service may be down.`,
      url,
      e,
    );
  }

  if (!res.ok || json.success === false) {
    const err = json?.error ?? { code: 'ERR_INTERNAL', message: 'Request failed' };
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  return json.data as T;
}

export const api = {
  login: (deviceCode: string, license: string) =>
    req<{ requestId: string; state: 'processing' }>('/login', {
      method: 'POST',
      body: JSON.stringify({ deviceCode, license }),
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
      bulkCreate: (count: number, durationDays = 30) =>
        req<any>('/admin/keys/bulk-create', { method: 'POST', headers: auth, body: JSON.stringify({ count, durationDays }) }),
      keyAction: (action: 'ban' | 'unban' | 'extend', licenseKey: string) =>
        req<any>(`/admin/keys/${action}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ licenseKey }) }),
      remove: (licenseKey: string) =>
        req<any>('/admin/keys/delete', { method: 'DELETE', headers: auth, body: JSON.stringify({ licenseKey }) }),
      exportCsvUrl: `${BASE}/admin/keys/export`,
    };
  },
};
