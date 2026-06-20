// apps/web/hooks/queries.ts
'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/** Step 5 trigger: submit activation, returns requestId. */
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
