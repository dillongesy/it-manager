-- Portal — "every N years" billing cadences
-- Migration 053
--
-- Some things aren't billed on a plain monthly/quarterly/annual cycle: a domain
-- registration is bought for 2 or 3 years at a time, an SSL cert for 3, a warranty
-- for 5. Until now the only way to record that was to call it "Annually" and lose
-- the real cycle — which then quietly overstated recurring revenue by 2–3x and put
-- the wrong date in every "next due" list.
--
-- So every recurring thing now carries an INTERVAL COUNT alongside its base period:
-- how many of those periods pass between bills. Count 1 is the ordinary case and is
-- the default for every existing row, so nothing already entered changes.
--
-- Only the ANNUAL cadence exposes a count above 1 ("every 3 years"). The columns are
-- generic, so a future "every 18 months" is a UI change and not another migration,
-- but the API forces the count back to 1 for any non-annual period today — a label
-- like "every 2 quarters" reads worse than "semi-annual" and buys nothing.

-- Catalog services: the default cadence a service is sold on.
ALTER TABLE service_catalog
  ADD COLUMN IF NOT EXISTS recurrence_count SMALLINT NOT NULL DEFAULT 1;

-- Auto-renewing licenses: the anchor is renewal_date, so no extra anchor column is
-- needed — the next renewal is anchor + (k × count) intervals.
ALTER TABLE customer_licenses
  ADD COLUMN IF NOT EXISTS renewal_interval_count SMALLINT NOT NULL DEFAULT 1;

-- Customer recurring charges. These are month-granular ("bills in November"), which
-- is enough to place an annual charge but NOT a multi-year one: "November" alone
-- can't say whether the next domain renewal is 2027 or 2029. So a multi-year charge
-- also anchors to a YEAR; billing_year is NULL (and ignored) for every ordinary
-- cadence, exactly as billing_month is NULL for monthly charges.
ALTER TABLE customer_recurring_charges
  ADD COLUMN IF NOT EXISTS interval_count SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS billing_year   SMALLINT;
