# Kế Hoạch Deploy Miễn Phí - Surfshark Activation Platform

## Tổng Quan

Dự án của bạn đã được cấu hình sẵn để deploy trên các nền tảng miễn phí. Kiến trúc sử dụng:

- **Frontend**: Vercel (miễn phí)
- **Backend**: Render (miễn phí, combined API + Worker)
- **Database**: Supabase PostgreSQL (miễn phí)
- **Cache/Queue**: Upstash Redis (miễn phí)
- **CI/CD**: GitHub Actions (miễn phí)

```mermaid
graph LR
    A[User] --> B[Vercel - Next.js]
    B --> C[Render - NestJS API]
    C --> D[Upstash Redis]
    C --> E[Supabase PostgreSQL]
    C --> F[Telegram Worker]
    F --> G[Telegram Bot]
    H[GitHub Actions] --> C
    H --> I[Keep-Alive Every 10min]
```

## Free Tier Limitations & Workarounds

### Render Free Tier
- **RAM**: 512MB
- **Hours**: 750 hours/month (đủ cho 1 service 24/7)
- **Sleep**: Tự động ngủ sau 15 phút không hoạt động
- **Cold Start**: ~30-60 giây để wake up
- **Workaround**: GitHub Actions keep-alive workflow (ping mỗi 10 phút)

### Vercel Free Tier
- **Bandwidth**: 100GB/tháng
- **Requests**: Unlimited
- **Build Time**: 6000 phút/tháng
- **Không có sleep**: Luôn online, cold start ~1 giây

### Supabase Free Tier
- **Database**: 500MB storage
- **Bandwidth**: 2GB/tháng
- **Pause**: Tự động pause sau 7 ngày không hoạt động
- **Connections**: 60 concurrent connections (pooled)
- **Workaround**: Keep-alive workflow cũng giữ DB active

### Upstash Free Tier
- **Commands**: 10,000 commands/ngày (~7 commands/phút)
- **Storage**: 256MB
- **Connections**: 100 concurrent
- **Workaround**: Optimize Redis usage, use TTL wisely

---

## Chi Tiết Deployment Steps

### Step 1: Chuẩn Bị Repository

**Mục tiêu**: Push code lên GitHub và đảm bảo cấu trúc đúng

**Actions**:
1. Push toàn bộ code lên GitHub repository
2. Đảm bảo branch `main` là branch chính
3. Kiểm tra files quan trọng có đầy đủ:
   - [`render.yaml`](../render.yaml) - Render Blueprint config
   - [`vercel.json`](../vercel.json) - Vercel config
   - [`.env.example`](../.env.example) - Template cho environment variables
   - [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) - CI/CD pipeline
   - [`.github/workflows/keep-alive.yml`](../.github/workflows/keep-alive.yml) - Keep-alive workflow

**Verification**:
```bash
git remote -v
git branch --show-current  # should be "main"
```

---

### Step 2: Thiết Lập Supabase (PostgreSQL)

**Mục tiêu**: Tạo database miễn phí trên Supabase

**Actions**:
1. Truy cập https://supabase.com/dashboard
2. Click **New Project**
   - Organization: Tạo mới hoặc chọn có sẵn
   - Name: `surfshark-db` (hoặc tên bạn muốn)
   - Database Password: Tạo password mạnh (lưu lại)
   - Region: **Singapore** (gần Render region)
   - Plan: **Free** (mặc định)
3. Đợi ~2 phút để project provision
4. Vào **Project Settings** → **Database**
5. Copy **Connection Strings**:
   - **Transaction pooler** (port 6543, có `?pgbouncer=true`)
     ```
     postgresql://postgres.[project-ref]:[password]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true
     ```
     → Lưu làm `DATABASE_URL`
   
   - **Session mode** (port 5432, không có pgbouncer)
     ```
     postgresql://postgres.[project-ref]:[password]@db.[project-ref].supabase.co:5432/postgres
     ```
     → Lưu làm `DIRECT_URL`

