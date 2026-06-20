-- Prisma initial migration (baseline). Created from prisma/schema.prisma.
-- Applies cleanly to an empty Postgres database; idempotent only at the table level
-- (run `prisma migrate deploy` on a fresh DB). Records itself in _prisma_migrations.

-- EnumType
CREATE TYPE "LicenseStatus" AS ENUM ('unused', 'active', 'expired', 'banned');

-- EnumType
CREATE TYPE "ActivationResult" AS ENUM ('pending', 'success', 'failed');

-- CreateTable
CREATE TABLE "licenses" (
    "id" TEXT NOT NULL,
    "license_key" TEXT NOT NULL,
    "username" TEXT,
    "status" "LicenseStatus" NOT NULL DEFAULT 'unused',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activations" (
    "id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "ip_address" TEXT,
    "country" TEXT,
    "device" TEXT,
    "result" "ActivationResult" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "request" TEXT,
    "response" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "telegram_session" TEXT,
    "bot_username" TEXT NOT NULL DEFAULT '@SurfsharkBot',
    "duration_days" INTEGER NOT NULL DEFAULT 30,
    "rate_limit_per_min" INTEGER NOT NULL DEFAULT 5,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "licenses_license_key_key" ON "licenses"("license_key");

-- CreateIndex
CREATE INDEX "licenses_status_idx" ON "licenses"("status");

-- CreateIndex
CREATE INDEX "licenses_expired_at_idx" ON "licenses"("expired_at");

-- CreateIndex
CREATE INDEX "licenses_username_idx" ON "licenses"("username");

-- CreateIndex
CREATE UNIQUE INDEX "activations_request_id_key" ON "activations"("request_id");

-- CreateIndex
CREATE INDEX "activations_license_id_idx" ON "activations"("license_id");

-- CreateIndex
CREATE INDEX "activations_created_at_idx" ON "activations"("created_at");

-- CreateIndex
CREATE INDEX "activations_result_created_at_idx" ON "activations"("result", "created_at");

-- CreateIndex
CREATE INDEX "telegram_logs_created_at_idx" ON "telegram_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");

-- CreateIndex
CREATE INDEX "audit_logs_admin_id_idx" ON "audit_logs"("admin_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "activations" ADD CONSTRAINT "activations_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- audit_logs.admin_id references admins.id; deletion of an admin with audit
-- history is blocked (RESTRICT) to preserve the audit trail.
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
