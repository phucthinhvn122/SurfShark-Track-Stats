// apps/web/app/page.tsx — Landing (Server Component for SEO)
import Link from 'next/link';
import { ShieldCheck, Zap, Lock } from 'lucide-react';

export default function Landing() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-16">
      <section className="text-center max-w-3xl mx-auto">
        <span className="inline-flex items-center gap-2 text-sm text-muted bg-white/5 border border-white/10 px-4 py-2 rounded-full">
          <span className="w-2 h-2 rounded-full bg-green-500" /> Secure activation gateway
        </span>
        <h1 className="mt-6 text-4xl sm:text-6xl font-black tracking-tight leading-tight">
          Activate your{' '}
          <span className="bg-gradient-to-r from-secondary via-violet-500 to-cyan-400 bg-clip-text text-transparent">
            Surfshark VPN
          </span>
          <br /> in seconds — no signup.
        </h1>
        <p className="mt-6 text-lg text-muted">
          No account. No login. Enter the 6-character code from your device — our server-side
          automation handles the rest through a secure Telegram session.
        </p>
        <div className="mt-8 flex gap-3 justify-center flex-wrap">
          <Link href="/login" className="btn-primary">Login with code →</Link>
        </div>
      </section>

      <section className="mt-16 grid sm:grid-cols-3 gap-4">
        {[
          { icon: Zap, t: 'Instant', d: 'Automated key validation and activation in real time.' },
          { icon: ShieldCheck, t: 'Server-side', d: 'Telegram session runs only on the server. You never touch the bot.' },
          { icon: Lock, t: 'Protected', d: 'Rate limiting, IP throttling, and full audit logging.' },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="glass p-6">
            <Icon className="text-secondary" />
            <h3 className="mt-3 text-lg font-bold">{t}</h3>
            <p className="mt-1 text-sm text-muted">{d}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
