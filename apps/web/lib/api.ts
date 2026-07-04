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

export interface StatusStreamHandle {
  /** Stop the SSE subscription and close the connection. */
  close: () => void;
}

/**
 * Subscribe to the SSE status stream for instant updates. Falls back to a
 * 1s polling loop if EventSource is unavailable or the connection errors.
 * The returned handle's `close()` stops the stream.
 */
export function statusStream(
  requestId: string,
  callbacks: {
    onStatus: (status: StatusResponse) => void;
    onError?: (e: Event | Error) => void;
  },
): StatusStreamHandle {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return pollFallback(requestId, callbacks);
  }
  const url = `${BASE}/status/${encodeURIComponent(requestId)}/stream`;
  let es: EventSource | null = null;
  let closed = false;

  try {
    es = new EventSource(url, { withCredentials: false });
  } catch (e) {
    return pollFallback(requestId, callbacks);
  }

  es.addEventListener('status', (e: MessageEvent) => {
    try {
      const status = JSON.parse(e.data) as StatusResponse;
      callbacks.onStatus(status);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[api] failed to parse SSE status payload', err);
    }
  });
  es.addEventListener('error', (e) => {
    callbacks.onError?.(e);
    if (closed) return;
    // The browser auto-reconnects EventSource on transient errors, so we
    // only fall back to polling when the stream stays broken for a while.
    // For now, just leave the EventSource open; if it dies permanently the
    // refetchInterval in useStatus() will keep the UI moving.
  });

  return {
    close: () => {
      closed = true;
      try { es?.close(); } catch { /* noop */ }
    },
  };
}

function pollFallback(
  requestId: string,
  callbacks: {
    onStatus: (status: StatusResponse) => void;
    onError?: (e: Event | Error) => void;
  },
): StatusStreamHandle {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const s = await api.status(requestId);
      callbacks.onStatus(s);
    } catch (e) {
      callbacks.onError?.(e as Error);
    }
  };
  const id = setInterval(tick, 1000);
  void tick(); // fire one immediately
  return { close: () => { stopped = true; clearInterval(id); } };
}

export const api = {
  login: (deviceCode: string, license: string) =>
    req<{ requestId: string; state: 'pending' | 'processing' }>('/login', {
      method: 'POST',
      body: JSON.stringify({ deviceCode, license }),
    }),
  // legacy: license-key activation (kept for backward compatibility)
  activate: (username: string, license: string) =>
    req<{ requestId: string; state: 'pending' | 'processing' }>('/activate', {
      method: 'POST',
      body: JSON.stringify({ username, license }),
    }),
  status: (requestId: string) => req<StatusResponse>(`/status/${requestId}`),
  statusStream,
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
