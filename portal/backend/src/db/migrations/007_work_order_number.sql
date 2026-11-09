-- Human-readable sequential work order numbers (WO-001, WO-002, …)
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS number SERIAL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_number ON work_orders(number);
