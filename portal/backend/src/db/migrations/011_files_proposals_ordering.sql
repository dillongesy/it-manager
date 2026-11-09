-- Portal — files/proposals split, free-form categories, ordering
-- Migration 011

-- ─── Files: split "proposals/contracts" into their own tab ─────────────────────
-- One table backs both the Files tab and the Proposals tab, distinguished by kind.
-- 'file' = general attachments (diagrams, floor plans, exports …)
-- 'proposal' = business proposals & contracts (mostly PDFs)
ALTER TABLE customer_files
  ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'file';

-- Existing proposals/contracts move to the Proposals tab; everything else stays.
UPDATE customer_files SET kind = 'proposal'
WHERE category IN ('proposal', 'contract');

-- Categories are now user-defined free text (was a fixed enum in the UI). The
-- column is already free text; relax old default rows tagged 'general' stay as-is.
-- Blank the auto 'proposal'/'contract' category so the user can recategorize
-- under the Proposals tab without a stale label.
UPDATE customer_files SET category = NULL
WHERE category IN ('proposal', 'contract');

-- ─── Credential ordering ───────────────────────────────────────────────────────
-- sort_order already exists on customer_credentials (migration 002). Seed it from
-- current display order so the new manual up/down reordering has a stable basis.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY category, sort_order, label) * 10 AS rn
  FROM customer_credentials
)
UPDATE customer_credentials c
SET sort_order = o.rn
FROM ordered o
WHERE c.id = o.id;

-- Per-customer section ordering. Sections are derived from the credential
-- `category` text; this table stores an explicit order for them.
CREATE TABLE IF NOT EXISTS customer_credential_sections (
  customer_id UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  category    VARCHAR(255) NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (customer_id, category)
);

-- Seed section order alphabetically from existing data.
INSERT INTO customer_credential_sections (customer_id, category, sort_order)
SELECT customer_id, COALESCE(category, 'General'),
       ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY COALESCE(category, 'General')) * 10
FROM customer_credentials
GROUP BY customer_id, COALESCE(category, 'General')
ON CONFLICT DO NOTHING;
