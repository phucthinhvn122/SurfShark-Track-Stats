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
// Device-code login flow: each job carries a 6-char deviceCode; the worker
// sends `/login <deviceCode>` to the Surfshark bot and writes the outcome
// back to the activations row. No license-key transaction is performed —
// device-code logins are stateless.
//
import * as Sentry from '@sentry/node';
import { Worker, Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Prisma, PrismaClient } from '@prisma/client';
import { FloodWaitError } from 'telegram/errors';
import { createDecipheriv, scryptSync } from 'crypto';
import { scanLoginResult, type LoginScanStatus, type StatusResponse } from '@surfshark/shared';
import { SessionPool } from './session-pool';
import { mapBotFailureStatus, mapCommitFailureStatus, mapExhaustedJobError } from './status-mapping';

const HEARTBEAT_KEY = 'worker:heartbeat';
const SESSIONS_KEY = 'worker:sessions';
const BOT_TARGET_KEY = 'worker:bot-target';
const SESSION_COUNT_KEY = 'worker:session-count';
const LOGIN_SENT_KEY_PREFIX = 'login:sent:';
const DAY = 86_400_000;
const DEFAULT_BOT_USERNAME = '@Vpnssfree_bot';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1, environment: process.env.NODE_ENV });
}

const prisma = new PrismaClient();
const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
const dlq = new Queue('activation-dlq', { connection });

interface ActivationJob {
  requestId: string;
  deviceCode: string;
  licenseKey: string;
}

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH!;
const botUsername = normalizeBotUsername(process.env.BOT_USERNAME);

let pool: SessionPool;

/** AES-256-GCM decrypt — must match the API's settings encryption. */
function decryptSession(payload: string): string {
  const key = scryptSync(process.env.SESSION_ENC_KEY!, 'surfshark-salt', 32);
  const [ivH, tagH, dataH] = payload.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataH, 'hex')), decipher.final()]).toString('utf8');
}

const maybeDecrypt = (s: string) => (s.split(':').length === 3 ? decryptSession(s) : s);

function normalizeBotUsername(value: string | undefined): string {
  const bot = (value || DEFAULT_BOT_USERNAME).trim();
  return bot.toLowerCase() === '@surfsharkbot' ? DEFAULT_BOT_USERNAME : bot;
}

function maskKey(k: string, visible = 4): string {
  if (k.length <= visible * 2) return '*'.repeat(k.length);
  return `${k.slice(0, visible)}${'*'.repeat(k.length - visible * 2)}${k.slice(-visible)}`;
}

function maskDeviceCode(c: string): string {
  if (c.length <= 4) return '*'.repeat(c.length);
  return `${c.slice(0, 2)}${'*'.repeat(c.length - 4)}${c.slice(-2)}`;
}

/**
 * Resolve every configured session string for the pool. Env sessions and the
 * admin Settings session are all tried so one stale env value cannot block a
 * fresh DB-stored session.
 */
async function resolveSessions(): Promise<string[]> {
  const sessions: string[] = [];
  const add = (value: string | undefined | null) => {
    const trimmed = value?.trim();
    if (trimmed) sessions.push(maybeDecrypt(trimmed));
  };

  process.env.TG_SESSIONS?.split(',').forEach(add);
  add(process.env.TG_SESSION);

  try {
    const settings = await prisma.settings.findFirst({ where: { id: 1 } });
    add(settings?.telegramSession);
  } catch (e) {
    console.error('Could not load session from DB:', (e as Error).message);
  }
  return Array.from(new Set(sessions));
}

// ---------- parse the bot reply into a structured result ----------
function searchableText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // \u0111/\u0110 is a standalone letter (not a combining diacritic) \u2014 fold to "d" so
    // ASCII patterns match "\u0111\u0103ng nh\u1eadp" -> "dang nhap", "\u0111\u00e3 s\u1eed d\u1ee5ng" -> "da su dung".
    .replace(/[\u0111\u0110]/g, 'd')
    .toLowerCase();
}

