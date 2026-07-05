// apps/web/app/status/[requestId]/page.tsx
'use client';
import { use } from 'react';
import StatusView from '../../../components/auth/StatusView';

export default function StatusPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = use(params);
  return <StatusView requestId={requestId} />;
}
