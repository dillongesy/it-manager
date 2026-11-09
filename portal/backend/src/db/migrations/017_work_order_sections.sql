-- Portal — work orders become section-based
-- Migration 017
--
-- A work order now has one or more SECTIONS, each with its own date, technicians,
-- work-performed description, hours, parts, optional billing-rate override, and
-- internal fields (travel/remote/follow-up/notes). The work order keeps a default
-- billing rate; a section without an override inherits it.
--
-- Per the "fresh start" decision, existing work-order bodies (techs/items) are
-- cleared rather than folded into sections.

CREATE TABLE IF NOT EXISTS work_order_sections (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   UUID         NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  sort_order      INTEGER      NOT NULL DEFAULT 0,
  work_date       DATE,
  description     TEXT,
  hours           NUMERIC(6,2),
  -- NULL = inherit the work order's default billing_rate_id
  billing_rate_id UUID         REFERENCES customer_billing_rates(id) ON DELETE SET NULL,
  -- Internal fields (never on the customer PDF)
  travel_minutes  INTEGER,
  is_remote       BOOLEAN      NOT NULL DEFAULT false,
  needs_followup  BOOLEAN      NOT NULL DEFAULT false,
  followup_notes  TEXT,
  internal_notes  TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wo_sections_wo ON work_order_sections(work_order_id);

-- Fresh start: drop existing line items + technician links (they predate sections).
DELETE FROM work_order_items;
DELETE FROM work_order_technicians;

-- Give every existing work order one starter section (keeps the date so nothing
-- looks broken; description/hours/techs/parts start empty).
INSERT INTO work_order_sections (work_order_id, sort_order, work_date)
SELECT id, 10, work_date FROM work_orders;

-- Technicians and items now hang off a section.
ALTER TABLE work_order_technicians
  ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES work_order_sections(id) ON DELETE CASCADE;

ALTER TABLE work_order_items
  ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES work_order_sections(id) ON DELETE CASCADE;

-- work_order_technicians used (work_order_id, user_id) as its PK; with per-section
-- techs the same user can appear in multiple sections, so drop that constraint.
ALTER TABLE work_order_technicians DROP CONSTRAINT IF EXISTS work_order_technicians_pkey;
ALTER TABLE work_order_technicians
  ADD COLUMN IF NOT EXISTS id UUID PRIMARY KEY DEFAULT gen_random_uuid();
