-- Portal — customer recurring billing tracker
-- Migration 047
--
-- A standalone, per-customer list of standing recurring charges the biller tracks
-- (e.g. "M365 Business Standard — annually in November", "Antivirus — monthly",
-- "Backups — quarterly"). Purely a tracking aid: nothing here auto-generates work
-- orders or invoices. Branch-aware like the other customer sub-records (NULL = main).
--
--   frequency     — 'monthly' | 'quarterly' | 'semiannual' | 'annually'
--   billing_month — 1..12, the anchor month for periodic charges (quarterly/semiannual/
--                   annually). NULL for monthly (bills every month). The app computes
--                   the next-due month on the fly by rolling this anchor forward.
--   amount        — what we bill the customer per occurrence
--   category      — free-text grouping (Antivirus / Backup / Microsoft 365 / Other)
--   is_active     — inactive charges are kept for history but excluded from totals

CREATE TABLE IF NOT EXISTS customer_recurring_charges (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  location_id   UUID         REFERENCES customer_locations(id) ON DELETE SET NULL,
  description   TEXT         NOT NULL,
  category      TEXT,
  amount        NUMERIC(10,2),
  frequency     VARCHAR(20)  NOT NULL DEFAULT 'monthly',
  billing_month SMALLINT,
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  notes         TEXT,
  created_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recurring_charges_customer ON customer_recurring_charges(customer_id);
