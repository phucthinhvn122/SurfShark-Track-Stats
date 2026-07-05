// apps/web/hooks/queries.ts
'use client';
import { useEffect } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type StatusStreamHandle } from '../lib/api';

/** /login trigger: submit a 6-character device code, returns requestId. */
export function useLogin() {
  return useMutation({
    mutationFn: (v: { deviceCode: string; license: string }) => api.login(v.deviceCode, v.license),
  });
}

/** Legacy license-key activation (kept for backward compatibility). */
export function useActivate() {
  return useMutation({
    mutationFn: (v: { username: string; license: string }) => api.activate(v.username, v.license),
  });
}

/** Terminal states — once reached, the status is final and polling should stop. */
const TERMINAL = new Set(['success', 'failed', 'expired', 'invalid_code', 'telegram_unavailable', 'server_error', 'timeout', 'activation_expired']);

/**
 * Step 7: poll status until terminal (success | failed | ...).
 *
 * Falls back to 1.5s polling if SSE fails — preserves reliability.
 *
 * `opts.skipInitialFetch` keeps the first GET /status round-trip off the
 * critical path. The SSE server already pushes the current status on
 * connect, so the first render after SSE fires is correct without a
 * redundant client fetch. Saves ~100-300ms when the SSE is up. If the
 * SSE is broken, the first poll at 1.5s still fires (a broken stream
 * never leaves the user stuck on the loading screen — they just wait
 * one polling tick longer than they would with the initial fetch).
 */
export function useStatus(
  requestId: string | null,
  opts: { skipInitialFetch?: boolean } = {},
) {
  return useQuery({
    queryKey: ['status', requestId],
    queryFn: () => api.status(requestId!),
    enabled: !!requestId,
    refetchInterval: (q) => {
      const s = q.state.data?.state;
      return s && TERMINAL.has(s) ? false : 1500;
    },
    staleTime: 0,
    refetchOnMount: opts.skipInitialFetch ? false : 'always',
  });
}

/**
 * Subscribe to the SSE stream for instant status updates. Side effect: opens
 * a connection on mount, closes on unmount. Status updates are written to the
 * React Query cache as they arrive, so components using useStatus() re-render
 * immediately (no 1.5s polling lag).
 */
export function useStatusStream(
  requestId: string | null,
  onTerminal?: (state: string) => void,
): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!requestId) return;
    const handle = api.statusStream(requestId, {
      onStatus: (status) => {
        qc.setQueryData(['status', requestId], status);
        if (TERMINAL.has(status.state)) onTerminal?.(status.state);
      },
      onError: () => {
        // SSE failed — the polling query will keep the UI moving.
      },
    });
    return () => handle?.close();
  }, [requestId, qc, onTerminal]);
}

/** Paginated key list. `placeholderData: keepPreviousData` keeps the old
 *  page's rows on screen while the next page loads, instead of flashing
 *  a skeleton on every filter/page change. */
export function useAdminKeys(
  token: string | null,
  params: { status: string; search: string; page: number; limit: number },
) {
  return useQuery({
    queryKey: ['admin', 'keys', params],
    queryFn: () => api.authed(token!).keys(params),
    enabled: !!token,
    placeholderData: keepPreviousData,
  });
}

export function useAdminUsers(token: string | null, params: { page: number; limit: number }) {
  return useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => api.authed(token!).users(params),
    enabled: !!token,
    placeholderData: keepPreviousData,
  });
}

/** The backend caps logs at 200 rows with no pagination, so this just
 *  supports an optional toggleable poll ("Live") on top of manual refetch. */
export function useAdminLogs(token: string | null, type: string, opts?: { live?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'logs', type],
    queryFn: () => api.authed(token!).logs(type),
    enabled: !!token,
    placeholderData: keepPreviousData,
    refetchInterval: opts?.live ? 5000 : false,
  });
}

export function useKeyAction(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { action: 'ban' | 'unban' | 'extend'; licenseKey: string }) =>
      api.authed(token!).keyAction(v.action, v.licenseKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'keys'] }),
  });
}

export function useRemoveKey(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (licenseKey: string) => api.authed(token!).remove(licenseKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'keys'] }),
  });
}

export function useBulkCreateKeys(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { count: number; durationDays: number }) => api.authed(token!).bulkCreate(v.count, v.durationDays),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'keys'] }),
  });
}
