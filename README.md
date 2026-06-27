# Surfshark VPN Activation Platform

Production-ready starter monorepo. Users activate a Surfshark VPN device with **no signup / no login** — just a 6-character device code (e.g. `ABCDEF`). The website is a gateway to a **server-side Telegram automation service**; users never touch the bot.

```
User → Next.js (Vercel) → NestJS API (Render) → BullMQ/Redis (Upstash)
     → Telegram worker (GramJS user session) → Surfshark bot → DB (Supabase) → User
```

## What's in this bundle

```
docs/DELIVERABLES.md              ← all 20 deliverables (architecture, roadmaps, cost, risk…)
prisma/schema.prisma              ← 6 tables + enums + indexes
packages/shared/src/index.ts      ← Zod schemas + types shared by FE/BE/worker
apps/api/src/
  main.ts, app.module.ts          ← bootstrap: Helmet, CORS, env validation, throttler
  activation/                     ← POST /activate, GET /status (async, queue-backed)
  license/license.service.ts      ← license state machine (unused→active→expired, ban/extend…)
  admin/                          ← JWT login, key actions, dashboard, audit logs
  telegram/activation-queue.service.ts  ← BullMQ producer
  health/health.controller.ts     ← /health (db + redis + session)
apps/telegram-worker/src/
  worker.ts                       ← GramJS consumer: send → await reply → parse → commit → DLQ
  generate-session.ts             ← one-time StringSession generator
scripts/seed.ts                   ← first admin + demo keys
.github/workflows/ci.yml          ← build/test → migrate → deploy → health check
docker-compose.yml                ← local Postgres + Redis
.env.example                      ← every required variable
```

apps/web/                         ← Next.js 15 frontend (real code)
  app/page.tsx                    ← landing (Server Component, SEO)
  app/login/page.tsx              ← RHF + Zod device-code form
  app/activate/page.tsx           ← legacy alias (permanentRedirect → /login)
  app/status/[requestId]/page.tsx ← React Query polling: processing/success/failed
  app/admin/(login|dashboard|keys|users|logs|settings)/ ← JWT admin panel
  lib/api.ts  hooks/queries.ts    ← typed API client + React Query hooks
apps/api/test/                    ← Jest unit tests (license state machine, activation)
packages/shared/test/             ← schema validation tests
apps/web/e2e/                     ← Playwright e2e (activate happy-path + validation)

> A standalone **interactive HTML/CSS demo** of the full UI is also delivered separately as `surfshark_activation_demo.html`.

## Quick start (local)

```bash
pnpm install
docker compose up -d                 # Postgres + Redis
cp .env.example .env                 # fill in values
pnpm db:generate && pnpm db:migrate  # create tables
pnpm db:seed                         # admin: admin / admin123  + demo keys

# generate a Telegram user session (once), paste into .env TG_SESSION
pnpm --filter @surfshark/telegram-worker session

pnpm dev                             # api + worker + web
```

## Activation flow (async, < 500ms HTTP)
1. `POST /login` accepts `{ deviceCode }` (6 chars, A–Z0–9), writes a `pending` activation row, enqueues a BullMQ job → returns `{ requestId, state: "processing" }`.
2. Worker sends `/login <code>` to the Surfshark bot, awaits the reply (timeout 25s), parses it (`success|failed|invalid|expired|banned`), updates the activation row, caches the result in Redis.
3. Frontend polls `GET /status/:requestId` until `success` / `failed`.

## Deploy
Vercel (web) · Render (api + worker) · Supabase (Postgres) · Upstash (Redis). Blueprint in `render.yaml`, web config in `apps/web/vercel.json`. CI runs migrations and a post-deploy health check; Render keeps the previous image for rollback.

**Full step-by-step deploy guide: `docs/DEPLOYMENT.md`.**

## Documentation
- `docs/DELIVERABLES.md` — complete architecture, API spec, security design, 3 roadmaps, cost estimate, risk analysis (all 20 deliverables).
- `docs/DEPLOYMENT.md` — Supabase + Upstash + Render + Vercel + CI/CD setup, post-deploy checklist, rollback & scaling.

## Status — project complete
| Layer | Status |
|---|---|
| Prisma schema + seed | ✅ |
| API: activation + status | ✅ |
| API: admin (auth, keys CRUD, dashboard, users, logs, settings, CSV export) | ✅ |
| Telegram worker (GramJS, retry, FloodWait, DLQ) | ✅ |
| Frontend public (landing, login, status, error, 404) | ✅ |
| Frontend admin (login, shell, dashboard, keys, users, logs, settings) | ✅ |
| Security (Helmet, CORS, throttle, Zod, argon2, AES-GCM session, audit) | ✅ |
| Tests (unit + Playwright e2e) | ✅ |
| CI/CD + deploy configs + docs | ✅ |
| Interactive HTML/CSS demo | ✅ |
