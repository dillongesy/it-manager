-- Portal - service catalog: default category + unit label
-- Migration 049
--
-- Lets a catalog service carry a default category (Antivirus, Backup, Microsoft 365…)
-- and a unit label (seats, TB, licenses…) so that picking it on a customer's Billing
-- tab prefills those too - leaving only the quantity (seat count) to enter per customer.
--
--   category   - default billing category for charges created from this service
--   unit_label - what one unit is (seats, TB, licenses…)

ALTER TABLE service_catalog
  ADD COLUMN IF NOT EXISTS category   TEXT,
  ADD COLUMN IF NOT EXISTS unit_label TEXT;
