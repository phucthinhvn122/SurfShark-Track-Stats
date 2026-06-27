-- Migration: device-code login flow
-- Replaces the license-key activation model with a 6-character device code.
-- The user POSTs { deviceCode } to /login; the worker sends `/login <code>`
-- to the Surfshark bot and writes the outcome to activations.
--
-- Backward compatible: existing rows (with license_id/username) keep their
-- data; license_id/username are now nullable so new device-code rows can omit
-- them. The FK is rewritten to ON DELETE SET NULL so license deletion does
-- not erase the historical login row.

-- 1. Relax NOT NULL on legacy columns
ALTER TABLE "activations" ALTER COLUMN "license_id" DROP NOT NULL;
ALTER TABLE "activations" ALTER COLUMN "username"     DROP NOT NULL;

-- 2. Add device-code columns
ALTER TABLE "activations" ADD COLUMN "device_code"  TEXT;
ALTER TABLE "activations" ADD COLUMN "session_meta" JSONB;

-- 3. Indexes (for /admin/users queries and dashboard rollups)
CREATE INDEX "activations_device_code_idx"       ON "activations"("device_code");
CREATE INDEX "activations_created_at_result_idx" ON "activations"("created_at","result");

-- 4. FK rewrite: keep history when a license row is deleted
ALTER TABLE "activations" DROP CONSTRAINT "activations_license_id_fkey";
ALTER TABLE "activations" ADD  CONSTRAINT "activations_license_id_fkey"
  FOREIGN KEY ("license_id") REFERENCES "licenses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
