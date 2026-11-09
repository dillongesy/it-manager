-- Portal - service price catalog
-- Migration 043
--
-- A reusable list of services we sell repeatedly (ThreatLocker Complete/Protect,
-- Trend Micro, TeamViewer, etc.) with default price + billing cadence. Drives the
-- autocomplete when adding a service to a work order; managed on the Services page.
-- Free-form services on work orders are unaffected.

CREATE TABLE IF NOT EXISTS service_catalog (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(255) NOT NULL,
  unit_price   NUMERIC(10,2),
  billing_type VARCHAR(20)  NOT NULL DEFAULT 'recurring',  -- 'recurring' | 'one_time'
  recurrence   VARCHAR(20)  DEFAULT 'monthly',             -- monthly|quarterly|semiannual|annual (recurring only)
  notes        TEXT,
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  created_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_catalog_name ON service_catalog(name);