function parseReply(text: string, scanStatus: LoginScanStatus): { ok: boolean; reason?: string } {
  if (scanStatus === 'failed') return { ok: false, reason: 'failed' };
  if (scanStatus === 'success') return { ok: true };

  // `t` is diacritics-stripped + lowercased, so Vietnamese matches use the
  // ASCII fold ("thất bại" -> "that bai", "hết hạn" -> "het han").
  const t = searchableText(text);
  // Failure first so it wins when a reply mentions both outcomes.
  if (/\bthat\s*bai\b|khong\s*thanh\s*cong/.test(t)) return { ok: false, reason: 'failed' };
  if (/\bthanh\s*cong\b|dang\s*nhap\s*thanh\s*cong/.test(t)) return { ok: true };
  if (/✅|activated|logged in|success|valid|welcome/.test(t)) return { ok: true };
  if (/banned|blocked|bi\s*cam|bi\s*khoa/.test(t)) return { ok: false, reason: 'banned' };
  if (/expired|het\s*han/.test(t)) return { ok: false, reason: 'expired' };
  if (/invalid|not found|unknown|wrong|khong\s*hop\s*le|khong\s*tim\s*thay|khong\s*dung|\bsai\b|da\s*(duoc\s*)?su\s*dung|da\s*kich\s*hoat/.test(t))
    return { ok: false, reason: 'invalid' };
  // unexpected format → alert (parser drift) and treat as retryable failure
  Sentry.captureMessage(`Unexpected bot reply: ${text.slice(0, 200)}`, 'warning');
  return { ok: false, reason: 'unexpected' };
}

async function writeStatus(requestId: string, status: StatusResponse) {
  console.log(
    `[activation:${requestId}] status=${status.state}${status.error?.code ? ` code=${status.error.code}` : ''}`,
  );
  await connection.set(`status:${requestId}`, JSON.stringify(status), 'EX', 3600);
}

async function failAlreadySent(requestId: string) {
  await prisma.activation.update({ where: { requestId }, data: { result: 'failed' } }).catch(() => {});
  await writeStatus(requestId, {
    state: 'failed',
    error: {
      code: 'ERR_DUPLICATE_REQUEST',
      message: 'This login request was already sent once. Please start a new login if needed.',
    },
  });
}

async function commitLicenseActivation(licenseKey: string, requestId: string) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: string; duration_days: number }>>`
      SELECT id, status, duration_days FROM licenses WHERE license_key = ${licenseKey} FOR UPDATE`;
    const row = locked[0];
    if (!row) throw new Error('ERR_KEY_NOT_FOUND');
    if (row.status === 'banned') throw new Error('ERR_KEY_BANNED');
    if (row.status === 'expired') throw new Error('ERR_KEY_EXPIRED');
    if (row.status === 'active') throw new Error('ERR_KEY_IN_USE');

    const activatedAt = new Date();
    const expiredAt = new Date(activatedAt.getTime() + row.duration_days * DAY);
    const status = row.duration_days === 0 ? 'expired' : 'active';
    const license = await tx.license.update({
      where: { licenseKey },
      data: { status, activatedAt, expiredAt },
    });

    const activation = await tx.activation.updateMany({
      where: { requestId, result: 'pending' },
      data: { result: 'success', licenseId: license.id },
    });
    if (activation.count !== 1) throw new Error('ERR_ACTIVATION_NOT_PENDING');

    return license;
  });
}

