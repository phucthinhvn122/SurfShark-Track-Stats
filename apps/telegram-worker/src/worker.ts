// apps/telegram-worker/src/worker.ts
//
// Standalone Telegram Automation Service (pooled).
// - Runs an enterprise SessionPool of N MTProto user sessions (failover, health
//   checks, rate balancing). Effective concurrency == healthy session count.
// - Consumes the BullMQ `activation` queue; one in-flight request per session
//   guarantees replies are matched to the correct job.
// - Idempotent: jobs already in a terminal state are skipped (no double-commit).
// - Handles FloodWait, timeout, session failover, DLQ, heartbeat, graceful stop.
//
import * as Sentry from '@sentry/node';
import { Worker, Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { FloodWaitError } from 'telegram/errors';
import { createDecipheriv, scryptSync } from 'crypto';
import type { StatusResponse } from '@surfshark/shared';
import { SessionPool } from './session-pool';

const DAY = 86_400_000;
const REPLY_TIMEOUT_MS = 25_000;
const HEARTBEAT_KEY = 'worker:heartbeat';
const SESSIONS_KEY = 'worker:sessions';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1, environment: process.env.NODE_ENV });
}

const prisma = new PrismaClient();
const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
const dlq = new Queue('activation-dlq', { connection });

interface ActivationJob {
  requestId: string;
  licenseKey: string;
  username: string;
}

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH!;
const botUsername = process.env.BOT_USERNAME || '@SurfsharkBot';

let pool: SessionPool;

/** AES-256-GCM decrypt — matches the API's settings encryption. */
function decryptSession(payload: string): string {
  const key = scryptSync(process.env.SESSION_ENC_KEY!, 'surfshark-salt', 32);
  const [ivH, tagH, dataH] = payload.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataH, 'hex')), decipher.final()]).toString('utf8');
}

const maybeDecrypt = (s: string) => (s.split(':').length === 3 ? decryptSession(s) : s);

/**
 * Resolve the session strings for the pool, in priority order:
 *   1. TG_SESSIONS env (comma-separated, encrypted or plain)
 *   2. TG_SESSION env (single)
 *   3. settings.telegramSession from the DB (encrypted)
 */
async function resolveSessions(): Promise<string[]> {
  const fromEnvMulti = process.env.TG_SESSIONS?.split(',').map((s) => s.trim()).filter(Boolean);
  if (fromEnvMulti?.length) return fromEnvMulti.map(maybeDecrypt);
  if (process.env.TG_SESSION) return [maybeDecrypt(process.env.TG_SESSION)];
  try {
    const settings = await prisma.settings.findFirst({ where: { id: 1 } });
    if (settings?.telegramSession) return [maybeDecrypt(settings.telegramSession)];
  } catch (e) {
    console.error('Could not load session from DB:', (e as Error).message);
  }
  return [];
}

// ---------- parse the bot reply into a structured result ----------
function parseReply(text: string): { ok: boolean; reason?: string } {
  const t = text.toLowerCase();
  if (/✅|activated|success|valid/.test(t)) return { ok: true };
  if (/banned|blocked/.test(t)) return { ok: false, reason: 'banned' };
  if (/expired/.test(t)) return { ok: false, reason: 'expired' };
  if (/invalid|not found|unknown/.test(t)) return { ok: false, reason: 'invalid' };
  // unexpected format → alert (parser drift) and treat as retryable failure
  Sentry.captureMessage(`Unexpected bot reply: ${text.slice(0, 200)}`, 'warning');
  return { ok: false, reason: 'unexpected' };
}

async function writeStatus(requestId: string, status: StatusResponse) {
  await connection.set(`status:${requestId}`, JSON.stringify(status), 'EX', 3600);
}

