-- Field "work orders" are reframed as lightweight JOB CAPTURES, not invoices.
-- Billing now lives entirely in the Portal, which pulls "ready" captures over the
-- one-way bridge and promotes each into a real Portal work order.
--
-- This migration adds a small capture lifecycle that REPLACES the old billing
-- status workflow (draft/submitted/pending_billing/invoiced/paid). The old
-- `status` + `*_at` columns are intentionally LEFT IN PLACE (back-compat, no
-- destructive change) but the app no longer reads or writes them.
--
--   open     - tech is still working/editing the capture
--   ready    - done; ready to be billed. Stock for its inventory lines is
--              decremented at this point (single decrement point).
--   imported - pulled into the Portal as a real work order; locked, purgeable.

ALTER TABLE field_work_orders
  ADD COLUMN IF NOT EXISTS capture_status     VARCHAR(20) NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS imported_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS imported_wo_number INTEGER;

-- Carry any existing rows forward sensibly: drafts stay editable ('open');
-- anything already submitted/billed is surfaced as 'ready' so it can be imported.
UPDATE field_work_orders
   SET capture_status = CASE WHEN status = 'draft' THEN 'open' ELSE 'ready' END;

CREATE INDEX IF NOT EXISTS idx_fwo_capture_status ON field_work_orders(capture_status);
