// apps/web/app/admin/users/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminUsers } from '../../../hooks/queries';
import { Pagination } from '../../../components/Pagination';

const LIMIT = 20;

export default function Users() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = sessionStorage.getItem('admin_token');
    if (!t) return router.push('/admin/login');
    setToken(t);
  }, [router]);

  const { data, isLoading, error } = useAdminUsers(token, { page, limit: LIMIT });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <main className="page-shell">
      <div>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Login history</h1>
        <p className="mt-2 text-sm leading-6 text-muted">Recent device and license activation records.</p>
      </div>

      {error && (
        <div className="mt-5 rounded-lg border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
          {error instanceof Error ? error.message : 'Failed to load login history'}
        </div>
      )}

      <div className="glass mt-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-white/[.03]">
              <tr className="text-xs uppercase tracking-wide text-muted">
                {['Kind', 'Device / License', 'Activated', 'IP', 'Country', 'Device (UA)'].map((h) => (
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
                rows.map((r, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="p-4">
                      <KindBadge kind={r.kind} />
                    </td>
                    <td className="p-4 font-mono text-cyan-200">{r.kind === 'device' ? r.deviceCode : r.licenseKey}</td>
                    <td className="p-4">{fmt(r.activatedAt)}</td>
                    <td className="p-4">{r.ip ?? '-'}</td>
                    <td className="p-4">{r.country ?? '-'}</td>
                    <td className="max-w-[260px] truncate p-4" title={r.device ?? ''}>
                      {r.device ?? '-'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-sm text-muted">
                    No logins yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination page={page} limit={LIMIT} total={total} onPageChange={setPage} />
    </main>
  );
}

function KindBadge({ kind }: { kind?: string }) {
  const tone = kind === 'device' ? 'border-cyan-300/25 bg-cyan-300/10 text-cyan-200' : 'border-amber-300/25 bg-amber-300/10 text-amber-200';
  return <span className={`status-badge ${tone}`}>{kind ?? 'unknown'}</span>;
}

function LoadingRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={index} className="border-t border-white/5">
          {Array.from({ length: 6 }).map((__, cell) => (
            <td key={cell} className="p-4">
              <div className="skeleton h-4 w-full max-w-[150px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function fmt(iso?: string) {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
}
