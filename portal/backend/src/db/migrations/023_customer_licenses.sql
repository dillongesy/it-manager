CREATE TABLE IF NOT EXISTS customer_licenses (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  program_name      TEXT         NOT NULL,
  vendor            TEXT,
  vendor_contact    TEXT,
  version           TEXT,
  license_key_title TEXT,
  license_key_enc   TEXT,
  renewal_date      DATE,
  notes             TEXT,
  created_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_licenses_customer ON customer_licenses(customer_id);
