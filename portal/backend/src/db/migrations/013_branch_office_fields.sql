-- Portal - branch offices (extra linked locations with their own details)
-- Migration 013
--
-- customer_locations existed from migration 001 (label/address/city/state/zip/phone/notes)
-- but had no write path. Branch offices need their own business name, static WAN IP,
-- and firewall management link - same richness as the main office.

ALTER TABLE customer_locations
  ADD COLUMN IF NOT EXISTS business_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS wan_ip        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS firewall_link TEXT,
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();
