-- Portal - manual ordering for contacts and billing rates
-- Migration 019
--
-- Contacts and billing rates are per-customer; give each a sort_order so they can
-- be drag-reordered in the Overview tab (mirrors credentials/devices).

ALTER TABLE customer_contacts      ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_billing_rates ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Seed sort_order from current display order so reordering has a stable basis.
WITH c AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY is_primary DESC, name) * 10 AS rn
  FROM customer_contacts
)
UPDATE customer_contacts t SET sort_order = c.rn FROM c WHERE c.id = t.id;

WITH r AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY label) * 10 AS rn
  FROM customer_billing_rates
)
UPDATE customer_billing_rates t SET sort_order = r.rn FROM r WHERE r.id = t.id;
