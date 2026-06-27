// apps/web/app/activate/page.tsx
// Legacy route — the public flow now lives at /login. Redirect permanently.
import { permanentRedirect } from 'next/navigation';

export default function ActivateLegacy() {
  permanentRedirect('/login');
}
