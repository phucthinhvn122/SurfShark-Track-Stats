# Surfshark VPN Activation Platform — Production Blueprint

> Production-ready blueprint + working code starter. Stack: Next.js 15 (Vercel) · NestJS (Render) · Prisma · Supabase PostgreSQL · BullMQ + Upstash Redis · GramJS Telegram worker.

---

## 1. System Architecture

```
                         ┌──────────────────────────────┐
                         │   User (browser, no login)    │
                         └───────────────┬──────────────┘
                                         │ HTTPS
                         ┌───────────────▼──────────────┐
                         │  Frontend — Next.js 15 (Vercel)│
                         │  Landing / Activate / Status   │
                         └───────────────┬──────────────┘
                                         │ REST (JSON, Zod-validated)
                         ┌───────────────▼──────────────┐
                         │   API — NestJS (Render)        │
                         │  Helmet · CORS · RateLimit     │
                         │  /activate  /status  /admin/*  │
                         └──────┬──────────────────┬─────┘
                                │                  │
                  ┌─────────────▼───┐     ┌────────▼───────────┐
                  │ Supabase Postgres│     │  Redis (Upstash)   │
                  │  via Prisma ORM  │     │  BullMQ queues     │
                  └─────────────────┘      └────────┬──────────┘
                                                    │ job: { activationId }
                                          ┌─────────▼──────────────┐
                                          │ Telegram Worker (GramJS)│
                                          │ MTProto user session    │
                                          │ Retry · FloodWait · DLQ │
                                          └─────────┬──────────────┘
                                                    │ MTProto
                                          ┌─────────▼──────────────┐
                                          │   @SurfsharkBot (TG)    │
                                          └─────────────────────────┘
```

**Key principles**
- The Telegram **user session lives only in the worker** (server-side). The browser never touches Telegram.
- API is **stateless**; long work (Telegram round-trip) is offloaded to the queue so HTTP stays < 500ms.
- The browser polls `GET /status/:requestId` (or uses SSE) until the worker writes the result.

**Request lifecycle (async)**
1. `POST /activate` → validate key in a DB transaction, set status `pending`, enqueue job, return `{ requestId, state: "processing" }` (fast).
2. Worker consumes job → sends command to bot → parses reply → updates `activations` + `licenses` → emits result.
3. Frontend polls `GET /status/:requestId` → renders success/error.

---

## 2. Complete Database Schema (logical)

| Table | Purpose | Key columns |
|---|---|---|
| `licenses` | source of truth for a key | `license_key (unique)`, `username`, `status`, `activated_at`, `expired_at` |
| `activations` | one row per activation attempt | `license_id (fk)`, `username`, `ip_address`, `country`, `device`, `result`, `request_id` |
| `telegram_logs` | every bot interaction | `action`, `request`, `response`, `status` |
| `admins` | admin accounts | `username (unique)`, `password_hash` |
| `settings` | singleton config | `telegram_session`, `bot_username` |
| `audit_logs` | admin action trail | `admin_id (fk)`, `action`, `target` |

**Enums**: `license_status = { unused, active, expired, banned }`, `activation_result = { pending, success, failed }`.

**Indexes**: `licenses(license_key)`, `licenses(status)`, `licenses(expired_at)`, `activations(request_id)`, `activations(license_id)`, `activations(created_at)`.

State machine:
```
unused ──activate──▶ active ──(expiry passes)──▶ expired
  │                    │ ▲                          │
  └──ban──▶ banned ◀──ban└──────unban───────────────┘   extend: active/expired → active (+30d)
```

---

## 3. Prisma Schema

See `prisma/schema.prisma` (real file in this bundle). Highlights:
- `LicenseStatus` / `ActivationResult` enums.
- `License` 1—N `Activation`.
- `Settings` as a single-row table.
- `@@index` on hot lookup columns.
- `updatedAt` via `@updatedAt`.

Migrate: `npx prisma migrate deploy` (CI) / `npx prisma migrate dev` (local).

---

## 4. API Specification

Base URL: `https://api.surfshark-activate.app`. All bodies JSON. All inputs Zod-validated. Errors use a uniform envelope:
```json
{ "success": false, "error": { "code": "ERR_KEY_BANNED", "message": "..." } }
```

### Public

