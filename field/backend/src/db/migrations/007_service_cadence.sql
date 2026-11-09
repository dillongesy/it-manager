-- Field App — "every N years" on job services
-- Migration 007
--
-- Mirrors Portal migration 054. A service captured on a field job imports 1:1 into a
-- Portal work-order service, and the Portal can now record a multi-year term ("every
-- 3 years" — a domain registration, a 3-year cert). Without this column a multi-year
-- service captured in the field would flatten to plain "Annual" on the way across the
-- bridge, and print that way on the customer's invoice.
--
-- Same shape as the Portal: how many base periods pass between bills, NOT NULL
-- DEFAULT 1 so every existing line is unchanged, and forced back to 1 by the API for
-- one-time services and any non-annual period.

ALTER TABLE field_work_order_services
  ADD COLUMN IF NOT EXISTS recurrence_count SMALLINT NOT NULL DEFAULT 1;
