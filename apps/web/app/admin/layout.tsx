// apps/web/app/admin/layout.tsx
'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { KeyRound, LayoutDashboard, LogOut, ScrollText, Settings, ShieldCheck, Users } from 'lucide-react';

const NAV = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/keys', label: 'Keys', icon: KeyRound },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/logs', label: 'Logs', icon: ScrollText },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  const isLogin = pathname === '/admin/login';

  useEffect(() => {
    if (isLogin) return;
    const token = sessionStorage.getItem('admin_token');
    if (!token) router.push('/admin/login');
    else setAuthed(true);
  }, [isLogin, router]);

  if (isLogin) return <>{children}</>;
  if (!authed) {
    return (
      <main className="page-shell">
        <div className="glass max-w-sm p-5 text-sm text-muted">
          <div className="skeleton mb-4 h-4 w-32" />
          Authenticating...
        </div>
      </main>
    );
  }

  function logout() {
    sessionStorage.removeItem('admin_token');
    router.push('/admin/login');
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 z-20 border-b border-white/10 bg-bg/95 px-3 py-3 backdrop-blur md:h-screen md:border-b-0 md:border-r md:bg-surface/70 md:p-4">
        <div className="flex items-center justify-between gap-3 md:block">
          <div className="flex items-center gap-2.5 px-1 text-base font-extrabold md:mb-5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-cyan-400 text-zinc-950">
              <ShieldCheck size={18} />
            </span>
            Admin
          </div>
          <button
            onClick={logout}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-red-400/20 bg-red-400/10 px-3 text-sm font-semibold text-red-200 transition hover:bg-red-400/15 md:hidden"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>

        <nav className="mt-3 flex gap-1 overflow-x-auto md:mt-0 md:flex-col md:overflow-visible">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? 'border border-cyan-300/25 bg-cyan-300/10 text-cyan-100'
                    : 'text-muted hover:bg-white/[.05] hover:text-white'
                }`}
              >
                <Icon size={17} />
                {label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={logout}
          className="mt-4 hidden w-full items-center gap-2 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-400/15 md:flex"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}
