-- Portal - Customer Detail Tables
-- Migration 002

-- --- Devices / Workstations --------------------------------------------------

CREATE TABLE customer_devices (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- 'workstation' | 'server' | 'printer' | 'network' | 'other'
  device_type         VARCHAR(20)  NOT NULL DEFAULT 'workstation',
  label               VARCHAR(255),
  assigned_to         VARCHAR(100),
  computer_name       VARCHAR(100),
  model               VARCHAR(255),
  service_tag         VARCHAR(100),
  processor           VARCHAR(255),
  ram                 VARCHAR(100),
  storage             VARCHAR(255),
  operating_system    VARCHAR(100),
  username            VARCHAR(100),
  password_enc        TEXT,
  admin_username      VARCHAR(100),
  admin_password_enc  TEXT,
  warranty_expires    DATE,
  apps_installed      TEXT,
  notes               TEXT,
  created_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_devices_customer ON customer_devices(customer_id);

-- --- Credentials -------------------------------------------------------------
-- Covers: domain admins, Microsoft/365, email, programs, cameras, printers/network,
--         Google/Apple accounts, database passphrases, security questions, etc.

CREATE TABLE customer_credentials (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- 'domain' | 'microsoft' | 'email' | 'program' | 'camera' | 'network' |
  -- 'google' | 'apple' | 'database' | 'security' | 'other'
  category      VARCHAR(20)  NOT NULL DEFAULT 'other',
  label         VARCHAR(255) NOT NULL,
  username      VARCHAR(255),
  password_enc  TEXT,
  url           TEXT,
  two_fa_note   TEXT,
  extra_notes   TEXT,
  sort_order    INTEGER      NOT NULL DEFAULT 0,
  created_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_credentials_customer ON customer_credentials(customer_id);
CREATE INDEX idx_customer_credentials_category ON customer_credentials(customer_id, category);

-- --- Camera Systems -----------------------------------------------------------

CREATE TABLE customer_camera_systems (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label          VARCHAR(255),
  channel_count  INTEGER,
  system_type    VARCHAR(20)  DEFAULT 'NVR',
  model          VARCHAR(255),
  serial_number  VARCHAR(100),
  ip_address     VARCHAR(50),
  username       VARCHAR(100),
  password_enc   TEXT,
  shared_with    TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_cameras_customer ON customer_camera_systems(customer_id);

-- --- How-To Guides ------------------------------------------------------------

CREATE TABLE customer_guides (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title       VARCHAR(255) NOT NULL,
  content     TEXT,
  created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_guides_customer ON customer_guides(customer_id);

-- --- File Attachments ---------------------------------------------------------

CREATE TABLE customer_files (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  stored_name    VARCHAR(255) NOT NULL,
  original_name  VARCHAR(255) NOT NULL,
  mime_type      VARCHAR(100),
  size_bytes     BIGINT,
  -- 'general' | 'contract' | 'diagram' | 'proposal' | 'export' | 'other'
  category       VARCHAR(20)  NOT NULL DEFAULT 'general',
  notes          TEXT,
  uploaded_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_files_customer ON customer_files(customer_id);
