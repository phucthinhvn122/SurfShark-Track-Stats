// apps/web/app/admin/keys/page.tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';

const PLANS = [
  { label: 'One time', days: 0 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '1y', days: 365 },
];

export default function Keys() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [durationDays, setDurationDays] = useState(30);

  const load = useCallback(async (t: string) => {
    const q = `?status=${filter}&search=${encodeURIComponent(search)}`;
    const res = await api.authed(t).keys(q);
    setRows(res.rows);
  }, [filter, search]);

  useEffect(() => {
    const t = sessionStorage.getItem('admin_token');
    if (!t) return router.push('/admin/login');
    setToken(t);
    load(t);
  }, [router, load]);

  async function act(action: 'ban' | 'unban' | 'extend' | 'delete', key: string) {
    if (!token) return;
    if (action === 'delete') await api.authed(token).remove(key);
    else await api.authed(token).keyAction(action, key);
    load(token);
  }

  async function generate(count: number) {
    if (!token) return;
    await api.authed(token).bulkCreate(count, durationDays);
    load(token);
  }

  return (
    <main className="max-w-6xl mx-auto px-6 py-10">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <h1 className="text-3xl font-black">Key management</h1>
        <div className="flex gap-2 flex-wrap justify-end">
          <div className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
            {PLANS.map((p) => (
              <button
                key={p.days}
                onClick={() => setDurationDays(p.days)}
                className={`px-3 py-1.5 rounded-full text-xs ${durationDays === p.days ? 'bg-primary text-white' : 'text-muted hover:text-white'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {[10, 100, 1000].map((n) => (
            <button key={n} onClick={() => generate(n)} className="btn-ghost py-2 px-4 text-sm">+{n}</button>
          ))}
          <a
            href={token ? api.authed(token).exportCsvUrl : '#'}
            className="btn-ghost py-2 px-4 text-sm"
            onClick={(e) => {
              // attach auth via fetch download since <a> can't send headers
              e.preventDefault();
              if (!token) return;
              fetch(api.authed(token).exportCsvUrl, { headers: { Authorization: `Bearer ${token}` } })
                .then((r) => r.blob())
                .then((b) => {
                  const url = URL.createObjectURL(b);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'licenses.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                });
            }}
          >
            ⬇ Export CSV
          </a>
        </div>
      </div>

      <div className="flex gap-3 my-5 flex-wrap">
        <input
          placeholder="Search key or username…"
          className="field-input max-w-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {['all', 'unused', 'active', 'expired', 'banned'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-full text-sm border ${filter === f ? 'bg-primary border-primary' : 'bg-white/5 border-white/10 text-muted'}`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="glass overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-muted text-xs uppercase">
              {['Key', 'Plan', 'Username', 'Status', 'Expires', 'Actions'].map((h) => (
                <th key={h} className="text-left p-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.licenseKey} className="border-t border-white/5">
                <td className="p-4 font-mono text-blue-300">{r.licenseKey}</td>
                <td className="p-4">{planLabel(r.durationDays)}</td>
                <td className="p-4">{r.username ?? '—'}</td>
                <td className="p-4 capitalize">{r.status}</td>
                <td className="p-4">{r.expiredAt ? new Date(r.expiredAt).toLocaleDateString() : '—'}</td>
                <td className="p-4 flex gap-1">
                  {r.status === 'banned'
                    ? <button onClick={() => act('unban', r.licenseKey)} className="btn-ghost py-1 px-3 text-xs">Unban</button>
                    : <button onClick={() => act('ban', r.licenseKey)} className="btn-ghost py-1 px-3 text-xs">Ban</button>}
                  <button onClick={() => act('extend', r.licenseKey)} className="btn-ghost py-1 px-3 text-xs">+30d</button>
                  <button onClick={() => act('delete', r.licenseKey)} className="btn-ghost py-1 px-3 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function planLabel(days?: number) {
  if (days === 0) return 'One time';
  if (days === 7) return '7d';
  if (days === 30) return '30d';
  if (days === 365) return '1y';
  return days ? `${days}d` : '-';
}
