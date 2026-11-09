-- Portal — recurring charges: quantity × per-each pricing
-- Migration 048
--
-- Most recurring charges are metered: backups per TB, Trend Micro / ThreatLocker / M365
-- per seat, etc. So a charge now carries a quantity and a per-each unit price; the line
-- total (kept in `amount` so existing revenue totals keep working) is quantity × unit_price.
--
--   quantity   — how many units (seats, TB, licenses…); fractional allowed (e.g. 1.5 TB)
--   unit_price — price per single unit
--   unit_label — optional label for the unit (e.g. "seats", "TB") for readable display
--   amount     — derived line total (quantity × unit_price), maintained by the API

ALTER TABLE customer_recurring_charges
  ADD COLUMN IF NOT EXISTS quantity   NUMERIC(12,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS unit_label TEXT;

-- Backfill: existing rows carried a flat `amount`; treat it as a single unit priced at
-- that amount so the derived total stays identical.
UPDATE customer_recurring_charges
   SET unit_price = amount, quantity = 1
 WHERE unit_price IS NULL AND amount IS NOT NULL;