**Run Migrations Locally** (optional, có thể để CI/CD làm):
```bash
# Trong terminal, set env vars tạm thời:
$env:DATABASE_URL="postgresql://..." 
$env:DIRECT_URL="postgresql://..."

# Chạy migrations
pnpm exec prisma migrate deploy

# Seed dữ liệu mẫu (admin user + demo keys)
pnpm db:seed
```

**Credentials Created**:
- Admin user: `admin` / `admin123`
- 2 demo license keys (unused)

**Verification**:
```bash
# Test connection
pnpm exec prisma db push --skip-generate
```

---

### Step 3: Thiết Lập Upstash (Redis)

**Mục tiêu**: Tạo Redis instance miễn phí cho queue và cache

**Actions**:
1. Truy cập https://console.upstash.com
2. Click **Create Database**
   - Name: `surfshark-redis`
   - Type: **Regional**
   - Region: **ap-southeast-1** (Singapore)
   - Eviction: **No eviction** (recommended for queue)
   - Plan: **Free**
3. Vào database vừa tạo
4. Copy **Redis URL** (TLS enabled, dạng `rediss://...`)
   ```
   rediss://default:[password]@[region]-[id].upstash.io:6379
   ```
   → Lưu làm `REDIS_URL`

**Verification** (optional):
```bash
# Install redis-cli or use Upstash web CLI
redis-cli -u "rediss://..." PING
# Should return: PONG
```

---

### Step 4: Tạo Telegram Session (One-time Setup)

**Mục tiêu**: Generate StringSession để worker có thể login vào Telegram

**Prerequisites**:
- Telegram account (số điện thoại)
- Telegram API credentials từ https://my.telegram.org

**Get API Credentials**:
1. Truy cập https://my.telegram.org/auth
2. Login bằng số điện thoại Telegram của bạn
3. Vào **API development tools**
4. Tạo app mới:
   - App title: `Surfshark Activation`
   - Short name: `surfshark`
   - Platform: **Other**
5. Copy:
   - **App api_id** → `TG_API_ID`
   - **App api_hash** → `TG_API_HASH`

**Generate Session**:
```bash
# Set env vars trong terminal
$env:TG_API_ID="your_api_id"
$env:TG_API_HASH="your_api_hash"

# Run session generator
pnpm --filter @surfshark/telegram-worker session
```

**Kết quả**:
- Script sẽ hỏi số điện thoại
- Nhập mã xác nhận từ Telegram
- Nếu có 2FA, nhập password
- Script sẽ in ra **StringSession** (dạng string dài ~350 ký tự)
  ```
  1AQAOMTQ5LjE1NC4xNjcuNTEBuwW...
  ```
  → Copy toàn bộ string, lưu làm `TG_SESSION`

**Security Note**: 
- StringSession này cấp quyền full access vào Telegram account
- Không share hoặc commit vào Git
- Có thể mã hóa trong admin settings page sau khi deploy

---

### Step 5: Deploy Backend lên Render

**Mục tiêu**: Deploy combined service (API + Worker) lên Render free tier

**Actions**:

1. **Truy cập Render Dashboard**
   - https://dashboard.render.com
   - Login/Sign up (free account)

2. **Create Blueprint**
   - Click **New** → **Blueprint**
   - Connect GitHub repository
   - Chọn repo: `surfshark-platform`
   - Render sẽ tự động detect [`render.yaml`](../render.yaml)
   - Click **Apply**

3. **Render sẽ tạo 1 service**:
   - `surfshark-combined` (Web Service)
   - Region: Singapore
   - Plan: Free
   - Build Command: `pnpm render:build`
   - Start Command: `pnpm render:start` (chạy [`scripts/start-combined.js`](../scripts/start-combined.js))

