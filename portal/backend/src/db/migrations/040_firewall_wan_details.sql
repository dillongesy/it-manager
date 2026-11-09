-- Portal — firewall WAN-side network details
-- Migration 040
--
-- Alongside the external/WAN IP list, a firewall can store the WAN subnet mask, default
-- gateway, and DNS (mirrors the per-VLAN gateway/mask/DNS fields, but for the WAN side).
-- Plain text — these aren't secret.

ALTER TABLE customer_devices
  ADD COLUMN IF NOT EXISTS wan_subnet_mask VARCHAR(50),
  ADD COLUMN IF NOT EXISTS wan_gateway     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS wan_dns         VARCHAR(255);
