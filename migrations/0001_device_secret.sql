-- Phase 1: device-to-cloud auth
-- Devices authenticate with a per-device secret (scrypt-hashed like passwords),
-- sent as the x-device-key header on every POST to /api/data.
-- Nullable so existing devices keep working until re-provisioned with a secret.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_secret_hash text;
