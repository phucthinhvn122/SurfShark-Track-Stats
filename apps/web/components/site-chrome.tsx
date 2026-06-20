// apps/web/components/site-chrome.tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';

/** Public header + footer. Hidden on /admin routes (which have their own shell). */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith('/admin')) return <>{children}</>;

  return (
    <>
      <header className="max-w-5xl mx-auto w-full flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5 font-extrabold text-lg">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-secondary shadow-lg shadow-primary/40">
            <ShieldCheck size={18} />
          </span>
          Surfshark<span className="text-secondary">VPN</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/" className="px-3.5 py-2 rounded-lg text-muted hover:text-white hover:bg-white/5">Home</Link>
          <Link href="/activate" className="px-3.5 py-2 rounded-lg text-muted hover:text-white hover:bg-white/5">Activate</Link>
          <Link href="/admin/login" className="px-3.5 py-2 rounded-lg border border-white/10 text-muted hover:text-white">Admin</Link>
        </nav>
      </header>

      {children}

      <footer className="max-w-5xl mx-auto w-full px-6 py-7 mt-10 border-t border-white/10 flex justify-between gap-3 flex-wrap text-xs text-muted">
        <span>© 2026 Surfshark Activation Gateway</span>
        <span>Next.js · NestJS · Supabase · BullMQ + Upstash</span>
      </footer>
    </>
  );
}