4. **Configure Environment Variables**
   - Trong service settings, vào **Environment**
   - Add các env vars sau (đã lưu từ các bước trước):
   
   ```bash
   DATABASE_URL=postgresql://postgres.[project-ref]:[password]@...
   DIRECT_URL=postgresql://postgres.[project-ref]:[password]@...
   REDIS_URL=rediss://default:[password]@...
   TG_API_ID=your_api_id
   TG_API_HASH=your_api_hash
   TG_SESSION=your_string_session
   BOT_USERNAME=@SurfsharkBot
   WORKER_CONCURRENCY=5
   LOG_LEVEL=info
   PORT=3001
   WEB_ORIGIN=https://your-app.vercel.app  # Sẽ update sau step 6
   JWT_SECRET=  # Auto-generated by Render
   SESSION_ENC_KEY=  # Auto-generated by Render
   ```

5. **Manual Deploy** (first time)
   - Click **Manual Deploy** → **Deploy latest commit**
   - Đợi ~3-5 phút build complete
   - Check logs để đảm bảo không có error

6. **Copy Service URL**
   - Render sẽ assign URL: `https://surfshark-combined.onrender.com`
   - Lưu URL này làm `API_URL`

**Verification**:
```bash
# Test health endpoint
curl https://surfshark-combined.onrender.com/health

# Expected response:
{
  "status": "ok",
  "checks": {
    "db": "ok",
    "redis": "ok",
    "session": "ok"
  }
}
```

---

### Step 6: Deploy Frontend lên Vercel

**Mục tiêu**: Deploy Next.js frontend lên Vercel

**Actions**:

1. **Truy cập Vercel Dashboard**
   - https://vercel.com/dashboard
   - Login/Sign up (free account)
   - Connect GitHub account

2. **Import Project**
   - Click **Add New** → **Project**
   - Import từ GitHub: chọn repo `surfshark-platform`
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `apps/web`
   - Build Settings (auto-detected từ [`vercel.json`](../vercel.json)):
     - Build Command: `pnpm exec prisma generate && pnpm --filter @surfshark/web build`
     - Output Directory: `apps/web/.next`
     - Install Command: `pnpm install --frozen-lockfile`

3. **Configure Environment Variables**
   - Trong project settings, vào **Environment Variables**
   - Add:
     ```
     NEXT_PUBLIC_API_URL=https://surfshark-combined.onrender.com
     ```
   - Apply to: **Production**, **Preview**, **Development**

4. **Deploy**
   - Click **Deploy**
   - Đợi ~2-3 phút build complete
   - Vercel sẽ assign URL: `https://surfshark-activate.vercel.app`

5. **Update Render WEB_ORIGIN**
   - Copy Vercel URL
   - Quay lại Render service settings
   - Update env var: `WEB_ORIGIN=https://surfshark-activate.vercel.app`
   - Click **Manual Deploy** để redeploy với CORS config mới

**Verification**:
- Truy cập Vercel URL
- Landing page nên load bình thường
- Test activation flow với demo key

---

### Step 7: Configure GitHub Secrets (CI/CD)

**Mục tiêu**: Setup GitHub Actions để auto-deploy và keep-alive

**Actions**:

1. **Vào GitHub Repository Settings**
   - Settings → Secrets and variables → Actions → **New repository secret**

2. **Add Secrets**:
   ```
   DATABASE_URL=postgresql://... (from Supabase)
   DIRECT_URL=postgresql://... (from Supabase)
   REDIS_URL=rediss://... (from Upstash)
   API_URL=https://surfshark-combined.onrender.com
   JWT_SECRET=<random-32-char-string>
   SESSION_ENC_KEY=<random-32-char-string>
   RENDER_DEPLOY_HOOK=<from-next-step>
   ```

3. **Get Render Deploy Hook**:
   - Trong Render service settings
   - Vào **Settings** → **Deploy Hook**
   - Click **Create Deploy Hook**
   - Name: `GitHub CI/CD`
   - Copy URL: `https://api.render.com/deploy/srv-xxx?key=yyy`
   - Paste vào GitHub Secret `RENDER_DEPLOY_HOOK`

