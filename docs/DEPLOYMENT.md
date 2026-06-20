# Deployment Guide

Deploy targets: **Vercel** (web) · **Render** (API + Telegram worker) · **Supabase** (Postgres) · **Upstash** (Redis).

---

## 0. Prerequisites
- GitHub repo with this monorepo pushed to `main`.
- Accounts: Vercel, Render, Supabase, Upstash, and a Telegram account + API credentials from https://my.telegram.org (TG_API_ID, TG_API_HASH).
- `pnpm` and Node 20 locally.

---

## 1. Database — Supabase
1. Create a project → **Project Settings → Database**.
2. Copy two connection strings:
   - **Pooled** (port `6543`, `?pgbouncer=true`) → `DATABASE_URL`
   - **Direct** (port `5432`) → `DIRECT_URL`
3. Run migrations + seed locally (or via CI):
   ```bash
   pnpm exec prisma migrate deploy
   pnpm db:seed   # creates admin / admin123 + demo keys
   ```

## 2. Redis — Upstash
1. Create a Redis database (region close to Render, e.g. Singapore).
2. Copy the **`rediss://` TLS URL** → `REDIS_URL` (used by API + worker).

## 3. Telegram session (one-time)
```bash
TG_API_ID=... TG_API_HASH=... pnpm --filter @surfshark/telegram-worker session
```
Log in with the phone/code/2FA prompts. Copy the printed StringSession → `TG_SESSION`.
> Store it encrypted: paste into the admin **Settings** page (it is AES-GCM encrypted at rest), or set the env var directly on the worker.

## 4. Backend — Render (Blueprint)
1. Render → **New → Blueprint** → select the repo (uses `render.yaml`).
2. This provisions two services:
   - `surfshark-api` (web) with health check `/health`
   - `surfshark-telegram-worker` (background worker)
3. Fill the `sync: false` env vars in each service:
   - API: `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `WEB_ORIGIN` (your Vercel URL). `JWT_SECRET` + `SESSION_ENC_KEY` are auto-generated.
   - Worker: `DATABASE_URL`, `REDIS_URL`, `TG_API_ID`, `TG_API_HASH`, `TG_SESSION`.
4. Set each service's **Release Command**: `pnpm exec prisma migrate deploy`.
5. Note the API URL → use as `NEXT_PUBLIC_API_URL` for the frontend.

## 5. Frontend — Vercel
1. Vercel → **New Project** → import the repo.
2. **Root Directory**: `apps/web` (uses `apps/web/vercel.json`).
3. Env var: `NEXT_PUBLIC_API_URL` = your Render API URL.
4. Deploy. Copy the production URL and set it as `WEB_ORIGIN` on the Render API (for CORS), then redeploy the API.

## 6. CI/CD — GitHub Actions
`.github/workflows/ci.yml` already runs on PRs (typecheck/lint/test/build) and on `main` (migrate → trigger Render deploy hooks → health check). Add repo secrets:
`DATABASE_URL`, `DIRECT_URL`, `RENDER_API_DEPLOY_HOOK`, `RENDER_WORKER_DEPLOY_HOOK`, `API_URL`, `JWT_SECRET`, `SESSION_ENC_KEY`.
(Vercel auto-deploys via its own Git integration.)

---

## 7. Post-deploy checklist
- [ ] `GET <api>/health` returns `{ status: "ok", checks: { db, redis, session } }`.
- [ ] Frontend landing loads; `POST /activate` with a seeded unused key returns `202`.
- [ ] Worker logs show "Telegram worker connected: true".
- [ ] Admin login works (`admin` / your seed password) and key actions persist.
- [ ] Lighthouse on the landing page ≥ 95.

## 8. Rollback
- Render keeps the previous image — **Manual Deploy → previous commit** rolls back instantly.
- Vercel: promote a previous deployment from the dashboard.
- DB: Supabase PITR (Pro) for data recovery.

## 9. Scaling later
- Increase `WORKER_CONCURRENCY` and/or run multiple worker instances (BullMQ supports many workers per queue).
- Add a Telegram **session pool** (multiple `TG_SESSION`s round-robined) to raise throughput.
- Move DB to a larger Supabase tier + use the pooler; cache hot reads in Redis.
