-- Link a work order section to one of the customer's proposals (customer_files where kind='proposal').
-- proposal_estimated_hours: how many labor hours are covered by the proposal;
-- actual hours beyond this are billed as overage. NULL = all labor is covered.
ALTER TABLE work_order_sections
  ADD COLUMN IF NOT EXISTS linked_proposal_id      UUID    REFERENCES customer_files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proposal_estimated_hours NUMERIC(6,2);
