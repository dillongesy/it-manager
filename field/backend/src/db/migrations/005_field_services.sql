-- Field jobs can now record SERVICES (labor / one-time fees / recurring charges)
-- alongside parts — the IT side will also use this app in the field and wants a
-- record of what they did, not just hardware. Parts also gain a unit price so the
-- price carries over to the Portal work order on import (instead of arriving blank).

ALTER TABLE field_work_order_items
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10, 2);

CREATE TABLE IF NOT EXISTS field_work_order_services (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id  UUID          NOT NULL REFERENCES field_work_orders(id) ON DELETE CASCADE,
  description    TEXT          NOT NULL,
  quantity       NUMERIC(8, 2) NOT NULL DEFAULT 1,
  unit_price     NUMERIC(10, 2),
  -- 'one_time' | 'recurring'  (matches the Portal work_order_services vocabulary)
  billing_type   VARCHAR(20)   NOT NULL DEFAULT 'one_time',
  -- when recurring: 'monthly' | 'quarterly' | 'semiannual' | 'annual'
  recurrence     VARCHAR(20),
  notes          TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fwo_services_wo ON field_work_order_services(work_order_id);
