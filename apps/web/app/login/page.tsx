// apps/web/app/login/page.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { deviceLoginSchema, type DeviceLoginInput } from '@surfshark/shared';
import { useLogin } from '../../hooks/queries';

export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();
  const [serverError, setServerError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<DeviceLoginInput>({
    resolver: zodResolver(deviceLoginSchema),
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const { requestId } = await login.mutateAsync(values);
      router.push(`/status/${requestId}`);
    } catch (e: any) {
      setServerError(e.message ?? 'Login failed');
    }
  });

  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="glass p-8">
        <h2 className="text-2xl font-extrabold">Login with device code</h2>
        <p className="text-muted text-sm mt-1">Enter the 6-character code from your device.</p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm text-muted">Device code</span>
            <input
              {...register('deviceCode')}
              placeholder="ABCDEF"
              maxLength={6}
              className="field-input uppercase font-mono tracking-widest text-lg"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
            {errors.deviceCode && <small className="text-red-400 text-xs">{errors.deviceCode.message}</small>}
          </label>

          {serverError && <div className="text-red-400 text-sm">{serverError}</div>}

          <button type="submit" disabled={login.isPending} className="btn-primary w-full">
            {login.isPending ? 'Submitting…' : 'Login'}
          </button>
        </form>
      </motion.div>
    </main>
  );
}
