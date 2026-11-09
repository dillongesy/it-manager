-- Portal — a device can have more than one MAC address
-- Migration 062
--
-- customer_devices.other_macs — every MAC address the device has besides mac_address:
--   [{ mac: "38:FF:59:40:2F:77", note: "Wi-Fi" }]
-- A laptop has one for its network port and one for Wi-Fi, and UniFi sees whichever it
-- is using, so imports kept swapping mac_address back and forth or created a second
-- device. Imports now add a MAC they haven't seen to this list instead of replacing
-- mac_address, and match a device by any of its MACs. Editable on the Devices tab.

ALTER TABLE customer_devices
  ADD COLUMN IF NOT EXISTS other_macs JSONB NOT NULL DEFAULT '[]';
