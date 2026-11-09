-- Replace the five scalar item columns with a JSONB array so each order
-- can carry multiple line items.
ALTER TABLE order_log ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]';

-- Migrate any existing single-item rows into the array format.
UPDATE order_log
SET items = jsonb_build_array(
  jsonb_build_object(
    'item_name', COALESCE(item_name, ''),
    'sku',       sku,
    'quantity',  quantity,
    'unit_cost', unit_cost,
    'total_cost',total_cost
  )
)
WHERE item_name IS NOT NULL AND item_name <> '';

ALTER TABLE order_log
  DROP COLUMN IF EXISTS item_name,
  DROP COLUMN IF EXISTS sku,
  DROP COLUMN IF EXISTS quantity,
  DROP COLUMN IF EXISTS unit_cost,
  DROP COLUMN IF EXISTS total_cost;
