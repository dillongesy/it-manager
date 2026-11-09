-- Migration 008 - branding pushed from the Portal over the one-way bridge.
-- The Field App never fetches branding itself; the Portal PUTs it to
-- /api/service/branding whenever an admin changes it (and on Portal start-up).

CREATE TABLE IF NOT EXISTS app_settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branding_assets (
  kind        VARCHAR(40)  PRIMARY KEY,
  mime        VARCHAR(100) NOT NULL,
  data        BYTEA        NOT NULL,
  sha256      CHAR(64)     NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
