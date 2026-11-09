-- Field App — audit log (inventory-focused first pass)
-- Migration 003
--
-- The Field App previously had no general audit table — only the immutable
-- inventory_transactions ledger (quantity movements). This adds a Portal-style
-- audit_log so every inventory change (create, metadata edit, receive, checkout,
-- adjust, return) is recorded with who/what/when, including changes that come in
-- over the IT-Portal service bridge. Work-order / photo / user auditing can be
-- layered onto this same table later.

CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  user_name    VARCHAR(100),
  action       VARCHAR(30) NOT NULL,
  entity_type  VARCHAR(50),
  entity_id    UUID,
  entity_name  TEXT,
  changes      JSONB,
  ip_address   INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_audit_entity  ON audit_log(entity_type, entity_id);
