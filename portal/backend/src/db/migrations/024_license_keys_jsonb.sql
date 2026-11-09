-- Replace the two scalar key columns with a JSONB array so each license
-- can carry multiple (title, key) pairs. Each entry gets a stable UUID so
-- the backend can preserve existing encrypted values during edits without
-- requiring the user to re-enter keys they didn't change.

ALTER TABLE customer_licenses
  ADD COLUMN IF NOT EXISTS license_keys JSONB NOT NULL DEFAULT '[]';

-- Migrate any existing single-key rows into the new array format.
UPDATE customer_licenses
SET license_keys = jsonb_build_array(
  jsonb_build_object(
    'id',      gen_random_uuid()::text,
    'title',   COALESCE(license_key_title, ''),
    'key_enc', COALESCE(license_key_enc, '')
  )
)
WHERE license_key_enc IS NOT NULL AND license_key_enc <> '';

ALTER TABLE customer_licenses
  DROP COLUMN IF EXISTS license_key_title,
  DROP COLUMN IF EXISTS license_key_enc;