**What This Enables**:
- [`ci.yml`](../.github/workflows/ci.yml): Auto-deploy on push to main
- [`keep-alive.yml`](../.github/workflows/keep-alive.yml): Ping API every 10 minutes

---

### Step 8: Enable Keep-Alive Workflow

**Mục tiêu**: Prevent Render free tier từ việc sleep sau 15 phút

**Why Important**:
- Render free tier sleep sau 15 phút không có request
- Cold start mất ~30-60 giây
- Keep-alive workflow ping mỗi 10 phút để giữ service luôn warm

**Actions**:

1. **Workflow Already Exists**
   - File [`keep-alive.yml`](../.github/workflows/keep-alive.yml) đã có sẵn
   - Chạy mỗi 10 phút: `cron: "*/10 * * * *"`
   - Ping endpoint: `GET {API_URL}/health`

2. **Enable Workflow** (nếu bị disabled):
   - Vào GitHub repo → Actions
   - Enable workflows nếu bị disabled

3. **Verify Keep-Alive is Running**:
   - Vào Actions tab
   - Xem workflow "Keep Alive" có chạy mỗi 10 phút không
   - Check logs để đảm bảo health check thành công

**Cost Analysis**:
- GitHub Actions free: 2000 phút/tháng
- Keep-alive: ~1 phút/ngày = 30 phút/tháng
- CI/CD: ~5 phút/deploy = 150 phút/tháng (30 deploys)
- **Total**: ~180 phút/tháng (còn dư 1820 phút)

---

### Step 9: Post-Deployment Testing

**Mục tiêu**: Verify toàn bộ hệ thống hoạt động

**Test Checklist**:

1. **Backend Health**:
   ```bash
   curl https://surfshark-combined.onrender.com/health
   # Check all 3 services: db, redis, session = "ok"
   ```

2. **Frontend Loading**:
   - Truy cập `https://surfshark-activate.vercel.app`
   - Landing page load nhanh (< 2s)
   - No console errors

3. **Activation Flow** (End-to-End):
   ```bash
   # Từ seeded data, có 2 demo keys (unused)
   # Test activation:
   POST https://surfshark-combined.onrender.com/activate
   {
     "username": "testuser",
     "licenseKey": "DEMO-KEY-1"
   }
   
   # Should return:
   {
     "requestId": "req_xxx",
     "state": "processing"
   }
   
   # Poll status:
   GET https://surfshark-combined.onrender.com/status/req_xxx
   # Wait for state: "success" or "failed"
   ```

4. **Admin Panel**:
   - Truy cập `https://surfshark-activate.vercel.app/admin/login`
   - Login: `admin` / `admin123`
   - Check dashboard có hiển thị stats
   - Check keys, users, logs pages

5. **Worker Logs**:
   - Vào Render service logs
   - Verify: "Telegram worker connected: true"
   - No error messages

---

### Step 10: Monitoring & Maintenance

**Free Monitoring Tools**:

1. **Render Dashboard**
   - Metrics: CPU, Memory, Response time
   - Logs: Real-time streaming
   - Alerts: Email on deploy success/failure

2. **Vercel Analytics** (free tier):
   - Page views, performance metrics
   - Web Vitals (LCP, FID, CLS)

3. **GitHub Actions**:
   - CI/CD status
   - Keep-alive workflow status
   - Email notifications on failure

4. **Supabase Dashboard**:
   - Database size, connections
   - Query performance
   - Table editor for manual inspection

5. **Upstash Console**:
   - Redis commands/day usage
   - Memory usage
   - Connection count

**Alerts to Setup** (manual monitoring):
- Supabase: Đến gần 500MB storage
- Upstash: Đến gần 10K commands/day
- Render: Service restart frequency cao
- GitHub Actions: Keep-alive workflow failures

