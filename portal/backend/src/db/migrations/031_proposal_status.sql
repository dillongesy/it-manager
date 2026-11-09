-- Status flag on proposals (customer_files where kind='proposal').
-- NULL treated as 'pending'. Only relevant for proposals; files leave this NULL.
ALTER TABLE customer_files
  ADD COLUMN IF NOT EXISTS proposal_status VARCHAR(20);
