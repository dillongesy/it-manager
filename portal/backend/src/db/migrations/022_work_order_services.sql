-- Portal - work-order services (recurring + one-time)
-- Migration 022
--
-- A sibling to work_order_items ("Parts & Materials"). Services capture billable
-- work that isn't a physical part: one-time fees (e.g. a setup fee) and recurring
-- charges (e.g. Microsoft 365 yearly, managed backups monthly/quarterly).
--   billing_type: 'one_time' | 'recurring'
--   recurrence:   for recurring → 'monthly' | 'quarterly' | 'semiannual' | 'annual'
--                 (NULL for one_time)
-- One-time services fold into the work-order total; recurring services are shown
-- separately with their cadence so the billing total stays an honest one-time sum.

CREATE TABLE IF NOT EXISTS work_order_services (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   UUID           NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  section_id      UUID           REFERENCES work_order_sections(id) ON DELETE CASCADE,
  description     TEXT           NOT NULL,
  quantity        NUMERIC(8, 2)  NOT NULL DEFAULT 1,
  unit_price      NUMERIC(10, 2),
  total_price     NUMERIC(10, 2),
  billing_type    VARCHAR(20)    NOT NULL DEFAULT 'one_time',
  recurrence      VARCHAR(20),
  notes           TEXT,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wo_services_wo      ON work_order_services(work_order_id);
CREATE INDEX IF NOT EXISTS idx_wo_services_section ON work_order_services(section_id);
