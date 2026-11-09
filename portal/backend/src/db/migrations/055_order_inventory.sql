-- Portal — orders ↔ shared inventory
-- Migration 055
--
-- The Order Log moved out from under Inventory to its own "Orders" page, and each
-- order now says whether it restocks shared (Field App) inventory — and whether that
-- actually happened, so every stock purchase is accounted for.
--
--   is_inventory_order  — this order restocks shared inventory (vs. a one-off buy
--                         for a customer). Drives the "Needs inventory" filter.
--   inventory_added     — the stock really landed in inventory. Set by the
--                         "Add to inventory" action, or ticked by hand when someone
--                         received it directly in the Field App.
--   inventory_added_at / inventory_added_by — who confirmed it, and when.
--
-- Per-line state lives in the existing items JSONB (no new table), next to the
-- line it describes:
--   inventory_item_id / inventory_sku / inventory_name — the Field item it went to
--   added_qty / added_at                               — what was received, when
-- A line with added_at is never received twice, so the action is safe to re-run.
--
-- Deliberately NOT backfilled: marking old "for stock" orders as inventory orders
-- would flag every historic purchase as "not yet added to inventory".

ALTER TABLE order_log
  ADD COLUMN IF NOT EXISTS is_inventory_order BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inventory_added    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inventory_added_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inventory_added_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_log_needs_inventory
  ON order_log(created_at DESC) WHERE is_inventory_order AND NOT inventory_added;
