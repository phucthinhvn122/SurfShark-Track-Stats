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
      <header className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 text-lg font-extrabold">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-cyan-400 text-zinc-950 shadow-sm shadow-cyan-950/30">
            <ShieldCheck size={18} />
          </span>
          <span>
            Surfshark<span className="text-cyan-300">VPN</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 overflow-x-auto text-sm">
          <Link href="/" className="rounded-lg px-3 py-2 text-muted transition hover:bg-white/5 hover:text-white">
            Home
          </Link>
          <Link href="/activate" className="rounded-lg px-3 py-2 text-muted transition hover:bg-white/5 hover:text-white">
            Activate
          </Link>
          <Link
            href="/admin/login"
            className="rounded-lg border border-white/10 px-3 py-2 text-muted transition hover:border-white/20 hover:text-white"
          >
            Admin
          </Link>
        </nav>
      </header>

      {children}

      <footer className="mx-auto mt-8 flex w-full max-w-6xl flex-wrap justify-between gap-3 border-t border-white/10 px-4 py-6 text-xs text-muted sm:px-6">
        <span>2026 Surfshark Activation Gateway</span>
        <span>Next.js / NestJS / Supabase / BullMQ + Upstash</span>
      </footer>
    </>
  );
}
