// apps/web/app/admin/dashboard/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';

export default function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const token = sessionStorage.getItem('admin_token');
    if (!token) return router.push('/admin/login');
    api.authed(token).dashboard().then(setData).catch(() => router.push('/admin/login'));
  }, [router]);

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
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {loginCards.map(([label, val]) => (
          <div key={label as string} className="glass p-4">
            <div className="text-xs text-muted">{label}</div>
            <div className="text-2xl font-extrabold mt-1">{val}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
