// apps/web/app/layout.tsx
import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from './providers';
import { SiteChrome } from '../components/site-chrome';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Surfshark VPN — Activation',
  description: 'Activate your Surfshark VPN license in seconds. No signup, no login.',
  openGraph: { title: 'Surfshark VPN Activation', type: 'website' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-bg text-white antialiased`}>
        <Providers>
          <SiteChrome>{children}</SiteChrome>
        </Providers>
      </body>
    </html>
  );
}
