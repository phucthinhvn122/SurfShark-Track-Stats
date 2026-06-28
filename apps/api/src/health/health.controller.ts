// apps/api/src/health/health.controller.ts
import { Controller, Get, Inject, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { PrismaService } from '../common/prisma.service';
import { REDIS } from '../common/redis.module';

const WORKER_HEARTBEAT_KEY = 'worker:heartbeat';
const WORKER_SESSIONS_KEY = 'worker:sessions';
const WORKER_BOT_TARGET_KEY = 'worker:bot-target';
const HEARTBEAT_STALE_MS = 90_000; // worker pings every 30s; stale after 90s

type WorkerSessionStat = {
  id: number;
  healthy: boolean;
  inFlight: number;
  total: number;
};

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
    let telegram:
      | { botTarget?: string; healthySessions: number; totalSessions: number; sessions: WorkerSessionStat[] }
      | undefined;

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
    try {
      const raw = await this.redis.get(WORKER_SESSIONS_KEY);
      const sessions = raw ? (JSON.parse(raw) as WorkerSessionStat[]) : [];
      telegram = {
        botTarget: (await this.redis.get(WORKER_BOT_TARGET_KEY)) ?? undefined,
        healthySessions: sessions.filter((s) => s.healthy).length,
        totalSessions: sessions.length,
        sessions,
      };
      checks.session = checks.session || telegram.healthySessions > 0;
    } catch {}

    // DB + Redis are required for the API to function; worker/session are informational.
    const ok = checks.db && checks.redis;
    return res
      .status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json({ status: ok ? 'ok' : 'degraded', checks, telegram });
  }
}
