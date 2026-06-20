// apps/web/app/admin/login/page.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';

export default function AdminLogin() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      const { accessToken } = await api.adminLogin(String(form.get('username')), String(form.get('password')));
      sessionStorage.setItem('admin_token', accessToken);
      router.push('/admin/dashboard');
    } catch (err: any) {
      setError(err.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-md mx-auto px-6 py-20">
      <div className="glass p-8">
        <h2 className="text-2xl font-extrabold">Admin sign in</h2>
        <p className="text-muted text-sm mt-1">Restricted access. All actions are audit-logged.</p>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <input name="username" placeholder="admin" className="field-input" autoComplete="off" />
          <input name="password" type="password" placeholder="••••••••" className="field-input" />
          {error && <div className="text-red-400 text-sm">{error}</div>}
          <button disabled={loading} className="btn-primary w-full">{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </main>
  );
}
