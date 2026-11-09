-- Portal - device ordering, VLANs, firewall rules
-- Migration 015

-- --- Device ordering -----------------------------------------------------------
ALTER TABLE customer_devices
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  -- firewall/switch: VLAN definitions, each with nested static_devices.
  -- [{ vlan_id, name, ip_group, gateway, subnet_mask, dhcp_range, static_ranges,
  --    client_isolation (bool), dns, notes, static_devices:[{name,ip,mac,notes}] }, …]
  ADD COLUMN IF NOT EXISTS vlans          JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- firewall: plain-english rules. [{ number, text }, …]
  ADD COLUMN IF NOT EXISTS firewall_rules JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Seed sort_order from current display order (per customer + type).
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (
           PARTITION BY customer_id, device_type
           ORDER BY created_at
         ) * 10 AS rn
  FROM customer_devices
)
UPDATE customer_devices d
SET sort_order = o.rn
FROM ordered o
WHERE d.id = o.id;

-- --- Device-type ordering (per customer) ---------------------------------------
-- The Devices tab groups by device_type; this stores an explicit order for those
-- groups so they can be drag-reordered, mirroring customer_credential_sections.
CREATE TABLE IF NOT EXISTS customer_device_type_order (
  customer_id UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  device_type VARCHAR(20) NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (customer_id, device_type)
);
