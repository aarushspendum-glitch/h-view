-- Phase 3: fleet data-path correctness
-- The admin view previously queried "last 100 readings globally" and deduped
-- client-side, which silently drops devices once fleet volume exceeds 100
-- recent rows. Denormalizing the latest reading onto `devices` itself makes
-- the admin/client views a single indexed SELECT on devices, independent of
-- total reading volume. Updated by api/data.js on every ingest.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_status text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_accel double precision;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_gyro double precision;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_temp double precision;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_accel_sigma double precision;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_gyro_sigma double precision;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_accel_base_mean double precision;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_accel_base_std double precision;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_gyro_base_mean double precision;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_gyro_base_std double precision;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_reading_at timestamptz;
