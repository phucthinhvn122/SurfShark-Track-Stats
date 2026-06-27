// apps/web/app/admin/users/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';

export default function Users() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    const t = sessionStorage.getItem('admin_token');
    if (!t) return router.push('/admin/login');
    api.authed(t).users().then((r) => setRows(r.rows)).catch(() => router.push('/admin/login'));
  }, [router]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-black mb-6">Login history</h1>
      <div className="glass overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-muted text-xs uppercase">
              {['Kind', 'Device / License', 'Activated', 'IP', 'Country', 'Device (UA)'].map((h) => (
                <th key={h} className="text-left p-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/5">
                <td className="p-4">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    r.kind === 'device' ? 'bg-secondary/20 text-secondary' : 'bg-amber-500/20 text-amber-300'
                  }`}>
                    {r.kind}
                  </span>
                </td>
                <td className="p-4 font-mono text-blue-300">
                  {r.kind === 'device' ? r.deviceCode : r.licenseKey}
                </td>
                <td className="p-4">{fmt(r.activatedAt)}</td>
                <td className="p-4">{r.ip ?? '—'}</td>
                <td className="p-4">{r.country ?? '—'}</td>
                <td className="p-4 truncate max-w-[200px]" title={r.device ?? ''}>{r.device ?? '—'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="p-8 text-center text-muted">No logins yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function fmt(iso?: string) {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
