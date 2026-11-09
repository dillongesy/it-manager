-- Portal - technician Backlog
-- Migration 033
--
-- Incoming service requests logged before they become a work order. Each item is
-- assigned to a technician so everyone can see all work or filter to just their own
-- (mirrors the Work Orders tech filter). Fields capture who called and what they need.

CREATE TABLE IF NOT EXISTS backlog_items (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company      VARCHAR(255) NOT NULL,
  caller_name  VARCHAR(255),
  call_date    DATE,
  call_time    VARCHAR(20),
  phone        VARCHAR(50),
  notes        TEXT,
  assigned_to  UUID         REFERENCES users(id) ON DELETE SET NULL,
  is_done      BOOLEAN      NOT NULL DEFAULT false,
  done_at      TIMESTAMPTZ,
  done_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backlog_assigned ON backlog_items(assigned_to);
