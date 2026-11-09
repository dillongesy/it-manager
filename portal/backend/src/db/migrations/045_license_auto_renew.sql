-- Portal - license auto-renewal
-- Migration 045
--
-- Subscriptions (e.g. monthly/annual SaaS) renew on their own card and don't need a
-- staff member to act. Rather than re-keying the date every cycle, we mark the license
-- auto_renew + an interval and let the app roll the "expiration date" forward from the
-- stored anchor. payment_method records which card pays it (e.g. "Riley's card",
-- "AMEX ending 5041") so billing knows which statement it lands on.
--
--   auto_renew       - true = recurring subscription that renews itself
--   renewal_interval - 'monthly' | 'annually' (only meaningful when auto_renew)
--   payment_method   - free text: which card / account is charged

ALTER TABLE customer_licenses
  ADD COLUMN IF NOT EXISTS auto_renew       BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS renewal_interval VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payment_method   TEXT;
