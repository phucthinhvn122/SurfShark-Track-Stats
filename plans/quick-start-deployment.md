# Quick Start - Deploy Miễn Phí 🚀

## TL;DR

Deploy toàn bộ stack miễn phí trong ~30 phút:

1. **Supabase** (2 phút) → Copy DATABASE_URL + DIRECT_URL
2. **Upstash** (2 phút) → Copy REDIS_URL  
3. **Telegram** (5 phút) → Generate TG_SESSION
4. **Render** (10 phút) → Deploy backend, set env vars
5. **Vercel** (5 phút) → Deploy frontend
6. **GitHub** (5 phút) → Configure secrets + enable keep-alive

---

## Prerequisites

- [ ] GitHub account + repo pushed
- [ ] Telegram account (phone number)
- [ ] Node 20 + pnpm installed locally

---

## 1. Supabase (Database)

```bash
# 1. Tạo project: https://supabase.com/dashboard
# 2. Region: Singapore
# 3. Copy connection strings:
#    - Transaction pooler (6543) → DATABASE_URL
#    - Session mode (5432) → DIRECT_URL

# 4. Run migrations locally:
$env:DATABASE_URL="postgresql://..."
$env:DIRECT_URL="postgresql://..."
pnpm exec prisma migrate deploy
pnpm db:seed  # admin/admin123
```

---

## 2. Upstash (Redis)

```bash
# 1. Create: https://console.upstash.com
# 2. Region: ap-southeast-1 (Singapore)
# 3. Copy Redis URL (TLS) → REDIS_URL
```

---

## 3. Telegram Session

```bash
# 1. Get credentials: https://my.telegram.org
# 2. Generate session:
$env:TG_API_ID="your_id"
$env:TG_API_HASH="your_hash"
pnpm --filter @surfshark/telegram-worker session

# 3. Login qua phone + code
# 4. Copy StringSession → TG_SESSION
```

---

## 4. Render (Backend)

1. https://dashboard.render.com → **New** → **Blueprint**
2. Connect GitHub repo
3. Service tự động tạo từ [`render.yaml`](../render.yaml)
4. **Environment Variables**:
   ```
   DATABASE_URL=...
   DIRECT_URL=...
   REDIS_URL=...
   TG_API_ID=...
   TG_API_HASH=...
   TG_SESSION=...
   BOT_USERNAME=@SurfsharkBot
   WORKER_CONCURRENCY=5
   WEB_ORIGIN=https://your-app.vercel.app  # Update sau
   ```
5. Deploy → Copy URL → `API_URL`

---

## 5. Vercel (Frontend)

1. https://vercel.com/dashboard → **New Project**
2. Import repo → Root: `apps/web`
3. **Environment Variable**:
   ```
   NEXT_PUBLIC_API_URL=https://surfshark-combined.onrender.com
   ```
4. Deploy → Copy URL
5. **Update Render**: Set `WEB_ORIGIN` = Vercel URL → Redeploy

---

## 6. GitHub Secrets (CI/CD)

Repo Settings → Secrets → Add:

```
DATABASE_URL=...
DIRECT_URL=...
API_URL=https://surfshark-combined.onrender.com
JWT_SECRET=<random-32-chars>
SESSION_ENC_KEY=<random-32-chars>
RENDER_DEPLOY_HOOK=https://api.render.com/deploy/srv-xxx?key=yyy
```

**Get Deploy Hook**: Render service → Settings → Deploy Hook → Create

---

## 7. Test Everything

```bash
# Backend health
curl https://surfshark-combined.onrender.com/health

# Frontend
open https://your-app.vercel.app

# Admin panel
open https://your-app.vercel.app/admin/login
# admin / admin123
```

---

## Keep-Alive Status

GitHub Actions workflow [`keep-alive.yml`](../.github/workflows/keep-alive.yml) tự động:
- Ping API mỗi 10 phút
- Giữ Render + Supabase active
- Check: Repo → Actions tab

---

## Cost Breakdown

| Service | Plan | Cost |
|---------|------|------|
| Vercel | Free | $0 |
| Render | Free | $0 |
| Supabase | Free | $0 |
| Upstash | Free | $0 |
| GitHub Actions | Free | $0 |
| **TOTAL** | | **$0/month** |

---

## Limitations

- **Render**: Sleeps sau 15 phút → Cold start 30-60s (mitigated by keep-alive)
- **Supabase**: 500MB database → ~10K users
- **Upstash**: 10K commands/day → Moderate traffic
- **Bandwidth**: Vercel 100GB/month → ~1M requests

---

## Troubleshooting

### Render không start?
→ Check logs, verify env vars

### CORS error?
→ Update `WEB_ORIGIN` trên Render = Vercel URL, redeploy

### Telegram không connect?
→ Re-generate session: `pnpm --filter @surfshark/telegram-worker session`

### Keep-alive failed?
→ Check `API_URL` secret trong GitHub, verify health endpoint

---

## Next Steps

Sau khi deploy thành công:

1. [ ] Đổi admin password
2. [ ] Add license keys thật vào DB
3. [ ] Monitor usage (Supabase, Upstash dashboards)
4. [ ] Setup alerts cho resource limits
5. [ ] Consider upgrade khi traffic tăng

---

## Scaling Path

Khi cần upgrade (traffic cao hơn):

1. **Render Starter** ($7/month) → No sleep, instant response
2. **Supabase Pro** ($25/month) → 8GB DB, daily backups
3. **Upstash Pro** → More Redis commands
4. **Multiple Telegram sessions** → Higher throughput

---

## Support

- Full guide: [`free-tier-deployment-plan.md`](./free-tier-deployment-plan.md)
- Deployment docs: [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md)
- Deploy script: [`scripts/deploy-free.ps1`](../scripts/deploy-free.ps1)

**Ready to deploy! 🎉**
