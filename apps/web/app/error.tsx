// apps/web/app/error.tsx
'use client';
import Link from 'next/link';
import { XCircle } from 'lucide-react';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="max-w-md mx-auto px-6 py-20 text-center">
      <div className="glass p-10">
        <XCircle className="mx-auto text-red-400" size={56} />
        <h2 className="mt-4 text-2xl font-extrabold">Something went wrong</h2>
        <p className="text-muted mt-2">An unexpected error occurred. Please try again.</p>
        <div className="mt-6 flex gap-3">
          <button onClick={reset} className="btn-primary flex-1">Retry</button>
          <Link href="/" className="btn-ghost flex-1">Home</Link>
        </div>
      </div>
    </main>
  );
}
