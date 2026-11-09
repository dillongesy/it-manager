-- Portal - link a customer's recurring charge back to the service catalog
-- Migration 051
--
-- A recurring charge created by picking a service off the Services catalog now
-- remembers WHICH service it came from. That link is what lets a catalog price
-- change (e.g. Microsoft 365 goes up) roll out to every customer paying for it,
-- instead of the biller hunting through 100 customers by hand.
--
--   service_catalog_id - NULL for free-typed charges (unlinked, never auto-updated).
--                        ON DELETE SET NULL: deleting a catalog entry must not delete
--                        anyone's billing record, it just unlinks it.

ALTER TABLE customer_recurring_charges
  ADD COLUMN IF NOT EXISTS service_catalog_id UUID REFERENCES service_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recurring_charges_service
  ON customer_recurring_charges(service_catalog_id);
