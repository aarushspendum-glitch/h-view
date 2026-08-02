# Migrations

There's no automated migration runner -- Supabase schema changes are applied
manually via the SQL editor. This folder exists so schema changes are
tracked in git and reviewable, instead of living only in whatever state the
live database happens to be in.

## Convention

- Files are numbered sequentially: `0001_description.sql`, `0002_description.sql`, ...
- Each file is idempotent where practical (`IF NOT EXISTS` / `IF EXISTS` guards)
  so re-running an already-applied migration against a database that's already
  up to date is a safe no-op, not an error.
- Apply a new migration by pasting its contents into the Supabase SQL editor
  and running it, then commit the file. Do not edit an already-applied
  migration file after the fact -- add a new one instead.