**POST /activate**
```jsonc
// req
{ "username": "thinh", "license": "VPN-A9X2-K8LM" }
// 202 Accepted
{ "success": true, "data": { "requestId": "req_8f2…", "state": "processing" } }
```
Validation: `username` 3–32 `[a-zA-Z0-9_]`; `license` matches `^VPN-[A-Z0-9]{4}-[A-Z0-9]{4}$`.
Errors: `ERR_VALIDATION` 400 · `ERR_KEY_NOT_FOUND` 404 · `ERR_KEY_BANNED` 403 · `ERR_KEY_EXPIRED` 410 · `ERR_KEY_IN_USE` 409 · `ERR_RATE_LIMITED` 429.
Rate limit: **5 / min / IP** + 20 / hour / IP.

**GET /status/:requestId**
```jsonc
{ "success": true, "data": {
  "state": "success",               // processing | success | failed
  "username": "thinh", "license": "VPN-A9X2-K8LM",
  "activatedAt": "2026-06-20T11:00:00Z", "expiredAt": "2026-07-20T11:00:00Z",
  "remainingDays": 30 } }
```
Rate limit: 30 / min / IP.

### Admin (JWT Bearer, all audit-logged)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| POST | `/admin/login` | `{username,password}` | `{accessToken, expiresIn}` |
| GET | `/admin/dashboard` | — | counts + 7-day series |
| POST | `/admin/keys/create` | `{count?,notes?}` | created keys |
| POST | `/admin/keys/bulk-create` | `{count:1..1000}` | `{generated, csvUrl}` |
| PATCH | `/admin/keys/ban` | `{licenseKey}` | updated |
| PATCH | `/admin/keys/unban` | `{licenseKey}` | updated |
| PATCH | `/admin/keys/extend` | `{licenseKey,days=30}` | updated |
| DELETE | `/admin/keys/delete` | `{licenseKey}` | `{deleted:true}` |
| GET | `/admin/keys` | `?status&search&page&limit` | paginated |
| GET | `/admin/users` | `?page&limit` | activation history |
| GET | `/admin/logs` | `?type=activation\|telegram\|system\|error\|security` | log lines |
| GET | `/admin/settings` | — | settings (session masked) |
| PATCH | `/admin/settings` | `{telegramSession?,botUsername?,...}` | updated |

Admin rate limit: 60 / min / token. Login: 5 / min / IP (brute-force guard) + lockout after 10 fails.

Common error codes: `ERR_UNAUTHORIZED` 401 · `ERR_FORBIDDEN` 403 · `ERR_NOT_FOUND` 404 · `ERR_CONFLICT` 409 · `ERR_INTERNAL` 500.

---

## 5. Frontend Architecture (Next.js 15)

- **App Router** + Server Components for static landing (SEO/Lighthouse); Client Components for the form.
- **State/data**: TanStack React Query — `useActivate()` mutation + `useStatus(requestId)` polling query (`refetchInterval` until terminal).
- **Forms**: React Hook Form + Zod resolver (schema shared from `packages/shared`).
- **UI**: TailwindCSS + Shadcn UI; Framer Motion for the processing/step animation; Lucide icons; loading skeletons.
- **Pages**: `/` landing, `/activate`, `/status/[requestId]`, `/error`, `/admin/login`, `/admin/(dashboard|keys|users|logs|settings)`.
- Admin routes guarded by middleware checking the JWT cookie; tokens stored httpOnly.

```
apps/web/
  app/(public)/{page,activate,status/[id]}/...
  app/admin/(dashboard|keys|users|logs|settings)/...
  components/ui/* (shadcn)  features/* (forms, tables)
  lib/api.ts  lib/queries.ts  hooks/*
```

---

## 6. Backend Architecture (NestJS)

Modular, dependency-injected. Modules:
- `ActivationModule` — `/activate`, `/status`; orchestrates validation → enqueue.
- `LicenseModule` — pure license state machine + Prisma access (reused by admin & worker callbacks).
- `AdminModule` — auth (JWT/Passport), keys CRUD, dashboard, logs, settings; guarded by `JwtAuthGuard` + `AuditInterceptor`.
- `TelegramModule` — **producer only** in the API: enqueues jobs; the consumer runs in the separate worker app.
- `CommonModule` — Zod pipe, Helmet, throttler, exception filter (uniform envelope), logger (pino).
- `HealthModule` — `/health` (db + redis + session-present checks) for Render & CI.

