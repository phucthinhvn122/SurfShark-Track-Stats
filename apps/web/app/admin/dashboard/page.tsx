// apps/web/app/admin/dashboard/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiUnreachableError } from '../../../lib/api';

const DURATION_PRESETS = [
  { label: 'One time', days: 0 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '1y', days: 365 },
];

export default function Dashboard() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [createCount, setCreateCount] = useState(10);
  const [durationDays, setDurationDays] = useState(30);
  const [generatedKeys, setGeneratedKeys] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem('admin_token');
    if (!token) return router.push('/admin/login');
    setToken(token);
    api
      .authed(token)
      .dashboard()
      .then(setData)
      .catch((err: any) => {
        if (err instanceof ApiUnreachableError) {
          setError(err.message);
        } else if (err?.code === 'ERR_UNAUTHORIZED' || /token/i.test(err?.message ?? '')) {
          // Token rejected — bounce to login so the user can re-auth.
          router.push('/admin/login');
        } else {
          setError(err?.message ?? 'Failed to load dashboard');
        }
      });
  }, [router]);

  async function refreshDashboard(t = token) {
    if (!t) return;
    const next = await api.authed(t).dashboard();
    setData(next);
  }

  async function createKeys() {
    if (!token) return;
    setCreateError(null);
    setGeneratedKeys([]);
    setCreating(true);
    try {
      const count = Math.max(1, Math.min(1000, Math.trunc(createCount || 1)));
      const days = Math.max(0, Math.min(3650, Math.trunc(durationDays || 0)));
      const result = await api.authed(token).bulkCreate(count, days);
      setGeneratedKeys(result.keys ?? []);
      setCreateCount(count);
      setDurationDays(days);
      await refreshDashboard(token);
    } catch (err: any) {
      setCreateError(err?.message ?? 'Could not create keys');
    } finally {
      setCreating(false);
    }
  }

  async function copyGeneratedKeys() {
    if (generatedKeys.length === 0) return;
    await navigator.clipboard.writeText(generatedKeys.join('\n'));
  }

  if (error) {
    return (
      <main className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-black mb-4">Dashboard</h1>
        <div className="glass p-6 border border-red-500/30">
          <p className="text-red-400 font-semibold">Could not load dashboard</p>
          <p className="text-muted mt-2 text-sm break-words">{error}</p>
          <button
            onClick={() => {
              setError(null);
              setData(null);
              const token = sessionStorage.getItem('admin_token');
              if (token) api.authed(token).dashboard().then(setData).catch((e: any) => setError(e?.message ?? 'Failed'));
            }}
            className="btn-primary mt-4"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!data) return <main className="p-10 text-muted">Loading…</main>;

  const licenseCards = [
    ['Total keys', data.total], ['Active', data.active], ['Unused', data.unused],
    ['Expired', data.expired], ['Banned', data.banned],
  ];
  const loginCards = [
    ['Total logins', data.totalLogins],
    ["Today's logins", data.todayLogins],
    ['Failed logins', data.failedLogins],
  ];

  return (
    <main className="max-w-6xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-black mb-6">Dashboard</h1>

      <h2 className="text-sm uppercase tracking-widest text-muted mb-3">Licenses</h2>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        {licenseCards.map(([label, val]) => (
          <div key={label as string} className="glass p-4">
            <div className="text-xs text-muted">{label}</div>
            <div className="text-2xl font-extrabold mt-1">{val}</div>
          </div>
        ))}
      </div>

      <h2 className="text-sm uppercase tracking-widest text-muted mb-3">Device-code logins</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        {loginCards.map(([label, val]) => (
          <div key={label as string} className="glass p-4">
            <div className="text-xs text-muted">{label}</div>
            <div className="text-2xl font-extrabold mt-1">{val}</div>
          </div>
        ))}
      </div>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="glass p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-extrabold">Create keys</h2>
              <p className="text-muted text-sm mt-1">Generate license keys with a custom validity window.</p>
            </div>
            <button onClick={createKeys} disabled={creating} className="btn-primary px-5 py-2.5">
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 mt-5">
            <label className="flex flex-col gap-2">
              <span className="text-sm text-muted">Quantity</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={createCount}
                onChange={(e) => setCreateCount(Number(e.target.value))}
                className="field-input"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm text-muted">Custom days</span>
              <input
                type="number"
                min={0}
                max={3650}
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="field-input"
              />
            </label>
          </div>

          <div className="flex gap-2 flex-wrap mt-4">
            {DURATION_PRESETS.map((preset) => (
              <button
                key={preset.days}
                onClick={() => setDurationDays(preset.days)}
                className={`px-4 py-2 rounded-xl text-sm border ${
                  durationDays === preset.days
                    ? 'bg-primary border-primary text-white'
                    : 'bg-white/5 border-white/10 text-muted hover:text-white'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="mt-4 text-sm text-muted">
            Plan: <span className="text-white font-semibold">{planLabel(durationDays)}</span>
          </div>
          {createError && <div className="mt-4 text-red-400 text-sm">{createError}</div>}
        </div>

        <div className="glass p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-extrabold">Latest keys</h2>
            <button onClick={copyGeneratedKeys} disabled={generatedKeys.length === 0} className="btn-ghost px-4 py-2 text-sm">
              Copy
            </button>
          </div>
          {generatedKeys.length > 0 ? (
            <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-white/10 bg-black/20 p-3">
              {generatedKeys.map((key) => (
                <div key={key} className="font-mono text-sm text-blue-300 py-1">
                  {key}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-sm mt-4">Generated keys will appear here after creation.</p>
          )}
        </div>
      </section>
    </main>
  );
}

function planLabel(days: number) {
  if (days === 0) return 'One time';
  if (days === 1) return '1 day';
  if (days === 7) return '7 days';
  if (days === 30) return '30 days';
  if (days === 365) return '1 year';
  return `${days} days`;
}
