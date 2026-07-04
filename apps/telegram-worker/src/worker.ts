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
const LOGIN_REPLY_KEY_PREFIX = 'login:reply:';
const LOGIN_SENT_TTL = 300;
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
  // Success: Vietnamese patterns
  if (/\bthanh\s*cong\b|dang\s*nhap\s*thanh\s*cong|kich\s*hoat\s*thanh\s*cong|da\s*kich\s*hoat/.test(t)) return { ok: true };
  // Success: English/international patterns
  if (/✅|activated|logged\s*in|success|valid|welcome|ok\b|done|complete|granted|authorized|hoan\s*tat/.test(t)) return { ok: true };
  if (/banned|blocked|bi\s*cam|bi\s*khoa/.test(t)) return { ok: false, reason: 'banned' };
  if (/expired|het\s*han/.test(t)) return { ok: false, reason: 'expired' };
  if (/invalid|not\s*found|unknown|wrong|khong\s*hop\s*le|khong\s*tim\s*thay|khong\s*dung|\bsai\b|da\s*(duoc\s*)?su\s*dung/.test(t))
    return { ok: false, reason: 'invalid' };
  // Unexpected format — capture for diagnostics but DO NOT throw.
  // The bot already replied (so no point retrying /login), we just couldn't
  // classify it. Mark as terminal so the user can investigate and retry.
  Sentry.captureMessage(`Unrecognized bot reply: ${text.slice(0, 200)}`, 'warning');
  return { ok: false, reason: 'unrecognized' };
}

