-- Portal - work-order branch/location
-- Migration 021
--
-- A work order optionally targets one of the customer's branch offices
-- (customer_locations). NULL = the main office / default. Optional so existing
-- WOs and single-location customers are unaffected.

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES customer_locations(id) ON DELETE SET NULL;
