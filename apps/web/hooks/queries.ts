// apps/web/hooks/queries.ts
'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

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

/** Step 7: poll status until terminal (success | failed). */
export function useStatus(requestId: string | null) {
  return useQuery({
    queryKey: ['status', requestId],
    queryFn: () => api.status(requestId!),
    enabled: !!requestId,
    refetchInterval: (q) => {
      const s = q.state.data?.state;
      return s === 'success' || s === 'failed' ? false : 1500; // poll every 1.5s
    },
  });
}