Real files in `apps/api/src/` (activation + license + telegram producer + admin auth scaffolding).

---

## 7. Telegram Service Architecture

Standalone Node app (`apps/telegram-worker`) — **not** part of the HTTP API.
- **GramJS** (`telegram` npm) MTProto **user** client; logs in from a `StringSession` (no Bot API).
- BullMQ **Worker** on the `activation` queue, `concurrency` configurable.
- Per job: resolve bot entity → `sendMessage('/activate <user> <key>')` → await reply via event handler with a **per-job timeout** → parse → write `activations`/`licenses`/`telegram_logs` → return result.
- **Error handling**: `FloodWaitError` → sleep `e.seconds` then retry; `TimeoutError` → BullMQ backoff retry; `AuthKeyError`/session expired → mark settings unhealthy + alert; network → exponential backoff.
- **Reliability**: retries (5, exponential backoff), `removeOnComplete`, **Dead Letter Queue** for exhausted jobs, structured logging, global rate limiter (token bucket) to respect Telegram limits.

Real file: `apps/telegram-worker/src/worker.ts`.

---

## 8. Redis Queue Architecture (BullMQ + Upstash)

```
activation (main) ──fail x5 (backoff)──▶ activation-dlq (dead letter)
        │ retry (built-in attempts/backoff)
        └─ events ──▶ status cache (key: status:<requestId>, TTL 1h)
```
- Queues: `activation`, `activation-dlq`.
- Job opts: `attempts: 5`, `backoff: { type: 'exponential', delay: 2000 }`, `removeOnComplete: 1000`, `removeOnFail: false`.
- Idempotency: `jobId = requestId` to dedupe double submits.
- Status surfaced to API via Redis cache `status:<requestId>` so `GET /status` never hits Telegram.
- Rate limiting: BullMQ `limiter: { max, duration }` + app-level token bucket.

---

## 9. Admin Panel Design
Sidebar shell → Dashboard (8 KPI cards, 7-day bar chart, license donut), Keys (generate 1/10/50/100/1000, search, status filter, ban/unban/extend/delete, CSV export), Users (activation history with IP/country/device), Logs (5 streams), Settings (masked session, bot username, duration, rate limits). JWT auth; every mutation writes `audit_logs`. (Live in the HTML demo bundle.)

## 10. User Panel Design
No auth. Landing → Activate (username + key, inline Zod validation) → animated processing reflecting the real pipeline → Status (username, key, activated/expired, remaining days) or Error page with machine-readable code. Mobile-first, dark, glassmorphism. (Live in the HTML demo bundle.)

---

## 11. Security Design
- **Helmet** secure headers + strict **CSP**; **CORS** allow-list (web origin only).
- **Rate limiting / IP throttling**: `@nestjs/throttler` global + per-route overrides; login brute-force lockout.
- **Input validation**: Zod on every body/query/param (shared schemas); reject unknown keys.
- **Injection**: Prisma parameterized queries (no raw SQL); ORM prevents SQLi. XSS: React auto-escaping + CSP; sanitize any rendered bot text. CSRF: admin uses Bearer tokens (no cookies for state-changing API) or double-submit token if cookie-based.
- **Secrets**: never in repo; Vercel/Render env + Supabase Vault; **Telegram session encrypted at rest** (AES-GCM with `SESSION_ENC_KEY`).
- **Passwords**: argon2id (or bcrypt cost 12) for admins.
- **Audit logs** for all admin actions; **env validation** at boot (Zod over `process.env`) — fail fast if missing.
- Least-privilege DB role for the API; separate read role for analytics.

---

## 12. Deployment Architecture

| Component | Host | Notes |
|---|---|---|
| Frontend | **Vercel** | Edge/SSG, auto preview deploys per PR |
| API | **Render** (web service) | autoscale, `/health` check |
| Telegram worker | **Render** (background worker) | always-on, 1+ instances |
| Database | **Supabase** PostgreSQL | connection pooling (PgBouncer) |
| Redis | **Upstash** | serverless, used by BullMQ |

`.env` per service from `.env.example`. Migrations run on deploy via release command `prisma migrate deploy`.

---

## 13. Folder Structure (monorepo)

