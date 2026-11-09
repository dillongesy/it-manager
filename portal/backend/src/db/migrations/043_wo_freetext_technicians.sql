-- Free-text technicians on work orders. Work orders imported from the Field App
-- carry technicians who are NOT Portal user accounts (camera crew / field-typed
-- initials). Mirror the Field app's dual-mode tech model: a technician row is
-- EITHER a linked Portal user (user_id) OR a free-typed name.

ALTER TABLE work_order_technicians
  ADD COLUMN IF NOT EXISTS name VARCHAR(120);

-- user_id becomes optional - NULL means a free-typed technician (name is set).
ALTER TABLE work_order_technicians
  ALTER COLUMN user_id DROP NOT NULL;