// ---------- the job processor ----------
async function processJob(job: Job<ActivationJob>) {
  const { requestId, licenseKey, username } = job.data;

  // Idempotency — FIX (audit): a retry/duplicate must not re-commit. Skip if the
  // activation already reached a terminal state.
  const existing = await prisma.activation.findUnique({ where: { requestId } });
  if (existing && existing.result !== 'pending') {
    return;
  }

  const command = `/activate ${username} ${licenseKey}`;
  await prisma.telegramLog.create({ data: { action: 'activate', request: command, status: 'sent' } });

  let replyText: string;
  let sessionId: number;
  try {
    const res = await pool.sendAndAwaitReply(command);
    replyText = res.text;
    sessionId = res.sessionId;
  } catch (err: any) {
    if (err instanceof FloodWaitError) {
      await new Promise((r) => setTimeout(r, (err.seconds + 1) * 1000));
      throw err; // backoff retry
    }
    throw err; // TG_TIMEOUT / NO_HEALTHY_SESSION / network → retry/backoff
  }

  await prisma.telegramLog.create({
    data: { action: 'activate', request: command, response: `[s${sessionId}] ${replyText}`, status: 'received' },
  });

  const parsed = parseReply(replyText);
  if (!parsed.ok) {
    // 'unexpected' is retryable (parser/transient); definitive 'no' is terminal.
    if (parsed.reason === 'unexpected') throw new Error('TG_UNEXPECTED_REPLY');
    await prisma.activation.update({ where: { requestId }, data: { result: 'failed' } });
    await writeStatus(requestId, {
      state: 'failed',
      error: { code: `ERR_BOT_${parsed.reason?.toUpperCase()}`, message: replyText },
    });
    return;
  }

  // commit success atomically with a row lock (race-safe)
  const settings = await prisma.settings.findFirst();
  const duration = settings?.durationDays ?? 30;
  const license = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM licenses WHERE license_key = ${licenseKey} FOR UPDATE`;
    if (locked[0]?.status === 'unused') {
      const activatedAt = new Date();
      const expiredAt = new Date(activatedAt.getTime() + duration * DAY);
      return tx.license.update({ where: { licenseKey }, data: { username, status: 'active', activatedAt, expiredAt } });
    }
    return tx.license.findUniqueOrThrow({ where: { licenseKey } });
  });
  await prisma.activation.update({ where: { requestId }, data: { result: 'success' } });

  const exp = license.expiredAt!;
  await writeStatus(requestId, {
    state: 'success',
    username,
    license: licenseKey,
    activatedAt: license.activatedAt?.toISOString(),
    expiredAt: exp.toISOString(),
    remainingDays: Math.max(0, Math.ceil((exp.getTime() - Date.now()) / DAY)),
  });
}

// ---------- boot ----------
async function main() {
  // FIX (audit): fail fast on misconfiguration instead of crashing mid-job
  // (e.g. decrypt blowing up only when a DB-stored session is loaded).
  for (const k of ['REDIS_URL', 'TG_API_ID', 'TG_API_HASH', 'SESSION_ENC_KEY'] as const) {
    if (!process.env[k]) throw new Error(`Missing required env var: ${k}`);
  }
  if (!Number.isInteger(apiId) || apiId <= 0) throw new Error('TG_API_ID must be a positive integer');

  const sessions = await resolveSessions();
  if (sessions.length === 0) throw new Error('No Telegram sessions configured (TG_SESSIONS / TG_SESSION / DB)');

  pool = new SessionPool(apiId, apiHash, botUsername, sessions, REPLY_TIMEOUT_MS);
  await pool.init();
  if (pool.healthyCount === 0) {
    console.error('WARNING: no healthy Telegram sessions — activations will fail until rotated.');
  }

  // Heartbeat + pool stats — surfaced by the API /health endpoint.
  const beat = async () => {
    await connection.set(HEARTBEAT_KEY, String(Date.now())).catch(() => {});
    await connection.set(SESSIONS_KEY, JSON.stringify(pool.stats()), 'EX', 120).catch(() => {});
  };
  await beat();
  const heartbeat = setInterval(beat, 30_000);

  // Periodic session health checks (reconnect + re-auth).
  const healthTimer = setInterval(() => pool.healthCheck().catch(() => {}), 60_000);

  // Concurrency scales with the pool (each session is serialised internally).
  const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? (pool.healthyCount || 1)));

  const worker = new Worker<ActivationJob>('activation', processJob, {
    connection,
    concurrency,
    limiter: { max: 20 * Math.max(1, pool.size), duration: 60_000 },
  });

  worker.on('completed', (job) => console.log(`✓ ${job.id} completed`));
  worker.on('failed', async (job, err) => {
    console.error(`✗ ${job?.id} failed:`, err.message);
    Sentry.captureException(err);
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await dlq.add('dead', { ...job.data, error: err.message });
      await prisma.activation.update({ where: { requestId: job.data.requestId }, data: { result: 'failed' } }).catch(() => {});
      await writeStatus(job.data.requestId, {
        state: 'failed',
        error: { code: 'ERR_TELEGRAM_UNAVAILABLE', message: 'Activation service temporarily unavailable' },
      });
    }
  });

  console.log(`Telegram worker listening (concurrency=${concurrency}, sessions=${pool.size})`);

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down…`);
    clearInterval(heartbeat);
    clearInterval(healthTimer);
    await worker.close();
    await dlq.close();
    await pool.disconnectAll();
    await prisma.$disconnect().catch(() => {});
    await connection.quit().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((e) => {
  console.error('Fatal worker error:', e);
  Sentry.captureException(e);
  process.exit(1);
});
