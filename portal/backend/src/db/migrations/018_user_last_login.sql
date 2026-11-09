-- Portal - per-user last-login tracking
-- Migration 018

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;
