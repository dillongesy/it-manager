-- Add billing contact fields to the main customer record and to branch offices.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS billing_contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS billing_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS billing_contact_phone TEXT;

ALTER TABLE customer_locations
  ADD COLUMN IF NOT EXISTS billing_contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS billing_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS billing_contact_phone TEXT;
