// apps/api/src/common/response-time.middleware.ts
//
// Logs `method path elapsedMs status` for every request so cold-start spikes
// from Render/Supabase resume are visible in production logs without changing
// the response shape. Safe to keep long-term (one log line per request) or
// remove once the cold-start hypothesis is confirmed/refuted for /admin/login.
import type { NextFunction, Request, Response } from 'express';

export function responseTimeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startNs = process.hrtime.bigint();
  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    // eslint-disable-next-line no-console
    console.log(
      `[req] ${req.method} ${req.originalUrl} status=${res.statusCode} elapsedMs=${elapsedMs.toFixed(1)}`,
    );
  });
  next();
}
