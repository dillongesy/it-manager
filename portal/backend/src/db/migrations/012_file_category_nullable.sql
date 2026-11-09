-- Portal - allow uncategorized files + roomier user-defined categories
-- Migration 012
--
-- Categories are now user-defined free text and optional. The original column was
-- VARCHAR(20) NOT NULL DEFAULT 'general' (a fixed enum), which (a) rejects NULL for
-- "uncategorized" files and (b) truncates longer custom names.

ALTER TABLE customer_files ALTER COLUMN category DROP NOT NULL;
ALTER TABLE customer_files ALTER COLUMN category DROP DEFAULT;
ALTER TABLE customer_files ALTER COLUMN category TYPE VARCHAR(100);