// ---------- the job processor ----------
async function processJob(job: Job<ActivationJob>) {
  const { requestId, deviceCode, licenseKey } = job.data;
  const jobId = job.id;
  const logPrefix = `[activation:${requestId}][job:${jobId}][code:${deviceCode}]`;

  console.log(`${logPrefix} picked job license=${maskKey(licenseKey)}`);

  // Idempotency — FIX (audit): a retry/duplicate must not re-commit. Skip if the
  // activation already reached a terminal state.
  const existing = await prisma.activation.findUnique({ where: { requestId } });
  if (existing && existing.result !== 'pending') {
    console.log(`${logPrefix} activation already in terminal state result=${existing.result}. Skipping.`);
    return;
  }

  const command = `/login ${deviceCode}`;
  // Persist masked command so DB logs never contain the raw device code.
  const maskedCommand = `/login ${maskDeviceCode(deviceCode)}`;
  
  await prisma.telegramLog.create({ data: { action: 'login', request: maskedCommand, status: 'sent' } });
  console.log(`${logPrefix} sent command=${maskedCommand} to bot=${botUsername}`);

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
    data: { action: 'login', request: maskedCommand, response: `[s${sessionId}] ${replyText}`, status: 'received' },
  });
  console.log(`${logPrefix} received reply session=${sessionId} raw="${replyText.slice(0, 120)}"`);

  // Scan the bot reply into a friendly ✅/❌/⚠️ summary that rides along on the
  // status the web page polls — so the user sees the outcome right where they
  // ran the login. (parseReply below stays authoritative for the license commit.)
  const scanResult = scanLoginResult(replyText);
  const scan = { status: scanResult.status, message: scanResult.message };

  const parsed = parseReply(replyText, scanResult.status);
  if (!parsed.ok) {
    // 'unexpected' is retryable (parser/transient); definitive 'no' is terminal.
    if (parsed.reason === 'unexpected') throw new Error('TG_UNEXPECTED_REPLY');
    const status = mapBotFailureStatus(parsed.reason, replyText, scan);
    await prisma.activation.update({
      where: { requestId },
      data: {
        result: 'failed',
        sessionMeta: status.error ? { error: status.error } : undefined,
      },
    });
    await writeStatus(requestId, status);
    return;
  }

  let license;
  try {
    license = await commitLicenseActivation(licenseKey, requestId);
  } catch (err: any) {
    const status = mapCommitFailureStatus(err, scan);
    await prisma.activation.update({
      where: { requestId },
      data: {
        result: 'failed',
        sessionMeta: status.error ? { error: status.error } : undefined,
      },
    });
    console.error(`${logPrefix} commit failed after telegram success:`, err.message);
    await writeStatus(requestId, status);
    
    // Notify on Telegram that the backend failed to save the activation
    await pool.sendMessage(
      sessionId,
      `❌ Không thể hoàn tất đăng nhập với mã: ${deviceCode}. Lý do: ${(err as Error).message}`
    ).catch((tgErr) => {
      console.error(`${logPrefix} failed to send Telegram commit failure notification:`, tgErr.message);
    });
    return;
  }

  // Idempotency: set the Redis key *only after* DB commit success
  const sentKey = `${LOGIN_SENT_KEY_PREFIX}${requestId}`;
  await connection.set(sentKey, '1', 'EX', 3600);

  await writeStatus(requestId, {
    state: 'success',
    scan,
    deviceCode,
    licenseKey: license.licenseKey,
    durationDays: license.durationDays,
    activatedAt: license.activatedAt?.toISOString(),
    expiredAt: license.expiredAt?.toISOString(),
  });
  console.log(`${logPrefix} committed success license=${maskKey(license.licenseKey)}`);
}

// ---------- boot ----------
async function main() {
  for (const k of ['REDIS_URL', 'TG_API_ID', 'TG_API_HASH', 'SESSION_ENC_KEY'] as const) {
    if (!process.env[k]) throw new Error(`Missing required env var: ${k}`);
  }
  if (!Number.isInteger(apiId) || apiId <= 0) throw new Error('TG_API_ID must be a positive integer');

  const sessions = await resolveSessions();
  if (sessions.length === 0) throw new Error('No Telegram sessions configured (TG_SESSIONS / TG_SESSION / DB)');

  pool = new SessionPool(apiId, apiHash, botUsername, sessions);
  await pool.init();
  if (pool.healthyCount === 0) {
    console.error('WARNING: no healthy Telegram sessions — activations will fail until rotated.');
  }
  console.log(`Telegram bot target: ${botUsername}`);

  // Heartbeat + pool stats — surfaced by the API /health endpoint.
  const beat = async () => {
    await connection.set(HEARTBEAT_KEY, String(Date.now())).catch(() => {});
    await connection.set(SESSIONS_KEY, JSON.stringify(pool.stats()), 'EX', 120).catch(() => {});
    await connection.set(BOT_TARGET_KEY, botUsername, 'EX', 120).catch(() => {});
    await connection.set(SESSION_COUNT_KEY, String(sessions.length), 'EX', 120).catch(() => {});
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
    lockDuration: 150_000, // 150 seconds, safely larger than maxReplyWaitMs (120s)
    limiter: { max: 20 * Math.max(1, pool.size), duration: 60_000 },
  });

  worker.on('completed', (job) => console.log(`✓ ${job.id} completed`));
  worker.on('failed', async (job, err) => {
    console.error(`✗ ${job?.id} failed:`, err.message);
    Sentry.captureException(err);
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await dlq.add('dead', { ...job.data, error: err.message });
      const status = mapExhaustedJobError(err);
      await prisma.activation.update({
        where: { requestId: job.data.requestId },
        data: {
          result: 'failed',
          sessionMeta: status.error ? { error: status.error } : undefined,
        },
      }).catch((dbErr) => {
        console.error(`[worker:failed] failed to save error mapping in database for requestId=${job.data.requestId}:`, dbErr.message);
      });
      // Don't blame Telegram for every exhausted job: a reply the parser didn't
      // recognise rode through fine — it's parser drift, not an outage. Map the
      // thrown marker to the right code so the user sees the real cause.
      await writeStatus(job.data.requestId, status);
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
