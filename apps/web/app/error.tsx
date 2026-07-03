// apps/web/app/error.tsx
'use client';
import Link from 'next/link';
import { RotateCcw, XCircle } from 'lucide-react';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10 text-center sm:px-6 sm:py-16">
      <div className="glass p-6 sm:p-8">
        <XCircle className="mx-auto text-red-300" size={58} />
        <h1 className="mt-4 text-2xl font-extrabold">Something went wrong</h1>
        <p className="mt-2 text-sm leading-6 text-muted">An unexpected error occurred. Please try again.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button onClick={reset} className="btn-primary">
            <RotateCcw size={17} />
            Retry
          </button>
          <Link href="/" className="btn-ghost">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
