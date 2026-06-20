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

  const cards = [
    ['Total keys', data.total], ['Active', data.active], ['Unused', data.unused],
    ['Expired', data.expired], ['Banned', data.banned], ['Total activations', data.totalActivations],
    ["Today's activations", data.todayActivations], ['Failed activations', data.failed],
  ];

  return (
    <main className="max-w-6xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-black mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {cards.map(([label, val]) => (
          <div key={label as string} className="glass p-5">
            <div className="text-sm text-muted">{label}</div>
            <div className="text-3xl font-extrabold mt-1">{val}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
