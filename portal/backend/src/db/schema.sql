-- Portal - Consolidated Production Schema
-- =============================================================================
-- This is the FULL schema as of migration 022, hand-reconciled from migrations
-- 001–022 into one idempotent file for a clean production deploy.
--
-- Two ways to stand up the Portal database:
--   A) Run the migration runner (preferred for an existing DB):  npm run migrate
--   B) Run THIS file once on a brand-new empty database, then mark all migrations
--      as applied so the runner won't re-run them:
--
--        psql -U portal -d portal -f src/db/schema.sql
--
--      (This file seeds schema_migrations 001–022 itself, so `npm run migrate`
--       afterward will report "up to date".)
--
-- Safe to re-run: every statement uses IF NOT EXISTS / ON CONFLICT.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- --- Users ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(50)  UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(100) NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'technician',   -- admin | technician | biller
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  last_login    TIMESTAMPTZ,                                  -- migration 018
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(64) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  is_revoked  BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash    ON refresh_tokens(token_hash) WHERE NOT is_revoked;

-- --- Customers -----------------------------------------------------------------
-- (migration 003 dropped the original `type` column; not present here.)
CREATE TABLE IF NOT EXISTS customers (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(255) NOT NULL,
  address               TEXT,
  city                  VARCHAR(100),
  state                 VARCHAR(50),
  zip                   VARCHAR(20),
  phone                 VARCHAR(50),
  notes                 TEXT,
  wan_ip                VARCHAR(50),    -- migration 009
  firewall_link         TEXT,           -- migration 009
  billing_contact_name  TEXT,           -- migration 027
  billing_contact_email TEXT,           -- migration 027
  billing_contact_phone TEXT,           -- migration 027
  is_active             BOOLEAN      NOT NULL DEFAULT true,
  created_by            UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_name   ON customers USING gin(to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(is_active);

-- Contacts - person OR (with the address fields from 009) a contact location.
CREATE TABLE IF NOT EXISTS customer_contacts (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  title        VARCHAR(100),
  phone        VARCHAR(50),
  email        VARCHAR(255),
  is_primary   BOOLEAN      NOT NULL DEFAULT false,
  notes        TEXT,
  address      VARCHAR(255),   -- migration 009
  city         VARCHAR(100),   -- migration 009
  state        VARCHAR(50),    -- migration 009
  zip          VARCHAR(20),    -- migration 009
  sort_order   INTEGER      NOT NULL DEFAULT 0,   -- migration 019
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer ON customer_contacts(customer_id);

-- Branch offices (migration 013 added a write route + business_name/wan_ip/firewall_link/updated_at)
CREATE TABLE IF NOT EXISTS customer_locations (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label                 VARCHAR(100),
  business_name         VARCHAR(255),   -- migration 013
  address               TEXT,
  city                  VARCHAR(100),
  state                 VARCHAR(50),
  zip                   VARCHAR(20),
  phone                 VARCHAR(50),
  wan_ip                VARCHAR(50),    -- migration 013
  firewall_link         TEXT,           -- migration 013
  notes                 TEXT,
  billing_contact_name  TEXT,           -- migration 027
  billing_contact_email TEXT,           -- migration 027
  billing_contact_phone TEXT,           -- migration 027
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()   -- migration 013
);

CREATE TABLE IF NOT EXISTS customer_billing_rates (
  id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID           NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label       VARCHAR(100)   NOT NULL,
  rate        NUMERIC(10, 2) NOT NULL,
  notes       TEXT,
  sort_order  INTEGER        NOT NULL DEFAULT 0,   -- migration 019
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- --- Devices (type-driven; migrations 002, 009, 014, 015) -----------------------
CREATE TABLE IF NOT EXISTS customer_devices (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- workstation | server | firewall | switch | printer | nas | network | other
  device_type         VARCHAR(20)  NOT NULL DEFAULT 'workstation',
  label               VARCHAR(255),
  assigned_to         VARCHAR(100),
  computer_name       VARCHAR(100),
  model               VARCHAR(255),
  service_tag         VARCHAR(100),
  processor           VARCHAR(255),
  ram                 VARCHAR(100),
  storage             VARCHAR(255),     -- legacy single-drive (kept; UI uses storage_drives)
  operating_system    VARCHAR(100),
  username            VARCHAR(100),
  password_enc        TEXT,
  admin_username      VARCHAR(100),
  admin_password_enc  TEXT,
  warranty_expires    DATE,
  apps_installed      TEXT,
  notes               TEXT,
  -- migration 009
  ip_address          VARCHAR(50),
  driver_url          TEXT,
  managed_by          VARCHAR(255),
  manager_email       VARCHAR(255),
  storage_drives      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  share_paths         JSONB        NOT NULL DEFAULT '[]'::jsonb,
  -- migration 014 (firewall/switch)
  manufacturer        VARCHAR(100),
  firmware_version    VARCHAR(100),
  serial_number       VARCHAR(100),
  internal_ips        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  external_ips        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  poe_type            VARCHAR(20),
  managed_switch      BOOLEAN,
  port_count          INTEGER,
  license_expires     DATE,
  -- migration 015 (ordering + VLANs + firewall rules)
  sort_order          INTEGER      NOT NULL DEFAULT 0,
  vlans               JSONB        NOT NULL DEFAULT '[]'::jsonb,
  firewall_rules      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  printer_options     JSONB        NOT NULL DEFAULT '{}'::jsonb,   -- migration 020
  created_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_devices_customer ON customer_devices(customer_id);

-- Per-customer device-type display order (migration 015)
CREATE TABLE IF NOT EXISTS customer_device_type_order (
  customer_id UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  device_type VARCHAR(20) NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (customer_id, device_type)
);

-- --- Credentials (migrations 002, 006, 010, 011) --------------------------------
CREATE TABLE IF NOT EXISTS customer_credentials (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  category      VARCHAR(255) NOT NULL DEFAULT 'other',   -- widened in migration 006
  label         VARCHAR(255) NOT NULL,
  username      VARCHAR(255),
  password_enc  TEXT,
  url           TEXT,
  two_fa_note   TEXT,
  extra_notes   TEXT,
  sort_order    INTEGER      NOT NULL DEFAULT 0,
  custom_fields JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- migration 010 (secret values AES-encrypted)
  created_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_credentials_customer ON customer_credentials(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_credentials_category ON customer_credentials(customer_id, category);

-- Per-customer credential-section display order (migration 011)
CREATE TABLE IF NOT EXISTS customer_credential_sections (
  customer_id UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  category    VARCHAR(255) NOT NULL,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  PRIMARY KEY (customer_id, category)
);

-- --- Camera systems (migration 002) + shared access (migration 005) -------------
CREATE TABLE IF NOT EXISTS customer_camera_systems (
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
  install_date    DATE,        -- migration 050
  system_location TEXT,        -- migration 050 — where the box physically sits
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_cameras_customer ON customer_camera_systems(customer_id);

-- Individual cameras on a system (migration 050)
CREATE TABLE IF NOT EXISTS customer_cameras (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_system_id UUID         NOT NULL REFERENCES customer_camera_systems(id) ON DELETE CASCADE,
  name             VARCHAR(255),
  channel          VARCHAR(20),
  ip_address       VARCHAR(50),
  mac_address      VARCHAR(50),
  manufacturer     VARCHAR(255),
  model            VARCHAR(255),
  serial_number    VARCHAR(100),
  camera_type      VARCHAR(30),
  resolution       VARCHAR(50),
  firmware         VARCHAR(100),
  connected_to     TEXT,
  install_date     DATE,
  username         VARCHAR(100),
  password_enc     TEXT,
  notes            TEXT,
  sort_order       INTEGER      NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_cameras_system ON customer_cameras(camera_system_id);

-- Camera shared-access entries (migration 005, supersedes 004's inline columns)
CREATE TABLE IF NOT EXISTS customer_camera_shared_access (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_system_id UUID         NOT NULL REFERENCES customer_camera_systems(id) ON DELETE CASCADE,
  label            VARCHAR(100) NOT NULL,   -- e.g. "Customer", "ABC Monitoring", "Owner"
  username         VARCHAR(100),
  password_enc     TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_camera_shared_camera ON customer_camera_shared_access(camera_system_id);

-- --- Guides (migration 002) -----------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_guides (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title       VARCHAR(255) NOT NULL,
  content     TEXT,
  created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_guides_customer ON customer_guides(customer_id);

-- --- Files & Proposals (migrations 002, 011, 012) -------------------------------
CREATE TABLE IF NOT EXISTS customer_files (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  stored_name    VARCHAR(255) NOT NULL,
  original_name  VARCHAR(255) NOT NULL,
  mime_type      VARCHAR(100),
  size_bytes     BIGINT,
  category       VARCHAR(100),                 -- migrations 011/012: free-form, nullable
  kind           VARCHAR(20)  NOT NULL DEFAULT 'file',   -- migration 011: 'file' | 'proposal'
  notes          TEXT,
  uploaded_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_files_customer ON customer_files(customer_id);

-- --- Work Orders (migrations 001, 007, 008, 016, 017, 021) ----------------------
-- Work orders are section-based as of migration 017. Legacy WO-level description/
-- hours columns are gone; data lives in work_order_sections.
CREATE TABLE IF NOT EXISTS work_orders (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  number          SERIAL,                                  -- migration 007
  customer_id     UUID         NOT NULL REFERENCES customers(id),
  status          VARCHAR(20)  NOT NULL DEFAULT 'draft',
  work_date       DATE         NOT NULL DEFAULT CURRENT_DATE,
  billing_rate_id UUID         REFERENCES customer_billing_rates(id) ON DELETE SET NULL,  -- WO default rate
  location_id     UUID         REFERENCES customer_locations(id) ON DELETE SET NULL,      -- migration 021: optional branch
  submitted_at    TIMESTAMPTZ,
  invoiced_at     TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  -- Legacy WO-level fields from migration 001. Migration 017 moved the live data
  -- into work_order_sections but did NOT drop these columns, so they remain for an
  -- exact match with a migrated DB. The app no longer reads/writes them.
  description     TEXT,
  internal_notes  TEXT,
  travel_minutes  INTEGER,
  is_remote       BOOLEAN      NOT NULL DEFAULT false,
  needs_followup  BOOLEAN      NOT NULL DEFAULT false,
  followup_notes  TEXT,
  labor_hours     NUMERIC(6,2),
  labor_total     NUMERIC(10,2),
  hardware_total  NUMERIC(10,2),
  created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_orders_customer ON work_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status   ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_date     ON work_orders(work_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_number ON work_orders(number);

-- Work sections (migration 017): each carries date/desc/hours/rate-override + internal fields.
CREATE TABLE IF NOT EXISTS work_order_sections (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   UUID         NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  sort_order      INTEGER      NOT NULL DEFAULT 0,
  work_date       DATE,
  description     TEXT,
  hours           NUMERIC(6,2),
  billing_rate_id UUID         REFERENCES customer_billing_rates(id) ON DELETE SET NULL,  -- NULL = inherit WO default
  travel_minutes  INTEGER,
  is_remote       BOOLEAN      NOT NULL DEFAULT false,
  needs_followup  BOOLEAN      NOT NULL DEFAULT false,
  followup_notes  TEXT,
  internal_notes  TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wo_sections_wo ON work_order_sections(work_order_id);

-- Technicians per section (migration 017 added id + section_id; original PK dropped)
CREATE TABLE IF NOT EXISTS work_order_technicians (
  id            UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  section_id    UUID REFERENCES work_order_sections(id) ON DELETE CASCADE,
  -- A technician is EITHER a linked Portal user (user_id) OR a free-typed name
  -- (user_id NULL, name set) - the latter for jobs imported from the Field App.
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(120)
);

-- Line items per section (migrations 016 inventory link, 017 section_id)
CREATE TABLE IF NOT EXISTS work_order_items (
  id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id     UUID           NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  section_id        UUID           REFERENCES work_order_sections(id) ON DELETE CASCADE,
  description       TEXT           NOT NULL,
  quantity          NUMERIC(8, 2)  NOT NULL DEFAULT 1,
  unit_price        NUMERIC(10, 2),
  total_price       NUMERIC(10, 2),
  part_number       VARCHAR(100),
  inventory_item_id UUID,          -- migration 016: soft link to Field inventory (separate DB; no FK)
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wo_items_wo ON work_order_items(work_order_id);

-- Services per section (migration 022): one-time + recurring billable services.
CREATE TABLE IF NOT EXISTS work_order_services (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   UUID           NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  section_id      UUID           REFERENCES work_order_sections(id) ON DELETE CASCADE,
  description     TEXT           NOT NULL,
  quantity        NUMERIC(8, 2)  NOT NULL DEFAULT 1,
  unit_price      NUMERIC(10, 2),
  total_price     NUMERIC(10, 2),
  billing_type    VARCHAR(20)    NOT NULL DEFAULT 'one_time',   -- 'one_time' | 'recurring'
  recurrence      VARCHAR(20),                                  -- monthly|quarterly|semiannual|annual (NULL for one_time)
  notes           TEXT,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wo_services_wo      ON work_order_services(work_order_id);
CREATE INDEX IF NOT EXISTS idx_wo_services_section ON work_order_services(section_id);

-- --- Customer Licenses ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_licenses (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  program_name    TEXT         NOT NULL,
  vendor          TEXT,
  vendor_contact  TEXT,
  version         TEXT,
  license_keys    JSONB        NOT NULL DEFAULT '[]',  -- [{id, title, key_enc}]
  renewal_date    DATE,
  notes           TEXT,
  created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_licenses_customer ON customer_licenses(customer_id);

-- --- Order Log -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_log (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor         TEXT          NOT NULL,
  items          JSONB         NOT NULL DEFAULT '[]',  -- [{item_name,sku,quantity,unit_cost,total_cost}]
  po_number      TEXT,
  purpose        TEXT,
  customer_name  TEXT,
  for_stock      BOOLEAN       NOT NULL DEFAULT false,
  status         VARCHAR(20)   NOT NULL DEFAULT 'placed',
  order_date     DATE,
  expected_date  DATE,
  received_date  DATE,
  notes          TEXT,
  created_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_log_status  ON order_log(status);
CREATE INDEX IF NOT EXISTS idx_order_log_created ON order_log(created_at DESC);

CREATE TABLE IF NOT EXISTS order_log_attachments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID        NOT NULL REFERENCES order_log(id) ON DELETE CASCADE,
  stored_name   TEXT        NOT NULL,
  original_name TEXT        NOT NULL,
  mime_type     TEXT,
  size_bytes    BIGINT,
  uploaded_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_attachments_order ON order_log_attachments(order_id);

-- --- Audit Log -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  user_name    VARCHAR(100),
  action       VARCHAR(30) NOT NULL,
  entity_type  VARCHAR(50),
  entity_id    UUID,
  entity_name  TEXT,
  changes      JSONB,
  ip_address   INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user    ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity  ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

-- --- Migration bookkeeping ------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Mark every migration that this consolidated schema already represents, so the
-- migration runner treats a fresh DB built from this file as fully up to date.
INSERT INTO schema_migrations (version) VALUES
  ('001_initial'),
  ('002_customer_details'),
  ('003_drop_customer_type'),
  ('004_camera_shared_creds'),
  ('005_camera_shared_access_table'),
  ('006_widen_credential_category'),
  ('007_work_order_number'),
  ('008_default_billing_rate'),
  ('009_customer_device_detail'),
  ('010_credential_custom_fields'),
  ('011_files_proposals_ordering'),
  ('012_file_category_nullable'),
  ('013_branch_office_fields'),
  ('014_firewall_switch_fields'),
  ('015_device_order_vlans_rules'),
  ('016_wo_item_inventory_link'),
  ('017_work_order_sections'),
  ('018_user_last_login'),
  ('019_contact_rate_order'),
  ('020_printer_options'),
  ('021_wo_location'),
  ('022_work_order_services')
ON CONFLICT (version) DO NOTHING;
