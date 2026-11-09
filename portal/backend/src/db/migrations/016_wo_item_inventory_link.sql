-- Portal - link work-order line items to shared inventory
-- Migration 016
--
-- A line item may optionally reference a shared-inventory item (from the Field
-- App). It's a soft reference: inventory lives in a SEPARATE database (field),
-- so this is just the item's UUID for traceability - NOT a foreign key. NULL means
-- a free-typed line with no inventory match.

ALTER TABLE work_order_items
  ADD COLUMN IF NOT EXISTS inventory_item_id UUID;
