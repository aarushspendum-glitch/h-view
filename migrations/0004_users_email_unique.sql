-- Phase 4: write-path integrity
-- register.js previously did a separate "does this email exist" SELECT
-- before inserting -- a TOCTOU race under concurrent requests. The fix relies
-- on the database enforcing uniqueness and the app catching the resulting
-- conflict, rather than trying to prevent the race in application code.
-- A unique index enforces this the same way a unique constraint would and
-- supports IF NOT EXISTS, so it's safe to re-run.

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (email);
