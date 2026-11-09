-- Allow a work-order technician to be EITHER a linked user account (dropdown)
-- OR free-typed initials/name (like techs write on paper). Before this, the
-- join table only supported real user accounts.

ALTER TABLE field_work_order_technicians DROP CONSTRAINT field_work_order_technicians_pkey;

ALTER TABLE field_work_order_technicians
  ADD COLUMN id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ADD COLUMN initials VARCHAR(10),
  ADD COLUMN name     VARCHAR(100);

-- user_id now optional: NULL means a free-typed technician.
ALTER TABLE field_work_order_technicians ALTER COLUMN user_id DROP NOT NULL;

CREATE INDEX idx_fwo_tech_wo ON field_work_order_technicians(work_order_id);
