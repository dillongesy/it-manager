-- Portal — local user accounts on a device (from ConnectWise RMM)
-- Migration 057
--
-- ConnectWise RMM's asset inventory lists each machine's local user accounts. The
-- ConnectWise import keeps the enabled, non-built-in ones here so a tech can see at a
-- glance who has an account on a PC and who's an administrator:
--   [{ "username": "Dana", "admin": true }, { "username": "Casey", "admin": false }]
--
-- RMM-owned: refreshed on every import, read-only in the Portal UI (the device form
-- never sends it, so an edit can't wipe it). No passwords — those stay in credentials.

ALTER TABLE customer_devices
  ADD COLUMN IF NOT EXISTS local_accounts JSONB NOT NULL DEFAULT '[]'::jsonb;
