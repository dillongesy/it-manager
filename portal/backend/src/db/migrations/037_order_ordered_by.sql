-- Portal — record who placed each order-log entry
-- Migration 037
--
-- `created_by` already tracks who entered the order in the portal; `ordered_by` is the
-- person who actually placed the purchase (chosen from a dropdown). NULL = unspecified.

ALTER TABLE order_log ADD COLUMN IF NOT EXISTS ordered_by UUID REFERENCES users(id) ON DELETE SET NULL;
