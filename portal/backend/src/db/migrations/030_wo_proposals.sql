-- Work-order-level proposal links. A WO can reference one or more of the customer's
-- existing proposals (customer_files where kind='proposal'), with an optional
-- price-before-tax field for biller reference.
CREATE TABLE IF NOT EXISTS work_order_proposals (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id    UUID    NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  proposal_file_id UUID    REFERENCES customer_files(id) ON DELETE SET NULL,
  price_excl_tax   NUMERIC(10,2),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
