-- Portal — printer scan/fax options
-- Migration 020
--
-- Printer devices can capture scan-to-folder / scan-to-email / fax settings.
-- Stored as one JSONB blob since the shape is printer-specific:
-- {
--   scan_to_folder: bool, scan_paths: [{ path, note }, …],
--   scan_to_email: bool, email_server, email_account, email_password_enc, email_notes,
--   has_fax: bool, fax_number
-- }
-- email_password_enc is AES-encrypted at rest (same as other secrets).

ALTER TABLE customer_devices
  ADD COLUMN IF NOT EXISTS printer_options JSONB NOT NULL DEFAULT '{}'::jsonb;
