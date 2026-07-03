// apps/web/app/not-found.tsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10 text-center sm:px-6 sm:py-16">
      <div className="glass p-6 sm:p-8">
        <h1 className="text-5xl font-black text-cyan-300">404</h1>
        <p className="mt-3 text-sm leading-6 text-muted">This page does not exist.</p>
        <Link href="/" className="btn-primary mt-6">
          Back home
        </Link>
      </div>
    </main>
  );
}
