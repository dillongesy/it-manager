-- Portal — ConnectWise RMM device import
-- Migration 056
--
-- A customer's Devices tab can import machines from ConnectWise RMM (the ConnectWise
-- Platform / "Asio" API). Each imported (or matched) device remembers which RMM
-- endpoint it is, so a later re-import updates that same device instead of creating a
-- duplicate — even after it has been renamed in the Portal.
--
--   rmm_endpoint_id — ConnectWise RMM's endpoint (device) ID
--   rmm_synced_at   — last time an import refreshed this device
--
-- No new IP column: customer_devices.ip_address already exists (migration 009); the
-- Devices tab now simply shows it on workstations, servers and switches too.
--
-- An earlier draft of this migration targeted ScreenConnect under a different file
-- name. If that draft was ever applied, its columns are dropped here; on a clean DB the
-- DROPs are no-ops.

ALTER TABLE customer_devices
  ADD COLUMN IF NOT EXISTS rmm_endpoint_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS rmm_synced_at   TIMESTAMPTZ;

ALTER TABLE customer_devices
  DROP COLUMN IF EXISTS screenconnect_session_id,
  DROP COLUMN IF EXISTS screenconnect_synced_at;

CREATE INDEX IF NOT EXISTS idx_customer_devices_rmm_endpoint
  ON customer_devices(rmm_endpoint_id) WHERE rmm_endpoint_id IS NOT NULL;
