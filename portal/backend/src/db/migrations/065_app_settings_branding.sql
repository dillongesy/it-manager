-- Migration 065 - in-app configuration (replaces the per-integration .env variables)
--
-- app_settings     key/value JSON. Keys used:
--                    'branding'            company / product names, colors, print header
--                    'integration:<id>'    { enabled, values } - secret values are AES-256-GCM
--                                          encrypted with the master ENCRYPTION_KEY
--                    'system'              setup + recovery-secret reveal timestamps
-- branding_assets  uploaded images (logo, full logo, favicon, login background),
--                  served publicly so the login page and browser tab can use them.

CREATE TABLE IF NOT EXISTS app_settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by  UUID         REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS branding_assets (
  kind        VARCHAR(40)  PRIMARY KEY,
  mime        VARCHAR(100) NOT NULL,
  data        BYTEA        NOT NULL,
  sha256      CHAR(64)     NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by  UUID         REFERENCES users(id) ON DELETE SET NULL
);
