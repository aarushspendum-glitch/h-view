-- Phase 2: session lifecycle
-- Sessions previously had no server-side expiry -- a session row was valid
-- forever until an explicit logout. This adds a real TTL, checked by the
-- shared requireSession() helper on every lookup.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Backfill existing rows with a 30-day expiry from now so nothing currently
-- logged in gets silently kicked out the moment this migration runs.
UPDATE sessions SET expires_at = now() + interval '30 days' WHERE expires_at IS NULL;
