-- Portal — Initial Schema
-- Migration 001

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ───────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(50) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(100) NOT NULL,
  -- 'admin' | 'technician' | 'biller'
  role          VARCHAR(20) NOT NULL DEFAULT 'technician',
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Refresh tokens stored as SHA-256 hashes; rotated on every use
CREATE TABLE refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(64) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  is_revoked  BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash    ON refresh_tokens(token_hash) WHERE NOT is_revoked;

-- ─── Customers ───────────────────────────────────────────────────────────────

CREATE TABLE customers (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  address     TEXT,
  city        VARCHAR(100),
  state       VARCHAR(50),
  zip         VARCHAR(20),
  phone       VARCHAR(50),
  -- 'full_msp' | 'cameras_only' | 'it_only' | 'general'
  type        VARCHAR(20)  NOT NULL DEFAULT 'general',
  notes       TEXT,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_name      ON customers USING gin(to_tsvector('english', name));
CREATE INDEX idx_customers_active    ON customers(is_active);

CREATE TABLE customer_contacts (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  title        VARCHAR(100),
  phone        VARCHAR(50),
  email        VARCHAR(255),
  is_primary   BOOLEAN      NOT NULL DEFAULT false,
  notes        TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_contacts_customer ON customer_contacts(customer_id);

CREATE TABLE customer_locations (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label       VARCHAR(100),
  address     TEXT,
  city        VARCHAR(100),
  state       VARCHAR(50),
  zip         VARCHAR(20),
  phone       VARCHAR(50),
  notes       TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Customer Billing Rates ───────────────────────────────────────────────────

CREATE TABLE customer_billing_rates (
  id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID           NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label       VARCHAR(100)   NOT NULL,  -- e.g. "Standard", "After Hours", "Weekend"
  rate        NUMERIC(10, 2) NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ─── Work Orders ─────────────────────────────────────────────────────────────

CREATE TABLE work_orders (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID         NOT NULL REFERENCES customers(id),
  -- 'draft' | 'submitted' | 'pending_billing' | 'invoiced' | 'paid'
  status          VARCHAR(20)  NOT NULL DEFAULT 'draft',
  work_date       DATE         NOT NULL DEFAULT CURRENT_DATE,
  description     TEXT,
  -- Internal fields — never shown on customer PDF
  internal_notes  TEXT,
  travel_minutes  INTEGER,
  is_remote       BOOLEAN      NOT NULL DEFAULT false,
  needs_followup  BOOLEAN      NOT NULL DEFAULT false,
  followup_notes  TEXT,
  -- Billing
  billing_rate_id UUID         REFERENCES customer_billing_rates(id) ON DELETE SET NULL,
  labor_hours     NUMERIC(6,2),
  labor_total     NUMERIC(10,2),
  hardware_total  NUMERIC(10,2),
  -- Tracking
  submitted_at    TIMESTAMPTZ,
  invoiced_at     TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_work_orders_customer ON work_orders(customer_id);
CREATE INDEX idx_work_orders_status   ON work_orders(status);
CREATE INDEX idx_work_orders_date     ON work_orders(work_date DESC);

-- Many techs per work order
CREATE TABLE work_order_technicians (
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (work_order_id, user_id)
);

-- Hardware / parts used on a work order (freeform for now; ties to inventory later)
CREATE TABLE work_order_items (
  id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID           NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  description   TEXT           NOT NULL,
  quantity      NUMERIC(8, 2)  NOT NULL DEFAULT 1,
  unit_price    NUMERIC(10, 2),
  total_price   NUMERIC(10, 2),
  part_number   VARCHAR(100),
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ─── Audit Log ───────────────────────────────────────────────────────────────

CREATE TABLE audit_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  user_name    VARCHAR(100),
  -- 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'VIEW_CREDENTIALS'
  action       VARCHAR(30) NOT NULL,
  entity_type  VARCHAR(50),
  entity_id    UUID,
  entity_name  TEXT,
  changes      JSONB,
  ip_address   INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user       ON audit_log(user_id);
CREATE INDEX idx_audit_log_entity     ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created    ON audit_log(created_at DESC);

-- ─── Migration tracking ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
