// apps/web/app/not-found.tsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="max-w-md mx-auto px-6 py-20 text-center">
      <div className="glass p-10">
        <h2 className="text-5xl font-black bg-gradient-to-r from-secondary to-violet-500 bg-clip-text text-transparent">404</h2>
        <p className="text-muted mt-3">This page does not exist.</p>
        <Link href="/" className="btn-primary mt-6 inline-flex">Back home</Link>
      </div>
    </main>
  );
}
