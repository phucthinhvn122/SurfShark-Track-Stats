// apps/web/app/admin/logs/page.tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';

const TYPES = ['activation', 'telegram', 'system', 'error', 'security'];

export default function Logs() {
  const router = useRouter();
  const [type, setType] = useState('activation');
  const [rows, setRows] = useState<any[]>([]);

  const load = useCallback(async (t: string, ty: string) => {
    const r = await api.authed(t).logs(ty);
    setRows(r);
  }, []);

  useEffect(() => {
    const t = sessionStorage.getItem('admin_token');
    if (!t) return router.push('/admin/login');
    load(t, type).catch(() => router.push('/admin/login'));
  }, [router, type, load]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-black mb-6">Logs</h1>
      <div className="flex gap-2 flex-wrap mb-5">
        {TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`px-4 py-2 rounded-full text-sm capitalize border ${type === t ? 'bg-primary border-primary' : 'bg-white/5 border-white/10 text-muted'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="glass p-4 font-mono text-xs max-h-[560px] overflow-y-auto flex flex-col gap-1.5">
        {rows.map((l, i) => (
          <div key={i} className="flex gap-3 p-2 rounded bg-white/[.02]">
            <span className="text-muted shrink-0">{fmt(l.createdAt ?? l.ts)}</span>
            <span className="text-blue-300 break-all">{l.action ?? l.result ?? l.status ?? ''}</span>
            <span className="text-zinc-300 break-all">{l.response ?? l.request ?? l.target ?? l.username ?? l.license?.licenseKey ?? ''}</span>
          </div>
        ))}
        {!rows.length && <div className="text-muted text-center p-6">No logs</div>}
      </div>
    </div>
  );
}
function fmt(iso?: string) {
  return iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
}
