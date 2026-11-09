-- Portal — device MAC address
-- Migration 041
--
-- A MAC address field for devices (handy for printers, cloud keys, NVRs, and any other
-- network gear). Plain text — not secret.

ALTER TABLE customer_devices ADD COLUMN IF NOT EXISTS mac_address VARCHAR(50);
