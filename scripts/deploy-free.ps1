# Deploy miễn phí: Supabase + Upstash + Render + Vercel
# Chạy: .\scripts\deploy-free.ps1
# Hoặc từng bước bên dưới.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "`n=== Surfshark Platform — Deploy Free Tier ===`n" -ForegroundColor Cyan

# --- Bước 1: Supabase (Postgres) ---
Write-Host "[1/5] SUPABASE — Database" -ForegroundColor Yellow
Write-Host @"
  1. Mở https://supabase.com/dashboard → New Project (Free)
  2. Region: Singapore (gần Render)
  3. Project Settings → Database → Connection string:
     - Transaction pooler (6543) → DATABASE_URL
     - Direct (5432) → DIRECT_URL
  4. Chạy migration:
     `$env:DATABASE_URL='...'; `$env:DIRECT_URL='...'; pnpm exec prisma migrate deploy
     pnpm db:seed
"@

if (-not $env:DATABASE_URL) {
  Write-Host "  ⚠ DATABASE_URL chưa set — bỏ qua migrate. Set env rồi chạy lại script.`n" -ForegroundColor DarkYellow
} else {
  Write-Host "  → Chạy migrate..." -ForegroundColor Green
  pnpm exec prisma migrate deploy
  if ($LASTEXITCODE -eq 0) { pnpm db:seed }
}

# --- Bước 2: Upstash (Redis) ---
Write-Host "[2/5] UPSTASH — Redis" -ForegroundColor Yellow
Write-Host @"
  1. Mở https://console.upstash.com → Create Database (Free)
  2. Region: ap-southeast-1 (Singapore)
  3. Copy Redis URL (TLS, dạng rediss://...) → REDIS_URL
  Hoặc CLI: npm i -g @upstash/cli && upstash auth login && upstash redis create --name surfshark --region ap-southeast-1
"@

# --- Bước 3: Render (API + Worker combined) ---
Write-Host "[3/5] RENDER — Backend" -ForegroundColor Yellow
Write-Host @"
  1. Mở https://dashboard.render.com → New → Blueprint
  2. Connect repo: https://github.com/phucthinhvn122/SurfShark-Track-Stats
  3. Blueprint dùng render.yaml (plan: free, region: singapore)
  4. Env vars (Settings → Environment):
     DATABASE_URL, DIRECT_URL, REDIS_URL, WEB_ORIGIN (URL Vercel sau bước 4)
     TG_API_ID, TG_API_HASH, TG_SESSION (từ: pnpm --filter @surfshark/telegram-worker session)
  5. Deploy hook: Settings → Deploy Hook → copy URL
  6. GitHub Secrets: RENDER_DEPLOY_HOOK, API_URL, DATABASE_URL, DIRECT_URL
"@

# --- Bước 4: Vercel (Frontend) ---
Write-Host "[4/5] VERCEL — Frontend" -ForegroundColor Yellow
$ApiUrl = $env:NEXT_PUBLIC_API_URL
if (-not $ApiUrl) {
  $ApiUrl = Read-Host "  Nhập Render API URL (vd: https://surfshark-combined.onrender.com) hoặc Enter để bỏ qua"
}

if ($ApiUrl) {
  $env:NEXT_PUBLIC_API_URL = $ApiUrl
  Write-Host "  → Deploy Vercel (apps/web)..." -ForegroundColor Green
  Set-Location "$Root\apps\web"
  if (-not (Test-Path ".vercel")) {
    npx vercel link --yes 2>$null
  }
  npx vercel env add NEXT_PUBLIC_API_URL production --force --yes 2>$null
  echo $ApiUrl | npx vercel env add NEXT_PUBLIC_API_URL production 2>$null
  npx vercel --prod --yes
  Set-Location $Root
  Write-Host "  ✓ Copy URL Vercel → set WEB_ORIGIN trên Render → redeploy Render`n" -ForegroundColor Green
} else {
  Write-Host "  Bỏ qua Vercel — chạy: cd apps/web && npx vercel --prod`n" -ForegroundColor DarkYellow
}

# --- Bước 5: Telegram session ---
Write-Host "[5/5] TELEGRAM — Session (một lần)" -ForegroundColor Yellow
Write-Host @"
  TG_API_ID + TG_API_HASH từ https://my.telegram.org
  Chạy: pnpm --filter @surfshark/telegram-worker session
  Paste TG_SESSION vào Render env vars
"@

Write-Host "`n=== Post-deploy checklist ===" -ForegroundColor Cyan
Write-Host "  curl `$API_URL/health"
Write-Host "  GitHub → Settings → Secrets: DATABASE_URL, DIRECT_URL, RENDER_DEPLOY_HOOK, API_URL"
Write-Host "  Workflow keep-alive.yml sẽ ping API mỗi 10 phút (giữ Render free tier sống)`n"
