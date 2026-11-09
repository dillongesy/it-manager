-- Portal — "every N years" on work-order services
-- Migration 054
--
-- Companion to 053. A service added to a work order is very often picked straight
-- off the Services catalog, and the catalog can now say "every 3 years" (a domain
-- registration, a multi-year SSL cert). Without this column that cadence was lost on
-- the way onto the work order: the line silently became plain "Annually" and printed
-- that way in the recurring-services summary on the CUSTOMER'S invoice — a wrong
-- number on a customer-facing document.
--
-- Same shape as everywhere else: how many base periods pass between bills, NOT NULL
-- DEFAULT 1 so every existing line is unchanged, and forced back to 1 by the API for
-- one-time services and any non-annual period (see lib/cadence.js).

ALTER TABLE work_order_services
  ADD COLUMN IF NOT EXISTS recurrence_count SMALLINT NOT NULL DEFAULT 1;
