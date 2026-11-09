CREATE TABLE IF NOT EXISTS order_log (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor         TEXT          NOT NULL,
  item_name      TEXT          NOT NULL,
  sku            TEXT,
  quantity       NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_cost      NUMERIC(10,2),
  total_cost     NUMERIC(10,2),
  po_number      TEXT,
  purpose        TEXT,
  customer_name  TEXT,
  for_stock      BOOLEAN       NOT NULL DEFAULT false,
  status         VARCHAR(20)   NOT NULL DEFAULT 'placed',
  order_date     DATE,
  expected_date  DATE,
  received_date  DATE,
  notes          TEXT,
  created_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_log_status  ON order_log(status);
CREATE INDEX IF NOT EXISTS idx_order_log_created ON order_log(created_at DESC);

CREATE TABLE IF NOT EXISTS order_log_attachments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID        NOT NULL REFERENCES order_log(id) ON DELETE CASCADE,
  stored_name   TEXT        NOT NULL,
  original_name TEXT        NOT NULL,
  mime_type     TEXT,
  size_bytes    BIGINT,
  uploaded_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_attachments_order ON order_log_attachments(order_id);
