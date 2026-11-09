-- Portal — work order "printed & submitted" flag
-- Migration 046
--
-- A per-work-order checkbox the biller uses to track that the invoice has been printed
-- and submitted (to QuickBooks / the customer). Independent of the billing status
-- lifecycle — a WO can be printed & submitted in any status — so it's a plain boolean
-- toggled via its own endpoint, not part of the draft→…→paid transitions.

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS printed_submitted BOOLEAN NOT NULL DEFAULT false;
