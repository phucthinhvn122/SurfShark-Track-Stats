// apps/web/app/admin/logs/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Radio } from 'lucide-react';
import { useAdminLogs } from '../../../hooks/queries';

const TYPES = ['activation', 'telegram', 'system', 'error', 'security'];

type LogRow = {
  createdAt?: string;
  ts?: string;
  action?: string;
  result?: string;
  status?: string;
  response?: string;
  request?: string;
  target?: string;
  username?: string;
  license?: {
    licenseKey?: string;
  };
};

export default function Logs() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [type, setType] = useState('activation');
  const [live, setLive] = useState(false);

  useEffect(() => {
    const t = sessionStorage.getItem('admin_token');
    if (!t) return router.push('/admin/login');
    setToken(t);
  }, [router]);

  const { data, isLoading, error } = useAdminLogs(token, type, { live });
  const rows = (data as LogRow[] | undefined) ?? [];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Logs</h1>
          <p className="mt-2 text-sm leading-6 text-muted">Filter activation, Telegram, system, error, and security events.</p>
        </div>
        <button
          onClick={() => setLive((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
            live ? 'border-emerald-300/30 bg-emerald-300/15 text-emerald-200' : 'border-white/10 bg-white/[.04] text-muted hover:text-white'
          }`}
        >
          <Radio size={14} className={live ? 'animate-pulse' : ''} />
          {live ? 'Live' : 'Paused'}
        </button>
      </div>

      <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
        {TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold capitalize transition ${
              type === t ? 'border-cyan-300/30 bg-cyan-300/15 text-cyan-100' : 'border-white/10 bg-white/[.04] text-muted hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-5 rounded-lg border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
          {error instanceof Error ? error.message : 'Failed to load logs'}
        </div>
      )}

      <div className="glass mt-5 max-h-[560px] overflow-y-auto p-3 font-mono text-xs">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="skeleton h-10 w-full" />
            ))}
          </div>
        ) : rows.length > 0 ? (
          <div className="space-y-2">
            {rows.map((log, index) => (
              <div key={index} className="grid gap-2 rounded-lg bg-white/[.03] p-3 sm:grid-cols-[132px_160px_1fr]">
                <span className="text-muted">{fmt(log.createdAt ?? log.ts)}</span>
                <span className="break-all text-cyan-200">{log.action ?? log.result ?? log.status ?? ''}</span>
                <span className="break-all text-zinc-300">{log.response ?? log.request ?? log.target ?? log.username ?? log.license?.licenseKey ?? ''}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/10 p-8 text-center font-sans text-sm text-muted">No logs.</div>
        )}
      </div>
    </main>
  );
}

function fmt(iso?: string) {
  return iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
}
