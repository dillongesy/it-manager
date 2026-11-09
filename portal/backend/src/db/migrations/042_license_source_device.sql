-- Portal — auto-license linked to a device's license-expiry
-- Migration 042
--
-- When a device (e.g. a firewall) has a License Expires date, the Portal auto-creates a
-- matching entry in the customer's Licensing tab. That license is linked back to the
-- device via source_device_id so it can be kept in sync (program name / renewal date /
-- office) on device edits and removed when the device is deleted (ON DELETE CASCADE) or
-- its license-expiry is cleared. NULL = a normal, manually-created license.

ALTER TABLE customer_licenses
  ADD COLUMN IF NOT EXISTS source_device_id UUID REFERENCES customer_devices(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_customer_licenses_source_device ON customer_licenses(source_device_id);
