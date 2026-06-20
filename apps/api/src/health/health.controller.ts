// apps/api/src/health/health.controller.ts
import { Controller, Get, Inject, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { PrismaService } from '../common/prisma.service';
import { REDIS } from '../common/redis.module';

const WORKER_HEARTBEAT_KEY = 'worker:heartbeat';
const HEARTBEAT_STALE_MS = 90_000; // worker pings every 30s; stale after 90s

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Liveness/readiness for Render + CI.
   * FIX (audit): returns HTTP 503 when degraded so the platform can restart the
   * instance, and reports Telegram worker liveness via a Redis heartbeat.
   */
  @Get()
  async check(@Res() res: Response) {
    const checks: Record<string, boolean> = { db: false, redis: false, session: false, worker: false };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = true;
    } catch {}
    try {
      await this.redis.ping();
      checks.redis = true;
    } catch {}

    const settings = await this.prisma.settings.findFirst().catch(() => null);
    checks.session = !!settings?.telegramSession;

    try {
      const hb = await this.redis.get(WORKER_HEARTBEAT_KEY);
      checks.worker = !!hb && Date.now() - Number(hb) < HEARTBEAT_STALE_MS;
    } catch {}

    // DB + Redis are required for the API to function; worker/session are informational.
    const ok = checks.db && checks.redis;
    return res
      .status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json({ status: ok ? 'ok' : 'degraded', checks });
  }
}
