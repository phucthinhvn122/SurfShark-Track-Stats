// apps/web/app/admin/dashboard/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Copy, Loader2, Plus } from 'lucide-react';
import { api, ApiUnreachableError } from '../../../lib/api';

const DURATION_PRESETS = [
  { label: 'One time', days: 0 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '1y', days: 365 },
];

type DashboardData = {
  total?: number;
  active?: number;
  unused?: number;
  expired?: number;
  banned?: number;
  totalLogins?: number;
  todayLogins?: number;
  failedLogins?: number;
};

type BulkCreateResult = {
  keys?: string[];
};

export default function Dashboard() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
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
      .catch((err: unknown) => {
        if (err instanceof ApiUnreachableError) {
          setError(err.message);
        } else if (isUnauthorized(err)) {
          router.push('/admin/login');
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard');
        }
      });
  }, [router]);

  async function refreshDashboard(t = token) {
    if (!t) return;
    const next = await api.authed(t).dashboard();
    setData(next);
  }

  async function retryLoad() {
    setError(null);
    setData(null);
    const token = sessionStorage.getItem('admin_token');
    if (!token) return router.push('/admin/login');
    try {
      setData(await api.authed(token).dashboard());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function createKeys() {
    if (!token) return;
    setCreateError(null);
    setGeneratedKeys([]);
    setCreating(true);
    try {
      const count = Math.max(1, Math.min(1000, Math.trunc(createCount || 1)));
      const days = Math.max(0, Math.min(3650, Math.trunc(durationDays || 0)));
      const result = (await api.authed(token).bulkCreate(count, days)) as BulkCreateResult;
      setGeneratedKeys(result.keys ?? []);
      setCreateCount(count);
      setDurationDays(days);
      await refreshDashboard(token);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Could not create keys');
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
      <main className="page-shell">
        <PageHeader title="Dashboard" description="Overview of license and activation activity." />
        <div className="glass mt-5 max-w-2xl border-red-400/20 p-5">
          <div className="flex gap-3">
            <AlertCircle className="shrink-0 text-red-300" size={22} />
            <div>
              <p className="font-semibold text-red-200">Could not load dashboard</p>
              <p className="mt-2 break-words text-sm leading-6 text-muted">{error}</p>
            </div>
          </div>
          <button onClick={retryLoad} className="btn-primary mt-5">
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="page-shell">
        <PageHeader title="Dashboard" description="Loading the latest activation metrics." />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="glass p-4">
              <div className="skeleton h-3 w-20" />
              <div className="skeleton mt-4 h-8 w-14" />
            </div>
          ))}
        </div>
      </main>
    );
  }

  const licenseCards = [
    ['Total keys', data.total],
    ['Active', data.active],
    ['Unused', data.unused],
    ['Expired', data.expired],
    ['Banned', data.banned],
  ];
  const loginCards = [
    ['Total logins', data.totalLogins],
    ["Today's logins", data.todayLogins],
    ['Failed logins', data.failedLogins],
  ];

  return (
    <main className="page-shell">
      <PageHeader title="Dashboard" description="Create keys and monitor license activity from one place." />

      <section className="mt-6">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted">Licenses</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {licenseCards.map(([label, val]) => (
            <MetricCard key={label as string} label={label as string} value={val} />
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted">Device-code logins</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {loginCards.map(([label, val]) => (
            <MetricCard key={label as string} label={label as string} value={val} />
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="glass p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-extrabold">Create keys</h2>
              <p className="mt-1 text-sm leading-6 text-muted">Generate license keys with the selected validity window.</p>
            </div>
            <button onClick={createKeys} disabled={creating} className="btn-primary sm:min-w-28">
              {creating ? (
                <>
                  <Loader2 className="animate-spin" size={17} />
                  Creating
                </>
              ) : (
                <>
                  <Plus size={17} />
                  Create
                </>
              )}
            </button>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-zinc-200">Quantity</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={createCount}
                onChange={(e) => setCreateCount(Number(e.target.value))}
                className="field-input"
                disabled={creating}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-zinc-200">Custom days</span>
              <input
                type="number"
                min={0}
                max={3650}
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="field-input"
                disabled={creating}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {DURATION_PRESETS.map((preset) => (
              <button
                key={preset.days}
                onClick={() => setDurationDays(preset.days)}
                disabled={creating}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  durationDays === preset.days
                    ? 'border-cyan-300/30 bg-cyan-300/15 text-cyan-100'
                    : 'border-white/10 bg-white/[.04] text-muted hover:text-white'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="mt-4 text-sm text-muted">
            Plan: <span className="font-semibold text-white">{planLabel(durationDays)}</span>
          </div>
          {createError && <div className="mt-4 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{createError}</div>}
        </div>

        <div className="glass p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold">Latest keys</h2>
              <p className="mt-1 text-sm text-muted">{generatedKeys.length ? `${generatedKeys.length} generated` : 'Waiting for creation'}</p>
            </div>
            <button onClick={copyGeneratedKeys} disabled={generatedKeys.length === 0} className="btn-ghost px-3">
              <Copy size={16} />
              Copy
            </button>
          </div>
          {generatedKeys.length > 0 ? (
            <div className="mt-4 max-h-72 overflow-auto rounded-lg border border-white/10 bg-black/20 p-3">
              {generatedKeys.map((key) => (
                <div key={key} className="border-b border-white/5 py-2 font-mono text-sm text-cyan-200 last:border-b-0">
                  {key}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-white/10 p-5 text-sm leading-6 text-muted">
              Generated keys will appear here after creation.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="glass p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-2xl font-extrabold text-white">{String(value ?? 0)}</div>
    </div>
  );
}

function isUnauthorized(err: unknown) {
  const maybe = err as { code?: string; message?: string };
  return maybe?.code === 'ERR_UNAUTHORIZED' || /token/i.test(maybe?.message ?? '');
}

function planLabel(days: number) {
  if (days === 0) return 'One time';
  if (days === 1) return '1 day';
  if (days === 7) return '7 days';
  if (days === 30) return '30 days';
  if (days === 365) return '1 year';
  return `${days} days`;
}
