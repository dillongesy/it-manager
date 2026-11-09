-- Proposal total (excluding sales tax) stored alongside the proposal link on a work order section.
ALTER TABLE work_order_sections
  ADD COLUMN IF NOT EXISTS proposal_total NUMERIC(10,2);
