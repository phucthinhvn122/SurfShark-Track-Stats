// apps/web/app/page.tsx - Landing (Server Component for SEO)
import Link from 'next/link';
import { Lock, ShieldCheck, Zap } from 'lucide-react';

const FEATURES = [
  { icon: Zap, title: 'Fast', description: 'Validate a key and start device login from one focused form.' },
  { icon: ShieldCheck, title: 'Server-side', description: 'Telegram automation stays on the server and never runs in the browser.' },
  { icon: Lock, title: 'Audited', description: 'Activation attempts are rate-limited and visible to admins.' },
];

export default function Landing() {
  return (
    <main className="page-shell">
      <section className="grid gap-8 py-8 sm:py-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-sm font-semibold text-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-300" />
            Secure activation gateway
          </span>
          <h1 className="mt-5 max-w-3xl text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
            Surfshark VPN activation in seconds.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted sm:text-lg">
            Enter the device code from Surfshark and your license key. The backend validates the key and sends the
            activation request through the existing secure Telegram session.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link href="/login" className="btn-primary">
              Login with code
            </Link>
            <Link href="/admin/login" className="btn-ghost">
              Admin portal
            </Link>
          </div>
        </div>

        <div className="glass p-5">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div>
              <p className="text-sm font-semibold text-muted">Activation status</p>
              <h2 className="mt-1 text-xl font-extrabold">Ready</h2>
            </div>
            <ShieldCheck className="text-cyan-300" size={28} />
          </div>
          <div className="mt-5 space-y-3 text-sm">
            {['License key checked by API', 'Single login request created', 'Result shown on the status page'].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-lg bg-white/[.04] p-3 text-zinc-200">
                <span className="h-2 w-2 rounded-full bg-cyan-300" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, description }) => (
          <div key={title} className="glass p-5">
            <Icon className="text-cyan-300" size={24} />
            <h3 className="mt-4 text-lg font-bold">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
