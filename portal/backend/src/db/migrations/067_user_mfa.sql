-- Portal - two-factor authentication (TOTP)
--
--   totp_secret      the user's TOTP secret, encrypted with ENCRYPTION_KEY; NULL = not enrolled
--   totp_pending     a secret shown during enrollment, until the first code confirms it
--   totp_enabled_at  when 2FA was turned on
--   totp_last_step   the last accepted 30-second time step, so a code works only once
--   totp_recovery    SHA-256 hashes of the unused recovery codes
--
-- The policy (off / optional / required) is the app_settings key 'security:mfa'.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret     TEXT,
  ADD COLUMN IF NOT EXISTS totp_pending    TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS totp_last_step  BIGINT,
  ADD COLUMN IF NOT EXISTS totp_recovery   JSONB NOT NULL DEFAULT '[]';
