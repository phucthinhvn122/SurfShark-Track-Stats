// apps/web/app/activate/page.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { activateSchema, type ActivateInput } from '@surfshark/shared';
import { useActivate } from '../../hooks/queries';

export default function ActivatePage() {
  const router = useRouter();
  const activate = useActivate();
  const [serverError, setServerError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<ActivateInput>({
    resolver: zodResolver(activateSchema),
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const { requestId } = await activate.mutateAsync(values);
      router.push(`/status/${requestId}`);
    } catch (e: any) {
      setServerError(e.message ?? 'Activation failed');
    }
  });

  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="glass p-8">
        <h2 className="text-2xl font-extrabold">Activate license</h2>
        <p className="text-muted text-sm mt-1">Enter your username and license key.</p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm text-muted">Username</span>
            <input {...register('username')} placeholder="thinh" className="field-input" autoComplete="off" />
            {errors.username && <small className="text-red-400 text-xs">{errors.username.message}</small>}
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm text-muted">License key</span>
            <input
              {...register('license')}
              placeholder="VPN-A9X2-K8LM"
              maxLength={13}
              className="field-input uppercase"
              autoComplete="off"
            />
            {errors.license && <small className="text-red-400 text-xs">{errors.license.message}</small>}
          </label>

          {serverError && <div className="text-red-400 text-sm">{serverError}</div>}

          <button type="submit" disabled={activate.isPending} className="btn-primary w-full">
            {activate.isPending ? 'Submitting…' : 'Activate'}
          </button>
        </form>
      </motion.div>
    </main>
  );
}
