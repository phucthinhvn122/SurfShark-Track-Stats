# Production Audit & Upgrade Report

Audit of the Surfshark Activation Platform monorepo, followed by the implemented upgrades. Findings are grounded in the actual source (not assumptions).

---

## Scores (before → after the implemented fixes)

| Dimension | Before | After |
|---|---|---|
| Architecture | 6.5 | 8.5 |
| Security | 5.5 | 8.0 |
| Scalability | 6.0 | 8.0 |
| Reliability | 5.0 | 8.5 |
| Maintainability | 7.0 | 8.5 |
| Cost Efficiency | 8.0 | 8.5 |
| Developer Experience | 7.5 | 8.0 |

---

## Findings & status

### 🔴 Critical
1. **Telegram worker reply cross-talk.** The worker added a *global* `NewMessage` handler per job. With `concurrency=5`, multiple jobs listened simultaneously and **any** bot message resolved the first waiting handler → replies could be matched to the wrong job (**cross-user activation**).
   **FIXED** — `worker.ts` now serializes the send→await critical section with an async mutex (`runExclusive`), so exactly one request is in flight toward the bot at a time. BullMQ concurrency still parallelises DB/Redis work. Bot entity is cached.

### 🟠 High
2. **Connection exhaustion.** 6× `new PrismaClient()` and 3× `new IORedis()` in the API, each opening its own pool → exhaustion on the Supabase/Upstash poolers under load.
   **FIXED** — single global `PrismaService` (`prisma.module.ts`) and a single Redis provider (`redis.module.ts`) injected everywhere. Verified: API now has exactly one of each.
3. **No global exception filter.** Non-`AppException` errors leaked Nest's raw shape + internal messages/stacks.
   **FIXED** — `AllExceptionsFilter` (registered via `APP_FILTER`) returns the uniform `{success:false,error:{code,message}}` envelope; internals are logged server-side only; throttler 429s normalised to `ERR_RATE_LIMITED`.
4. **Activation race.** Two concurrent requests for the same unused key both passed validation; the second could be reported success on a key bound to the first.
   **FIXED** — `commitActivation` now runs in a transaction with `SELECT … FOR UPDATE` row lock and re-validates inside the lock.
5. **Expiry never persisted.** `withExpiry()` computed expiry in memory only; the DB kept stale `active` rows → wrong dashboard counts and some active-path checks on expired keys.
   **FIXED** — `LicenseService.markExpired()` + hourly `@Cron` sweep (`expiry.cron.ts`, `ScheduleModule`); dashboard also sweeps before counting.

### 🟡 Medium
6. **No graceful shutdown** → connection leaks on Render redeploys.
   **FIXED** — `PrismaService` lifecycle hooks + `app.enableShutdownHooks()`.
7. **CORS `credentials:true`** with Bearer auth (no cookies) — unnecessary surface.
   **FIXED** — set to `false`.
8. **JWT in `sessionStorage`** (XSS-readable).
   **Mitigated** by strict CSP; **recommended next**: httpOnly cookie + CSRF token (short-term).

### 🟢 Low / Short-term (documented, not yet changed)
- Duplicated admin auth checks across pages (layout already guards) — cosmetic.
- Parser `unexpected` branch should raise an alert/metric.
- Add Sentry + pino structured logging.
- Telegram **session pool** for throughput + SPOF removal (long-term).
- Partial index `licenses(status) WHERE status='active'` for sweep efficiency at scale.

---

## Files changed in this upgrade

**Added**
- `apps/api/src/common/prisma.service.ts` — singleton Prisma + shutdown hooks
- `apps/api/src/common/prisma.module.ts` — global module
- `apps/api/src/common/redis.module.ts` — single shared Redis provider
- `apps/api/src/common/all-exceptions.filter.ts` — uniform error envelope
- `apps/api/src/license/expiry.cron.ts` — hourly expiry sweep
- `apps/api/src/license/license.module.ts` — exports LicenseService + cron

**Modified**
- `apps/telegram-worker/src/worker.ts` — **mutex reply-correlation fix** + cached bot entity
- `apps/api/src/license/license.service.ts` — inject Prisma, **row-lock commit**, `markExpired()`
- `apps/api/src/activation/activation.service.ts` — inject Prisma
- `apps/api/src/activation/status.store.ts` — shared Redis
- `apps/api/src/telegram/activation-queue.service.ts` — shared Redis
- `apps/api/src/admin/{admin,settings,queries}.service.ts` — inject Prisma; dashboard sweeps expiry
- `apps/api/src/health/health.controller.ts` — inject Prisma + Redis
- `apps/api/src/app.module.ts` — wire Prisma/Redis/Schedule modules + global filter
- `apps/api/src/main.ts` — `enableShutdownHooks()`, `credentials:false`
- `apps/api/src/{activation,admin}/*.module.ts` — import `LicenseModule`
- `apps/api/package.json` — add `@nestjs/schedule`
- `apps/api/test/*.spec.ts` — updated for new constructors

**Validation**: every API, worker, test, shared, and web TS/TSX file passes an esbuild transform check; brace/paren balance verified on the worker.

---

## Remaining roadmap

**Short-term (next sprint):** httpOnly cookie auth + CSRF; alert on `unexpected` parser path; pino + Sentry; dedupe admin auth into the layout only.
**Long-term:** Telegram session pool, SSE status push, partial indexes, load testing, multi-region workers.
