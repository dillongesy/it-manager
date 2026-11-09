-- Portal — per-customer To-Do lists
-- Migration 032
--
-- A lightweight checklist attached to each customer (its own tab, like Guides).
-- Each item has a persistent done/undone checkmark. The Backlog page aggregates
-- these across all customers (oldest-first by default).

CREATE TABLE IF NOT EXISTS customer_todos (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  content     TEXT         NOT NULL,
  is_done     BOOLEAN      NOT NULL DEFAULT false,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  done_at     TIMESTAMPTZ,
  done_by     UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_todos_customer ON customer_todos(customer_id);