---

## Alternative Free Hosting Options

Nếu bạn muốn explore các options khác:

### Backend Alternatives:
1. **Railway** (free trial → $5/month)
   - Pros: Better than Render free, no sleep
   - Cons: Không còn free tier vĩnh viễn
   
2. **Fly.io** (free tier)
   - Pros: 3 shared-cpu VMs miễn phí
   - Cons: Phức tạp hơn, cần Dockerfile

3. **Koyeb** (free tier)
   - Pros: Tương tự Render, có free tier
   - Cons: Limited regions

### Database Alternatives:
1. **Neon** (free tier)
   - Pros: Serverless Postgres, auto-pause
   - Cons: 3GB storage limit

2. **PlanetScale** (free tier)
   - Pros: MySQL, 5GB storage
   - Cons: Cần migrate từ Postgres

### Redis Alternatives:
1. **Redis Cloud** (free tier)
   - Pros: 30MB storage miễn phí
   - Cons: Ít hơn Upstash

---

## Optimization Tips for Free Tier

### Reduce Database Usage:
- Cache frequently accessed data in Redis
- Use connection pooling (already configured)
- Index optimization (already in schema)

### Reduce Redis Commands:
- Increase TTL cho cached data
- Batch operations where possible
- Monitor command count trong Upstash dashboard

### Reduce Build Minutes:
- Use Turborepo cache (already configured)
- Deploy only when necessary
- Use PR previews sparingly

### Handle Cold Starts:
- Keep-alive workflow (already implemented)
- Show loading state on frontend
- Consider paid tier nếu cần instant response

---

## Troubleshooting Common Issues

### Issue: Render service không start
**Solution**:
- Check logs trong Render dashboard
- Verify tất cả env vars đã set
- Test locally với same env vars

### Issue: Database connection failed
**Solution**:
- Verify DATABASE_URL format (có `?pgbouncer=true`)
- Check Supabase project có active không
- Test connection: `pnpm exec prisma db push`

### Issue: Redis connection failed
**Solution**:
- Verify REDIS_URL format (phải là `rediss://` với SSL)
- Check Upstash database có active không
- Test với redis-cli

### Issue: Telegram worker không connect
**Solution**:
- Verify TG_SESSION còn valid không (có thể expire)
- Re-generate session: `pnpm --filter @surfshark/telegram-worker session`
- Check TG_API_ID, TG_API_HASH đúng không

### Issue: Frontend không call được API (CORS error)
**Solution**:
- Verify WEB_ORIGIN trên Render = Vercel URL chính xác
- Redeploy Render service sau khi update WEB_ORIGIN
- Check browser console cho chi tiết error

### Issue: Keep-alive workflow failed
**Solution**:
- Check API_URL secret trong GitHub
- Verify health endpoint returns 200 OK
- Check Render service có running không

---

## Summary

Deployment này sử dụng **100% free tier** services:

| Service | Free Tier | Usage |
|---------|-----------|-------|
| Vercel | 100GB bandwidth | Frontend hosting |
| Render | 750 hours/month | Backend API + Worker |
| Supabase | 500MB DB | PostgreSQL database |
| Upstash | 10K commands/day | Redis cache/queue |
| GitHub Actions | 2000 min/month | CI/CD + Keep-alive |

**Total Cost**: $0/month

**Limitations**:
- Render sleeps sau 15 phút (mitigated by keep-alive)
- Cold start ~30-60s (acceptable cho use case này)
- 500MB database limit (đủ cho hàng nghìn users)
- 10K Redis commands/day (đủ cho moderate traffic)

**Scaling Path** (khi cần):
1. Upgrade Render to Starter ($7/month) → No sleep
2. Upgrade Supabase to Pro ($25/month) → 8GB DB, backups
3. Upgrade Upstash → More commands
4. Add more Telegram sessions → Higher throughput

Dự án của bạn đã sẵn sàng để deploy! 🚀
