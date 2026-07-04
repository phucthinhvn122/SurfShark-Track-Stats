// apps/web/hooks/queries.ts
'use client';
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
 */
export function useStatus(requestId: string | null) {
  return useQuery({
    queryKey: ['status', requestId],
    queryFn: () => api.status(requestId!),
    enabled: !!requestId,
    refetchInterval: (q) => {
      const s = q.state.data?.state;
      return s && TERMINAL.has(s) ? false : 1500;
    },
    staleTime: 0,
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
