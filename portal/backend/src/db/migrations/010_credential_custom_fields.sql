-- Portal — customizable credential fields
-- Migration 010
--
-- A credential keeps its standard fields (username, password, url, 2FA, notes)
-- and gains an arbitrary list of custom fields so entries like an FQDN
-- ("dental.local", value only) or a practice-management system (login, customer
-- ID, support number, database password, security questions) can be captured
-- without abusing the notes box.
--
-- Stored shape: [{ "label": "...", "value": "...", "secret": true|false }, …]
-- Secret values are stored ENCRYPTED (same AES-256-GCM string format as passwords);
-- non-secret values are stored as plain text.

ALTER TABLE customer_credentials
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