async function writeStatus(requestId: string, status: StatusResponse) {
  const log = (extra: string) =>
    console.log(
      `[activation:${requestId}] status=${status.state}${status.error?.code ? ` code=${status.error.code}` : ''} ${extra}`,
    );
  log('writing to Redis');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await connection.set(`status:${requestId}`, JSON.stringify(status), 'EX', 3600);
      log('written to Redis');
      return;
    } catch (e) {
      if (attempt < 3) {
        console.warn(`[activation:${requestId}] status write attempt ${attempt} failed, retrying: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 500));
      } else {
        console.error(`[activation:${requestId}] status write failed after 3 attempts: ${(e as Error).message}`);
      }
    }
  }
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

    // Idempotent: if the license is already active, check if this requestId
    // was the one that activated it. If yes, the DB committed but the response
    // was lost — return success.
    if (row.status === 'active') {
      const existing = await tx.activation.findUnique({
        where: { requestId },
        select: { result: true },
      });
      if (existing?.result === 'success') {
        const lic = await tx.license.findUnique({ where: { licenseKey } });
        if (!lic) throw new Error('ERR_KEY_NOT_FOUND');
        return lic;
      }
      throw new Error('ERR_KEY_IN_USE');
    }

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
    if (activation.count !== 1) {
      // Activation was already updated by a previous retry that lost connection
      const existing = await tx.activation.findUnique({
        where: { requestId },
        select: { result: true },
      });
      if (existing?.result === 'success') {
        const lic = await tx.license.findUnique({ where: { licenseKey } });
        if (!lic) throw new Error('ERR_KEY_NOT_FOUND');
        return lic;
      }
      throw new Error('ERR_ACTIVATION_NOT_PENDING');
    }

    return license;
  });
}

// ---------- the job processor ----------
async function processJob(job: Job<ActivationJob>) {
  const { requestId, deviceCode, licenseKey } = job.data;
  const jobId = job.id;
  const attemptNumber = job.attemptsMade + 1;
  const logPrefix = `[activation:${requestId}][job:${jobId}][code:${deviceCode}][attempt:${attemptNumber}]`;

  console.log(`${logPrefix} picked job license=${maskKey(licenseKey)}`);

  const activation = await prisma.activation.findUnique({
    where: { requestId },
    select: { id: true, result: true, sessionMeta: true, createdAt: true },
  });

  // Idempotency — skip if activation already in terminal state.
  if (activation && activation.result !== 'pending') {
    console.log(`${logPrefix} activation already in terminal state result=${activation.result}. Skipping.`);
    return;
  }

  const command = `/login ${deviceCode}`;
  const maskedCommand = `/login ${maskDeviceCode(deviceCode)}`;
  const sentKey = `${LOGIN_SENT_KEY_PREFIX}${requestId}`;
  const replyKey = `${LOGIN_REPLY_KEY_PREFIX}${requestId}`;

  let replyText: string;
  let sessionId: number;

  // Idempotency guard: on retry, reuse stored reply instead of re-sending to bot.
  const cachedReply = await connection.get(replyKey);
  if (cachedReply) {
    console.log(`${logPrefix} retry with stored bot reply (skip resend) replyLen=${cachedReply.length}`);
    replyText = cachedReply;
    sessionId = -1;
  } else {
    const alreadySent = await connection.get(sentKey);
    if (alreadySent) {
      // Previous attempt sent the command but did not store the reply.
      // Re-sending risks the bot saying "code already used".
      // Mark as failed to avoid duplicate /login.
      console.error(`${logPrefix} previous attempt sent /login but reply was lost. Marking failed.`);
      const status: StatusResponse = {
        state: 'server_error',
        error: {
          code: 'ERR_DUPLICATE_LOGIN',
          message: 'We sent the login code to the bot but did not receive a reply. If you see a success message in Telegram, your device is already activated — please verify in the Surfshark app or start a new login.',
        },
      };
      await prisma.activation.update({
        where: { requestId },
        data: { result: 'failed', sessionMeta: { error: status.error } },
      }).catch(() => {});
      await writeStatus(requestId, status);
      return;
    }

    // Fire-and-forget: log the sent command. Not awaited so the bot
    // round-trip starts immediately (saves ~30-50ms per job).
    prisma.telegramLog.create({
      data: { action: 'login', request: maskedCommand, status: 'sent' },
    }).catch((e) => {
      console.warn(`${logPrefix} could not log sent command: ${(e as Error).message}`);
    });
    console.log(`${logPrefix} sending command=${maskedCommand} to bot=${botUsername}`);

    // Set sentKey BEFORE the actual send, so on retry we know the command was
    // dispatched even if sendAndAwaitReply times out or the connection drops.
    await connection.set(sentKey, '1', 'EX', LOGIN_SENT_TTL).catch((e) => {
      console.warn(`${logPrefix} could not set pre-send sent key: ${(e as Error).message}`);
    });

    try {
      const res = await pool.sendAndAwaitReply(command);
      replyText = res.text;
      sessionId = res.sessionId;

      // Store reply for idempotent retry.
      await connection.set(replyKey, replyText, 'EX', LOGIN_SENT_TTL).catch((e) => {
        console.warn(`${logPrefix} could not set reply key: ${(e as Error).message}`);
      });
    } catch (err: any) {
      if (err instanceof FloodWaitError) {
        console.warn(`${logPrefix} flood-wait seconds=${err.seconds}`);
        await new Promise((r) => setTimeout(r, (err.seconds + 1) * 1000));
        throw err;
      }
      console.error(`${logPrefix} send/await failed error="${err.message}"`);
      throw err;
    }
  }

  // Fire-and-forget: log the received reply. Not awaited so it doesn't
  // block the commit + writeStatus path. The telegramLog table is for
  // debugging; losing a row on worker crash is acceptable.
  prisma.telegramLog.create({
    data: {
      action: 'login',
      request: maskedCommand,
      response: `[s${sessionId}] ${replyText}`,
      status: 'received',
    },
  }).catch((e) => {
    console.warn(`${logPrefix} could not log received reply: ${(e as Error).message}`);
  });
  console.log(`${logPrefix} received reply session=${sessionId} raw="${replyText.slice(0, 120)}"`);

  const scanResult = scanLoginResult(replyText);
  const scan = { status: scanResult.status, message: scanResult.message };

  const parsed = parseReply(replyText, scanResult.status);
  console.log(`${logPrefix} parseResult ok=${parsed.ok} reason=${parsed.reason ?? '-'} scanStatus=${scanResult.status}`);

  if (!parsed.ok) {
    // 'unexpected' is a parser failure (reply format not recognized). The bot
    // already replied with SOMETHING terminal, but we couldn't classify it.
    // Mark as terminal failure (NOT a BullMQ throw) so we don't spam the bot
    // with /login retries. The user can see the raw bot reply via scan.message
    // and start a fresh request if needed.
    const status = mapBotFailureStatus(parsed.reason, replyText, scan);
    const oldStatus = activation?.result ?? 'pending';
    await prisma.activation.update({
      where: { requestId },
      data: {
        result: 'failed',
        sessionMeta: status.error ? { error: status.error } : undefined,
      },
    }).catch((e) => {
      console.warn(`${logPrefix} could not mark activation failed in DB: ${(e as Error).message}`);
    });
    console.log(`${logPrefix} activation failed botRejected oldStatus=${oldStatus} newStatus=failed errorCode=${status.error?.code} reason=${parsed.reason ?? '-'}`);
    await writeStatus(requestId, status);
    return;
  }

  let license;
  try {
    const oldStatus = activation?.result ?? 'pending';
    license = await commitLicenseActivation(licenseKey, requestId);
    console.log(`${logPrefix} dbCommit ok oldStatus=${oldStatus} newStatus=success license=${maskKey(license.licenseKey)}`);
  } catch (err: any) {
    const status = mapCommitFailureStatus(err, scan);
    console.error(`${logPrefix} commit failed after telegram success errorCode=${status.error?.code} message="${err.message}"`);
    await prisma.activation.update({
      where: { requestId },
      data: {
        result: 'failed',
        sessionMeta: status.error ? { error: status.error } : undefined,
      },
    }).catch((dbErr) => {
      console.warn(`${logPrefix} could not save commit failure: ${(dbErr as Error).message}`);
    });
    await writeStatus(requestId, status);

    if (sessionId >= 0) {
      await pool.sendMessage(
        sessionId,
        `❌ Không thể hoàn tất đăng nhập với mã: ${deviceCode}. Lý do: ${(err as Error).message}`,
      ).catch((tgErr) => {
        console.error(`${logPrefix} failed to send Telegram commit failure notification: ${tgErr.message}`);
      });
    }
    return;
  }

  // Final idempotency marker (longer TTL — activation is complete).
  await connection.set(sentKey, '1', 'EX', 3600).catch((e) => {
    console.warn(`${logPrefix} could not extend sent key: ${(e as Error).message}`);
  });
  await connection.del(replyKey).catch(() => {});

  // CRITICAL PATH: writeStatus must fire BEFORE any other awaits so the SSE
  // PUBLISH happens as soon as the DB commit succeeds. The remaining log row
  // is fire-and-forget — losing it on a worker crash is acceptable (the
  // telegramLog table is for debugging, not the source of truth).
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

  // Fire-and-forget: log the successful commit. Not awaited so the SSE push
  // already fired by the time this DB write happens.
  prisma.telegramLog.create({
    data: {
      action: 'login',
      request: maskedCommand,
      response: `[s${sessionId}] ${replyText} -> committed ${maskKey(license.licenseKey)}`,
      status: 'received',
    },
  }).catch((e) => {
    console.warn(`${logPrefix} could not log committed reply: ${(e as Error).message}`);
  });
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
    lockDuration: 60_000, // 60s: maxReplyWaitMs (45s) + commit/writeStatus/log buffer
    limiter: { max: 20 * Math.max(1, pool.size), duration: 60_000 },
  });

  worker.on('completed', (job) => console.log(`✓ ${job.id} completed`));
  worker.on('failed', async (job, err) => {
    const maxAttempts = job?.opts?.attempts ?? 1;
    const exhausted = job ? job.attemptsMade >= maxAttempts : true;
    console.error(
      `✗ ${job?.id} failed attempt=${job?.attemptsMade}/${maxAttempts} exhausted=${exhausted}: ${err.message}`,
    );
    Sentry.captureException(err);
    if (job && exhausted) {
      await dlq.add('dead', { ...job.data, error: err.message });
      const status = mapExhaustedJobError(err);
      const logMeta = { requestId: job.data.requestId, errorCode: status.error?.code, state: status.state };
      console.log(`[worker:failed] exhausted job ${JSON.stringify(logMeta)}`);
      await prisma.activation.update({
        where: { requestId: job.data.requestId },
        data: {
          result: 'failed',
          sessionMeta: status.error ? { error: status.error } : undefined,
        },
      }).catch((dbErr) => {
        console.error(`[worker:failed] failed to save error mapping in database for requestId=${job.data.requestId}: ${dbErr.message}`);
      });
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
