// apps/web/app/admin/login/page.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { api, ApiUnreachableError } from '../../../lib/api';

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
    } catch (err: unknown) {
      if (err instanceof ApiUnreachableError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Login failed');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-5xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center">
      <section>
        <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-sm font-semibold text-cyan-200">
          <ShieldCheck size={16} />
          Admin access
        </span>
        <h1 className="mt-5 text-3xl font-black leading-tight sm:text-5xl">Manage keys, users, and activation logs.</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted">
          Restricted dashboard for license operations. Authentication and audit behavior are handled by the existing API.
        </p>
      </section>

      <section className="glass p-5 sm:p-6">
        <h2 className="text-xl font-extrabold">Admin sign in</h2>
        <p className="mt-1 text-sm leading-6 text-muted">All actions are audit-logged.</p>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-zinc-200">Username</span>
            <input name="username" placeholder="admin" className="field-input" autoComplete="username" disabled={loading} />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-zinc-200">Password</span>
            <input name="password" type="password" placeholder="Password" className="field-input" autoComplete="current-password" disabled={loading} />
          </label>
          {error && (
            <div className="flex gap-2 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
              <AlertCircle className="mt-0.5 shrink-0" size={16} />
              <span>{error}</span>
            </div>
          )}
          <button disabled={loading} className="btn-primary w-full">
            {loading ? (
              <>
                <Loader2 className="animate-spin" size={17} />
                Signing in
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>
      </section>
    </main>
  );
}
