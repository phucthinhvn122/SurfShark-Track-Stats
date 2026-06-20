// apps/web/app/status/[requestId]/page.tsx
'use client';
import { use } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useStatus } from '../../../hooks/queries';

const STEPS = ['Validating license key', 'Queuing activation job', 'Sending command to Surfshark Bot', 'Parsing bot response', 'Finalizing'];

export default function StatusPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = use(params);
  const { data, isError } = useStatus(requestId);

  // processing
  if (!data || data.state === 'processing') {
    return (
      <main className="max-w-md mx-auto px-6 py-20 text-center">
        <div className="glass p-10">
          <div className="w-14 h-14 mx-auto rounded-full border-[3px] border-white/10 border-t-secondary animate-spin" />
          <h3 className="mt-5 font-bold">Contacting Telegram service…</h3>
          <ul className="mt-5 text-left flex flex-col gap-2 text-sm text-muted">
            {STEPS.map((s) => <li key={s}>• {s}</li>)}
          </ul>
        </div>
      </main>
    );
  }

  // failed
  if (data.state === 'failed' || isError) {
    return (
      <main className="max-w-md mx-auto px-6 py-20 text-center">
        <div className="glass p-10">
          <XCircle className="mx-auto text-red-400" size={56} />
          <h2 className="mt-4 text-2xl font-extrabold">Activation failed</h2>
          <p className="text-muted mt-2">{data.error?.message ?? 'Something went wrong.'}</p>
          {data.error?.code && <code className="inline-block mt-3 text-xs bg-white/5 px-2 py-1 rounded">{data.error.code}</code>}
          <div className="mt-6 flex gap-3">
            <Link href="/activate" className="btn-primary flex-1">Try again</Link>
            <Link href="/" className="btn-ghost flex-1">Home</Link>
          </div>
        </div>
      </main>
    );
  }

  // success
  return (
    <main className="max-w-lg mx-auto px-6 py-16">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="glass p-8">
        <div className="text-center">
          <CheckCircle2 className="mx-auto text-green-400" size={64} />
          <h2 className="mt-3 text-2xl font-extrabold">You're protected</h2>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-px bg-white/10 rounded-xl overflow-hidden border border-white/10">
          <Cell label="Username" value={data.username} />
          <Cell label="License key" value={data.license} />
          <Cell label="Activated at" value={fmt(data.activatedAt)} />
          <Cell label="Expires at" value={fmt(data.expiredAt)} />
          <div className="col-span-2 bg-surface p-4">
            <div className="text-xs text-muted">Remaining</div>
            <b className="text-3xl bg-gradient-to-r from-secondary to-violet-500 bg-clip-text text-transparent">
              {data.remainingDays} days
            </b>
          </div>
        </div>
        <Link href="/" className="btn-primary w-full mt-6">Done</Link>
      </motion.div>
    </main>
  );
}

function Cell({ label, value }: { label: string; value?: string }) {
  return (
    <div className="bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <b className="text-base break-all">{value ?? '—'}</b>
    </div>
  );
}
function fmt(iso?: string) {
  return iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}
