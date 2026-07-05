// apps/web/app/login/page.tsx
'use client';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowRight, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { deviceLoginSchema, type DeviceLoginInput } from '@surfshark/shared';
import { useLogin } from '../../hooks/queries';
import StatusView from '../../components/auth/StatusView';

export default function LoginPage() {
  const login = useLogin();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // When set, we render the status view inline instead of redirecting to
  // /status/[id]. Skipping the redirect + initial GET /status round-trip
  // cuts ~300-500ms off the perceived first paint after the worker writes
  // the terminal status.
  const [submittedRequestId, setSubmittedRequestId] = useState<string | null>(null);
  const submitInFlight = useRef(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DeviceLoginInput>({
    resolver: zodResolver(deviceLoginSchema),
  });

  const busy = isSubmitting || login.isPending;

  const onSubmit = handleSubmit(async (values) => {
    if (submitInFlight.current || login.isPending) return;
    submitInFlight.current = true;
    setIsSubmitting(true);
    setServerError(null);
    try {
      const { requestId } = await login.mutateAsync(values);
      // Switch the same page to the status view in place — no router.push,
      // no separate /status/[id] route, no second navigation. The SSE
      // connection from StatusView opens immediately against the just-returned
      // requestId, so the worker's PUBLISH hits the open stream.
      setSubmittedRequestId(requestId);
    } catch (e: unknown) {
      submitInFlight.current = false;
      setIsSubmitting(false);
      setServerError(e instanceof Error ? e.message : 'Login failed');
    }
  });

  const loginAgain = () => {
    setSubmittedRequestId(null);
    setIsSubmitting(false);
    setServerError(null);
    submitInFlight.current = false;
    reset();
  };

  // Status view replaces both columns once a request is in flight so it
  // can use its own full-width layout.
  if (submittedRequestId) {
    return <StatusView requestId={submittedRequestId} skipInitialFetch onLoginAgain={loginAgain} />;
  }

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
      <section className="pt-2 sm:pt-8">
        <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-sm font-semibold text-cyan-200">
          <ShieldCheck size={16} />
          Device login
        </span>
        <h1 className="mt-5 text-3xl font-black leading-tight sm:text-5xl">Activate Surfshark on this device.</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted">
          Use the six-character code from Surfshark and the license key you received. The result appears on the next
          status screen.
        </p>
        <div className="mt-6 grid gap-3 text-sm text-muted sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-white/[.03] p-4">
            <p className="font-semibold text-white">No browser bot access</p>
            <p className="mt-1 leading-6">The frontend only calls the backend login API.</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[.03] p-4">
            <p className="font-semibold text-white">Live status</p>
            <p className="mt-1 leading-6">Processing, success, and failed states stay visible.</p>
          </div>
        </div>
      </section>

      <section className="glass p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-cyan-400/10 text-cyan-300">
            <KeyRound size={20} />
          </span>
          <div>
            <h2 className="text-xl font-extrabold">Login with device code</h2>
            <p className="mt-1 text-sm leading-6 text-muted">Enter both fields exactly as shown in your purchase details.</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-zinc-200">Device code</span>
            <input
              {...register('deviceCode')}
              placeholder="ABCDEF"
              maxLength={6}
              className="field-input font-mono text-lg uppercase tracking-widest"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy}
            />
            {errors.deviceCode && <small className="text-sm text-red-300">{errors.deviceCode.message}</small>}
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-zinc-200">License key</span>
            <input
              {...register('license')}
              placeholder="VPN-A9X2-K8LM"
              maxLength={13}
              className="field-input font-mono uppercase"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy}
            />
            {errors.license && <small className="text-sm text-red-300">{errors.license.message}</small>}
          </label>

          {serverError && (
            <div className="flex gap-2 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
              <AlertCircle className="mt-0.5 shrink-0" size={16} />
              <span>{serverError}</span>
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? (
              <>
                <Loader2 className="animate-spin" size={17} />
                Submitting
              </>
            ) : (
              <>
                Login
                <ArrowRight size={17} />
              </>
            )}
          </button>
        </form>
      </section>
    </main>
  );
}
