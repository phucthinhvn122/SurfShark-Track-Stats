// apps/web/app/admin/keys/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Loader2, Plus, Search } from 'lucide-react';
import { api } from '../../../lib/api';
import { useAdminKeys, useBulkCreateKeys, useKeyAction, useRemoveKey } from '../../../hooks/queries';
import { useDebouncedValue } from '../../../hooks/use-debounced-value';
import { Pagination } from '../../../components/Pagination';

const PLANS = [
  { label: 'One time', days: 0 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '1y', days: 365 },
];

const FILTERS = ['all', 'unused', 'active', 'expired', 'banned'];
const LIMIT = 20;

export default function Keys() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [durationDays, setDurationDays] = useState(30);

  // Debounce the search box so typing doesn't refetch on every keystroke —
  // the input itself stays fully responsive, only the query is delayed.
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    const t = sessionStorage.getItem('admin_token');
    if (!t) return router.push('/admin/login');
    setToken(t);
  }, [router]);

  // Jump back to page 1 whenever filters change — staying on e.g. page 4 of
  // an "all" search after switching to "banned" would show an empty page.
  useEffect(() => {
    setPage(1);
  }, [filter, debouncedSearch]);

  const { data, isLoading, isFetching, error } = useAdminKeys(token, {
    status: filter,
    search: debouncedSearch,
    page,
    limit: LIMIT,
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const keyAction = useKeyAction(token);
  const removeKey = useRemoveKey(token);
  const bulkCreate = useBulkCreateKeys(token);
  const working = keyAction.isPending || removeKey.isPending || bulkCreate.isPending;

  function act(action: 'ban' | 'unban' | 'extend' | 'delete', key: string) {
    if (working) return;
    if (action === 'delete') removeKey.mutate(key);
    else keyAction.mutate({ action, licenseKey: key });
  }

  function generate(count: number) {
    if (working) return;
    bulkCreate.mutate({ count, durationDays }, { onSuccess: () => setPage(1) });
  }

  async function exportCsv(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (!token) return;
    const response = await fetch(api.authed(token).exportCsvUrl, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'licenses.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="page-shell">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Key management</h1>
          <p className="mt-2 text-sm leading-6 text-muted">Search, filter, generate, export, and manage license keys.</p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <div className="flex rounded-lg border border-white/10 bg-white/[.04] p-1">
            {PLANS.map((p) => (
              <button
                key={p.days}
                onClick={() => setDurationDays(p.days)}
                className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${
                  durationDays === p.days ? 'bg-cyan-300 text-zinc-950' : 'text-muted hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {[10, 100, 1000].map((n) => (
            <button key={n} onClick={() => generate(n)} disabled={working} className="btn-ghost px-3 py-2 text-sm">
              <Plus size={15} />
              {n}
            </button>
          ))}
          <a href={token ? api.authed(token).exportCsvUrl : '#'} className="btn-ghost px-3 py-2 text-sm" onClick={exportCsv}>
            <Download size={15} />
            Export CSV
          </a>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={17} />
          <input
            placeholder="Search key or username..."
            className="field-input pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold capitalize transition ${
                filter === f ? 'border-cyan-300/30 bg-cyan-300/15 text-cyan-100' : 'border-white/10 bg-white/[.04] text-muted hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-5 rounded-lg border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
          {error instanceof Error ? error.message : 'Failed to load keys'}
        </div>
      )}

      <div className="glass mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-white/[.03]">
              <tr className="text-xs uppercase tracking-wide text-muted">
                {['Key', 'Plan', 'Username', 'Status', 'Expires', 'Actions'].map((h) => (
                  <th key={h} className="p-4 text-left font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <LoadingRows />
              ) : rows.length > 0 ? (
                rows.map((r) => (
                  <tr key={r.licenseKey} className="border-t border-white/5">
                    <td className="p-4 font-mono text-cyan-200">{r.licenseKey}</td>
                    <td className="p-4">{planLabel(r.durationDays)}</td>
                    <td className="p-4">{r.username ?? '-'}</td>
                    <td className="p-4">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="p-4">{r.expiredAt ? new Date(r.expiredAt).toLocaleDateString() : '-'}</td>
                    <td className="p-4">
                      <div className="flex gap-1">
                        {r.status === 'banned' ? (
                          <button onClick={() => act('unban', r.licenseKey)} disabled={working} className="btn-ghost min-h-8 px-3 py-1 text-xs">
                            Unban
                          </button>
                        ) : (
                          <button onClick={() => act('ban', r.licenseKey)} disabled={working} className="btn-ghost min-h-8 px-3 py-1 text-xs">
                            Ban
                          </button>
                        )}
                        <button onClick={() => act('extend', r.licenseKey)} disabled={working} className="btn-ghost min-h-8 px-3 py-1 text-xs">
                          +30d
                        </button>
                        <button onClick={() => act('delete', r.licenseKey)} disabled={working} className="btn-ghost min-h-8 px-3 py-1 text-xs">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-sm text-muted">
                    No keys match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination page={page} limit={LIMIT} total={total} onPageChange={setPage} />
      {(working || isFetching) && (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="animate-spin text-cyan-300" size={16} />
          {working ? 'Updating keys...' : 'Refreshing...'}
        </div>
      )}
    </main>
  );
}

function LoadingRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={index} className="border-t border-white/5">
          {Array.from({ length: 6 }).map((__, cell) => (
            <td key={cell} className="p-4">
              <div className="skeleton h-4 w-full max-w-[140px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const tone =
    status === 'active'
      ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200'
      : status === 'expired'
        ? 'border-amber-300/25 bg-amber-300/10 text-amber-200'
        : status === 'banned'
          ? 'border-red-300/25 bg-red-300/10 text-red-200'
          : 'border-zinc-300/20 bg-white/[.04] text-zinc-300';
  return <span className={`status-badge ${tone}`}>{status ?? 'unknown'}</span>;
}

function planLabel(days?: number) {
  if (days === 0) return 'One time';
  if (days === 7) return '7d';
  if (days === 30) return '30d';
  if (days === 365) return '1y';
  return days ? `${days}d` : '-';
}
