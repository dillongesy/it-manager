-- Portal — firewall & switch device types
-- Migration 014
--
-- Two new device_type values ('firewall', 'switch') backed by these columns.
-- Reuses existing columns where sensible: model, managed_by, manager_email,
-- admin_username/admin_password_enc, notes, and driver_url (repurposed as the
-- management/console URL for network gear). Unused columns stay NULL per type.

ALTER TABLE customer_devices
  ADD COLUMN IF NOT EXISTS manufacturer     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS firmware_version VARCHAR(100),
  ADD COLUMN IF NOT EXISTS serial_number    VARCHAR(100),
  -- Multiple IPs: ["10.0.0.1", "10.0.1.1", …]
  ADD COLUMN IF NOT EXISTS internal_ips     JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS external_ips     JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- switch: 'none' | 'poe' | 'poe+' | 'poe++'
  ADD COLUMN IF NOT EXISTS poe_type         VARCHAR(20),
  -- switch: managed vs unmanaged
  ADD COLUMN IF NOT EXISTS managed_switch   BOOLEAN,
  -- switch: port count
  ADD COLUMN IF NOT EXISTS port_count       INTEGER,
  -- firewall: UTM/threat/support license or subscription expiry
  ADD COLUMN IF NOT EXISTS license_expires  DATE;
