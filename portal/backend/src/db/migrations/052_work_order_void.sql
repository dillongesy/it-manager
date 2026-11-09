-- Portal — voiding a work order
-- Migration 052
--
-- A work order sitting in Pending Billing that turns out not to be billable (job
-- cancelled, duplicate, written off) can be VOIDED: status 'voided'. That pulls it
-- out of the Billing Queue while keeping the whole record — number, sections, parts,
-- photos — on the Work Orders list, because the history is worth keeping.
--
--   voided_at          — when it was voided (cleared on un-void, like invoiced_at/paid_at)
--   void_reason        — optional free text, so months later you know WHY it was killed
--   inventory_returned — TRUE when the void put the WO's linked parts back into shared
--                        (Field App) inventory. This is the guard that makes the move
--                        reversible: un-voiding re-consumes exactly what the void gave
--                        back, and neither direction can ever run twice.
--
-- `status` is a plain VARCHAR with no CHECK constraint, so 'voided' needs no type change.

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS voided_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason        TEXT,
  ADD COLUMN IF NOT EXISTS inventory_returned BOOLEAN NOT NULL DEFAULT false;
