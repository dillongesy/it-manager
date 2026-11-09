-- Allow custom category names (was VARCHAR(20), too short for user-defined labels)
ALTER TABLE customer_credentials ALTER COLUMN category TYPE VARCHAR(100);
ALTER TABLE customer_credentials ALTER COLUMN category SET DEFAULT 'General';
