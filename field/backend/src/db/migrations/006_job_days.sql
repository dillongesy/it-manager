-- A field job is no longer a single date with one lump "total hours". Real camera
-- jobs run across several days: cable pulled Monday, cameras hung Tuesday, NVR
-- configured Friday - with different crews, different parts, and sometimes a
-- different labor rate (a Saturday emergency call) on each day.
--
-- This migration introduces DAYS as the middle layer:
--
--   field_work_orders
--     └── field_work_order_days        (date, work performed, notes)
--           ├── technicians            (per-tech HOURS on that day)
--           ├── items                  (parts used that day)
--           └── services
--
-- Each day maps 1:1 onto a Portal work_order_section on import (a section already
-- carries its own work_date/hours/description), so the multi-day record survives
-- the bridge intact. Labor RATES stay entirely in the Portal - the field app
-- captures what happened, the office decides what it's worth.
--
-- The old `field_work_orders.work_date` / `.hours` / `.description` columns are
-- LEFT IN PLACE (non-destructive, same as the legacy billing status columns).
-- `work_date` is still maintained as the job's FIRST day so existing sorting and
-- idx_fwo_date keep working; `hours` and `description` are no longer read.

CREATE TABLE IF NOT EXISTS field_work_order_days (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID        NOT NULL REFERENCES field_work_orders(id) ON DELETE CASCADE,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  work_date     DATE        NOT NULL DEFAULT CURRENT_DATE,
  -- What was done that day → becomes the Portal section's description.
  description   TEXT,
  -- Day-specific notes → becomes the Portal section's internal notes.
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fwo_days_wo ON field_work_order_days(work_order_id, sort_order);

-- Technicians, parts and services now hang off a DAY rather than the whole job.
-- day_id is nullable during the backfill below and set for every row by the end;
-- new rows always carry one.
ALTER TABLE field_work_order_technicians
  ADD COLUMN IF NOT EXISTS day_id UUID REFERENCES field_work_order_days(id) ON DELETE CASCADE,
  -- Hours THIS technician worked THIS day. NULL/blank counts as 0; a day's total
  -- is always the sum of its technicians (never stored - always computed).
  ADD COLUMN IF NOT EXISTS hours  NUMERIC(6, 2);

ALTER TABLE field_work_order_items
  ADD COLUMN IF NOT EXISTS day_id UUID REFERENCES field_work_order_days(id) ON DELETE CASCADE;

ALTER TABLE field_work_order_services
  ADD COLUMN IF NOT EXISTS day_id UUID REFERENCES field_work_order_days(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_fwo_tech_day     ON field_work_order_technicians(day_id);
CREATE INDEX IF NOT EXISTS idx_fwo_items_day    ON field_work_order_items(day_id);
CREATE INDEX IF NOT EXISTS idx_fwo_services_day ON field_work_order_services(day_id);

-- --- Backfill: every existing job becomes a one-day job -----------------------

INSERT INTO field_work_order_days (work_order_id, sort_order, work_date, description)
SELECT wo.id, 10, COALESCE(wo.work_date, CURRENT_DATE), wo.description
  FROM field_work_orders wo
 WHERE NOT EXISTS (SELECT 1 FROM field_work_order_days d WHERE d.work_order_id = wo.id);

-- Each job now has exactly one day, so every orphaned child belongs to it.
UPDATE field_work_order_technicians t
   SET day_id = d.id
  FROM field_work_order_days d
 WHERE d.work_order_id = t.work_order_id AND t.day_id IS NULL;

UPDATE field_work_order_items i
   SET day_id = d.id
  FROM field_work_order_days d
 WHERE d.work_order_id = i.work_order_id AND i.day_id IS NULL;

UPDATE field_work_order_services s
   SET day_id = d.id
  FROM field_work_order_days d
 WHERE d.work_order_id = s.work_order_id AND s.day_id IS NULL;

-- Legacy `hours` was one lump total for the whole crew. Where the job had exactly
-- ONE technician the total unambiguously belongs to them, so assign it.
UPDATE field_work_order_technicians t
   SET hours = wo.hours
  FROM field_work_orders wo
 WHERE t.work_order_id = wo.id
   AND wo.hours IS NOT NULL
   AND t.hours IS NULL
   AND (SELECT COUNT(*) FROM field_work_order_technicians t2 WHERE t2.work_order_id = wo.id) = 1;

-- With two or more technicians (or none) the split is unknowable - splitting it
-- evenly would invent a record. Preserve the legacy total in the day's notes so
-- whoever finishes the job can enter the real breakdown.
UPDATE field_work_order_days d
   SET notes = CONCAT_WS(
         E'\n', d.notes,
         'Imported from the old single-hours field: ' || wo.hours || ' total hours, not split by technician.'
       )
  FROM field_work_orders wo
 WHERE d.work_order_id = wo.id
   AND wo.hours IS NOT NULL
   AND (SELECT COUNT(*) FROM field_work_order_technicians t2 WHERE t2.work_order_id = wo.id) <> 1;
