-- Portal — backlog items point at a real customer (not free-text company)
-- Migration 036
--
-- The "Company Requesting Service" field becomes a required customer dropdown (like
-- work orders) so a backlog item can be linked to that customer's work orders. The
-- `company` text column is kept (auto-filled from the chosen customer's name, and it
-- preserves any pre-existing free-text rows that have no customer_id yet).

ALTER TABLE backlog_items ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_backlog_customer ON backlog_items(customer_id);
