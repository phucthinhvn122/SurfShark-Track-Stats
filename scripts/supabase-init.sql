-- ============================================
-- Surfshark Platform — DB Init (IDEMPOTENT)
-- Chạy được nhiều lần, chỉ tạo những gì chưa có
-- Copy toàn bộ → Supabase SQL Editor → Ctrl+Enter
-- ============================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LicenseStatus') THEN
        CREATE TYPE "LicenseStatus" AS ENUM ('unused', 'active', 'expired', 'banned');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ActivationResult') THEN
        CREATE TYPE "ActivationResult" AS ENUM ('pending', 'success', 'failed');
    END IF;
END$$;

-- Tables
CREATE TABLE IF NOT EXISTS "licenses" (
    "id" TEXT NOT NULL, "license_key" TEXT NOT NULL, "username" TEXT,
    "status" "LicenseStatus" NOT NULL DEFAULT 'unused', "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3), "expired_at" TIMESTAMP(3),
    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "activations" (
    "id" TEXT NOT NULL, "license_id" TEXT NOT NULL, "request_id" TEXT NOT NULL,
    "username" TEXT NOT NULL, "ip_address" TEXT, "country" TEXT, "device" TEXT,
    "result" "ActivationResult" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "telegram_logs" (
    "id" TEXT NOT NULL, "action" TEXT NOT NULL, "request" TEXT,
    "response" TEXT, "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "admins" (
    "id" TEXT NOT NULL, "username" TEXT NOT NULL, "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "settings" (
    "id" INTEGER NOT NULL DEFAULT 1, "telegram_session" TEXT,
    "bot_username" TEXT NOT NULL DEFAULT '@SurfsharkBot',
    "duration_days" INTEGER NOT NULL DEFAULT 30,
    "rate_limit_per_min" INTEGER NOT NULL DEFAULT 5,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL, "admin_id" TEXT NOT NULL, "action" TEXT NOT NULL,
    "target" TEXT, "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- Indexes (IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS "licenses_license_key_key" ON "licenses"("license_key");
CREATE INDEX IF NOT EXISTS "licenses_status_idx" ON "licenses"("status");
CREATE INDEX IF NOT EXISTS "licenses_expired_at_idx" ON "licenses"("expired_at");
CREATE INDEX IF NOT EXISTS "licenses_username_idx" ON "licenses"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "activations_request_id_key" ON "activations"("request_id");
CREATE INDEX IF NOT EXISTS "activations_license_id_idx" ON "activations"("license_id");
CREATE INDEX IF NOT EXISTS "activations_created_at_idx" ON "activations"("created_at");
CREATE INDEX IF NOT EXISTS "activations_result_created_at_idx" ON "activations"("result", "created_at");
CREATE INDEX IF NOT EXISTS "telegram_logs_created_at_idx" ON "telegram_logs"("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "admins_username_key" ON "admins"("username");
CREATE INDEX IF NOT EXISTS "audit_logs_admin_id_idx" ON "audit_logs"("admin_id");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- Foreign Keys (add if not exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'activations_license_id_fkey') THEN
        ALTER TABLE "activations" ADD CONSTRAINT "activations_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'audit_logs_admin_id_fkey') THEN
        ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END$$;

-- ===================== SEED =====================
-- Admin: admin / admin123 (skip if exists)
INSERT INTO "admins" ("id", "username", "password_hash")
SELECT gen_random_uuid()::text, 'admin', '$argon2id$v=19$m=65536,t=3,p=4$n6UbGw+hNrpJQBk7CjFK2w$h6T/87+L6vx6VdmYrqJnmVSPCLiJ3R/Gt/Gu/rIHyd4'
WHERE NOT EXISTS (SELECT 1 FROM "admins" WHERE username = 'admin');

-- Settings (skip if exists)
INSERT INTO "settings" ("id", "bot_username", "duration_days", "rate_limit_per_min")
SELECT 1, '@SurfsharkBot', 30, 5
WHERE NOT EXISTS (SELECT 1 FROM "settings" WHERE id = 1);

-- Demo keys (skip if exists)
INSERT INTO "licenses" ("id", "license_key", "status")
SELECT gen_random_uuid()::text, k.key, k.st
FROM (VALUES ('VPN-A9X2-K8LM', 'unused'::"LicenseStatus"), ('VPN-7H3K-M2QP', 'unused'), ('VPN-DEAD-BEEF', 'banned')) AS k(key, st)
WHERE NOT EXISTS (SELECT 1 FROM "licenses" WHERE license_key = k.key);

-- Prisma migration table
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
SELECT gen_random_uuid()::text, 'init', now(), '20260620000000_init', 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20260620000000_init');

SELECT '✅ DB init complete!' AS result;
