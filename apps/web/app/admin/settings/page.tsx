// apps/web/app/admin/settings/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';

export default function SettingsPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const t = sessionStorage.getItem('admin_token');
    if (!t) return router.push('/admin/login');
    setToken(t);
    api.authed(t).getSettings().then(setData).catch(() => router.push('/admin/login'));
  }, [router]);

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    const f = new FormData(e.currentTarget);
    const patch: Record<string, unknown> = {
      botUsername: f.get('botUsername'),
      durationDays: Number(f.get('durationDays')),
      rateLimitPerMin: Number(f.get('rateLimitPerMin')),
    };
    const session = String(f.get('telegramSession') ?? '');
    if (session && !session.includes('•')) patch.telegramSession = session;
    await api.authed(token).updateSettings(patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!data) return <main className="p-10 text-muted">Loading…</main>;

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-black mb-6">Settings</h1>
      <form onSubmit={onSave} className="glass p-6 flex flex-col gap-4">
        <Field label="Telegram session string" name="telegramSession" defaultValue={data.telegramSession ?? ''} type="password" />
        <Field label="Surfshark bot username" name="botUsername" defaultValue={data.botUsername} />
        <Field label="Activation duration (days)" name="durationDays" defaultValue={data.durationDays} type="number" />
        <Field label="Rate limit (req/min/IP)" name="rateLimitPerMin" defaultValue={data.rateLimitPerMin} type="number" />
        <button className="btn-primary w-fit">{saved ? 'Saved ✓' : 'Save settings'}</button>
      </form>
    </div>
  );
}

function Field({ label, name, defaultValue, type = 'text' }: { label: string; name: string; defaultValue: any; type?: string }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm text-muted">{label}</span>
      <input name={name} defaultValue={defaultValue} type={type} className="field-input" />
    </label>
  );
}
