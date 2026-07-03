// apps/web/app/admin/settings/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save } from 'lucide-react';
import { api } from '../../../lib/api';

type SettingsData = {
  telegramSession?: string;
  botUsername?: string;
  durationDays?: number;
  rateLimitPerMin?: number;
};

export default function SettingsPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<SettingsData | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = sessionStorage.getItem('admin_token');
    if (!t) return router.push('/admin/login');
    setToken(t);
    api
      .authed(t)
      .getSettings()
      .then(setData)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
      });
  }, [router]);

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const patch: Record<string, unknown> = {
      botUsername: form.get('botUsername'),
      durationDays: Number(form.get('durationDays')),
      rateLimitPerMin: Number(form.get('rateLimitPerMin')),
    };
    const session = String(form.get('telegramSession') ?? '');
    if (session && !session.includes('\u2022')) patch.telegramSession = session;
    try {
      await api.authed(token).updateSettings(patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (!data && !error) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Settings</h1>
        <div className="glass mt-6 space-y-4 p-5">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index}>
              <div className="skeleton h-4 w-44" />
              <div className="skeleton mt-2 h-12 w-full" />
            </div>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <div>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Settings</h1>
        <p className="mt-2 text-sm leading-6 text-muted">Update operational settings exposed by the existing admin API.</p>
      </div>

      {error && <div className="mt-5 rounded-lg border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>}

      {data && (
        <form onSubmit={onSave} className="glass mt-6 flex flex-col gap-4 p-5 sm:p-6">
          <Field label="Telegram session string" name="telegramSession" defaultValue={data.telegramSession ?? ''} type="password" disabled={saving} />
          <Field label="Surfshark bot username" name="botUsername" defaultValue={data.botUsername ?? ''} disabled={saving} />
          <Field label="Activation duration (days)" name="durationDays" defaultValue={data.durationDays ?? 0} type="number" disabled={saving} />
          <Field label="Rate limit (req/min/IP)" name="rateLimitPerMin" defaultValue={data.rateLimitPerMin ?? 0} type="number" disabled={saving} />
          <button className="btn-primary w-full sm:w-fit" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="animate-spin" size={17} />
                Saving
              </>
            ) : saved ? (
              'Saved'
            ) : (
              <>
                <Save size={17} />
                Save settings
              </>
            )}
          </button>
        </form>
      )}
    </main>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = 'text',
  disabled,
}: {
  label: string;
  name: string;
  defaultValue: string | number;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-zinc-200">{label}</span>
      <input name={name} defaultValue={defaultValue} type={type} className="field-input" disabled={disabled} />
    </label>
  );
}
