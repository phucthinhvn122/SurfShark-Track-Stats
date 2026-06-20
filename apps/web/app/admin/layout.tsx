// apps/web/app/admin/layout.tsx
'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutDashboard, KeyRound, Users, ScrollText, Settings, LogOut, ShieldCheck } from 'lucide-react';

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

  // login page renders without the shell
  if (isLogin) return <>{children}</>;
  if (!authed) return <main className="p-10 text-muted">Authenticating…</main>;

  function logout() {
    sessionStorage.removeItem('admin_token');
    router.push('/admin/login');
  }

  return (
    <div className="md:grid md:grid-cols-[240px_1fr] min-h-screen">
      <aside className="bg-surface border-b md:border-b-0 md:border-r border-white/10 p-4 flex md:flex-col gap-2 md:sticky md:top-0 md:h-screen">
        <div className="flex items-center gap-2 font-extrabold px-2 mb-2 md:mb-4">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-secondary">
            <ShieldCheck size={18} />
          </span>
          Admin
        </div>
        <nav className="flex md:flex-col gap-1 flex-1 flex-wrap">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition ${
                  active ? 'bg-primary/20 border border-secondary/30 text-white' : 'text-muted hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon size={17} /> {label}
              </Link>
            );
          })}
        </nav>
        <button onClick={logout} className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-semibold bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20">
          <LogOut size={16} /> Sign out
        </button>
      </aside>
      <main className="overflow-y-auto">{children}</main>
    </div>
  );
}
