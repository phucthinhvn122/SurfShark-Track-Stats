// apps/web/components/auth/StatusView.tsx
'use client';
import Link from 'next/link';
import { CheckCircle2, Clock3, Loader2, XCircle } from 'lucide-react';
import { useStatus, useStatusStream } from '../../hooks/queries';
import { describeActivationFailure } from '../../lib/describe-activation-state';

const STEPS = [
  'Checking your login code',
  'Waiting for bot confirmation',
  'Verifying Telegram response',
  'Securing your session',
  'Opening your dashboard',
];

export interface StatusViewProps {
  requestId: string;
  /**
   * Skip the initial GET /status fetch. Use when the SSE is guaranteed to
   * provide the current value (e.g. right after submitting on the same
   * page) to save ~100-300ms on the first paint.
   */
  skipInitialFetch?: boolean;
  /**
   * Primary action when the activation is done (success OR failure). Defaults
   * to "Go home". For inline use on the login page, pass `onLoginAgain` so the
   * user can clear the state and submit a new code without leaving the page.
   */
  onLoginAgain?: () => void;
}

export default function StatusView({ requestId, skipInitialFetch, onLoginAgain }: StatusViewProps) {
  const { data, isError } = useStatus(requestId, { skipInitialFetch });

  // Open the SSE stream as soon as the component mounts. React Query's cache is
  // updated in-place as events arrive, so this component re-renders the
  // moment the worker writes the terminal status (no 1.5s polling lag).
  useStatusStream(requestId);

  if (!isError && (!data || data.state === 'pending' || data.state === 'processing')) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-10 text-center sm:px-6 sm:py-16">
        <div className="glass p-6 sm:p-8">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-cyan-300/10 text-cyan-300">
            <Loader2 className="animate-spin" size={28} />
          </div>
          <h1 className="mt-5 text-2xl font-extrabold">Confirming your login...</h1>
          <p className="mt-2 text-sm leading-6 text-muted">We're activating your device. This should only take a few seconds.</p>
          <ul className="mt-6 space-y-2 text-left text-sm text-muted">
            {STEPS.map((step) => (
              <li key={step} className="flex items-center gap-3 rounded-lg bg-white/[.04] p-3">
                <Clock3 className="shrink-0 text-cyan-300" size={16} />
                {step}
              </li>
            ))}
          </ul>
        </div>
      </main>
    );
  }

  if (isError || (data && data.state !== 'success')) {
    const detail = describeActivationFailure(data);
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-10 text-center sm:px-6 sm:py-16">
        <div className="glass p-6 sm:p-8">
          <XCircle className="mx-auto text-red-300" size={58} />
          <h1 className="mt-4 text-2xl font-extrabold">{detail.title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted">{detail.message}</p>
          {detail.code && (
            <code className="mt-4 inline-block rounded-lg border border-white/10 bg-white/[.04] px-3 py-1.5 text-xs text-red-200">
              {detail.code}
            </code>
          )}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {onLoginAgain ? (
              <button type="button" onClick={onLoginAgain} className="btn-primary">
                Try again
              </button>
            ) : (
              <Link href="/login" className="btn-primary">
                Try again
              </Link>
            )}
            <Link href="/" className="btn-ghost">
              Home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="glass p-5 sm:p-8">
        <div className="text-center">
          <div className="relative mx-auto inline-flex h-20 w-20 items-center justify-center">
            <div className="absolute inset-0 animate-ping rounded-full bg-emerald-400/20"></div>
            <div className="relative flex h-full w-full items-center justify-center rounded-full bg-emerald-400/10 shadow-[0_0_30px_rgba(52,211,153,0.2)]">
              <CheckCircle2 className="text-emerald-400" size={40} />
            </div>
          </div>
          <h1 className="mt-5 text-2xl font-extrabold tracking-tight">{data.scan?.message ?? "You're protected"}</h1>
          <p className="mt-2 text-sm leading-6 text-muted">Your device has been successfully activated.</p>
        </div>

        <div className="mt-8 overflow-hidden rounded-xl border border-white/10 bg-white/[.02]">
          <div className="border-b border-white/5 bg-white/[.02] px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-medium text-white/80">Activation Details</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
              Active
            </span>
          </div>
          <div className="grid sm:grid-cols-2">
            <Cell label="Device code" value={maskCode(data.deviceCode)} />
            <Cell label="License key" value={maskKey(data.licenseKey)} />
            <Cell label="Plan" value={planLabel(data.durationDays)} />
            <Cell label="Expires" value={fmt(data.expiredAt)} />
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-cyan-500/10 bg-cyan-500/[.03] p-5 text-left text-sm text-cyan-200/70">
          <p className="font-semibold text-cyan-100 flex items-center gap-2">
            <CheckCircle2 size={16} className="text-cyan-400" />
            What's next?
          </p>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed">
            <li className="flex gap-2">
              <span className="text-cyan-500">•</span>
              Return to your TV or device where you started the login.
            </li>
            <li className="flex gap-2">
              <span className="text-cyan-500">•</span>
              It should automatically refresh and log you in within a few seconds.
            </li>
            <li className="flex gap-2">
              <span className="text-cyan-500">•</span>
              If it doesn't connect immediately, try restarting the Surfshark app.
            </li>
          </ul>
        </div>

        {onLoginAgain ? (
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={onLoginAgain} className="btn-primary shadow-[0_0_20px_rgba(6,182,212,0.2)]">
              Login another device
            </button>
            <Link href="/" className="btn-ghost">
              Home
            </Link>
          </div>
        ) : (
          <Link href="/" className="btn-primary mt-8 w-full shadow-[0_0_20px_rgba(6,182,212,0.2)]">
            Done
          </Link>
        )}
      </div>
    </main>
  );
}

function Cell({ label, value }: { label: string; value?: string }) {
  return (
    <div className="border-b border-white/10 bg-white/[.03] p-4 last:border-b-0 sm:border-r sm:[&:nth-child(2n)]:border-r-0 sm:[&:nth-last-child(-n+2)]:border-b-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <b className="mt-1 block break-all font-mono text-base text-white">{value ?? '-'}</b>
    </div>
  );
}

function fmt(iso?: string) {
  return iso
    ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '-';
}

function maskKey(key?: string) {
  if (!key || key.length < 8) return key ?? '-';
  return `${key.slice(0, 7)}***${key.slice(-4)}`;
}

function planLabel(days?: number) {
  if (days === 0) return 'One time';
  if (days === 7) return '7 days';
  if (days === 30) return '30 days';
  if (days === 365) return '1 year';
  return days ? `${days} days` : '-';
}

function maskCode(code?: string) {
  if (!code || code.length < 4) return code ?? '-';
  return `${code.slice(0, 2)}**${code.slice(-2)}`;
}