```
surfshark-platform/                 (pnpm + turborepo)
├─ apps/
│  ├─ web/                          Next.js 15 frontend
│  ├─ api/                          NestJS backend
│  │  └─ src/{activation,license,admin,telegram,common,health}/
│  └─ telegram-worker/              GramJS BullMQ consumer
│     └─ src/worker.ts
├─ packages/
│  └─ shared/                       Zod schemas + TS types (FE+BE+worker)
├─ prisma/                          schema.prisma + migrations
├─ scripts/                         seed.ts, gen-keys.ts
├─ .github/workflows/ci.yml
├─ docker-compose.yml               local: postgres + redis
├─ turbo.json  pnpm-workspace.yaml  package.json
└─ docs/DELIVERABLES.md
```
(Code files for `prisma`, `apps/api`, `apps/telegram-worker`, `packages/shared`, CI, compose, env are in this bundle.)

---

## 14. CI/CD Pipeline (GitHub Actions)

`.github/workflows/ci.yml` (real file): on PR → install (pnpm cache) → typecheck → lint → test → build (turbo). On merge to `main` → `prisma migrate deploy` → deploy API+worker (Render deploy hook) → Vercel auto-deploys web → post-deploy `/health` check → rollback on failure (Render keeps previous image; redeploy prior commit).

Env validation step runs the shared env Zod schema before deploy. Auto preview environments per PR (Vercel + Render preview).

---

## 15. MVP Roadmap (≈2 weeks)
1. Prisma schema + migrations + seed.
2. `POST /activate` (sync mock of bot) + `GET /status`.
3. Landing + Activate + Status pages.
4. Admin login + Keys CRUD + generate + CSV.
5. Real GramJS worker + queue.
6. Deploy to Vercel/Render/Supabase/Upstash.

## 16. Production Roadmap (≈4–6 weeks)
Hardening: full rate-limit/throttle matrix, audit logs, session encryption, DLQ + alerting, dashboard charts & logs streams, e2e tests (Playwright), load test, Lighthouse ≥95, observability (Sentry + pino + uptime), backups & PITR on Supabase, runbooks.

## 17. Scaling Roadmap
- Multiple Telegram sessions in a **session pool** + round-robin to raise throughput.
- Horizontal worker scaling (BullMQ supports many workers on one queue).
- Read replicas / Supabase pooler for DB; cache hot reads in Redis.
- Shard queues by region; priority queue for paid tiers.
- Move to event-driven status via SSE/WebSocket; CDN for static.

---

## 18. Cost Estimation (monthly, early stage)

| Service | Plan | Est. cost |
|---|---|---|
| Vercel | Hobby→Pro | $0–20 |
| Render API | Starter | $7 |
| Render worker | Starter | $7 |
| Supabase | Free→Pro | $0–25 |
| Upstash Redis | Pay-as-you-go | $0–10 |
| Domain | — | ~$1 |
| **Total** | | **~$15–70 / mo** |
Scales mainly with worker instances + DB tier as volume grows.

## 19. Risk Analysis

| Risk | Impact | Mitigation |
|---|---|---|
| Telegram session expires / ban | activations stop | session pool, health alerts, quick re-auth runbook, encrypted backup session |
| FloodWait / rate limits | delays | token-bucket limiter, backoff, queue smoothing |
| Bot reply format changes | parse failures | robust regex + fallback + alert + versioned parser |
| Key brute-force / abuse | fraud | rate limit, IP throttle, format entropy (32^8), monitoring |
| Redis/DB outage | downtime | managed HA, retries, DLQ, health checks, graceful degradation |
| Secret leakage | breach | env-only secrets, encryption at rest, rotation policy, audit |
| Double activation race | data integrity | DB transaction + unique constraint + idempotent jobId |

## 20. Complete Development Plan
**Phase 0** repo, CI, env schema, infra accounts.
**Phase 1** DB + Prisma + seed.
**Phase 2** API activate/status + shared Zod.
**Phase 3** frontend public flow.
**Phase 4** admin (auth, keys, dashboard, logs, settings, audit).
**Phase 5** GramJS worker + queue + DLQ + error handling.
**Phase 6** security hardening + observability + tests.
**Phase 7** deploy + health + rollback + load test.
**Phase 8** scale (session pool, replicas) as volume dictates.

Definition of done per phase: typed, tested, lint-clean, deployed to preview, health-green.
