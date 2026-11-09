-- Portal — richer customer + device detail
-- Migration 009

-- ─── Customers: static WAN IP + firewall management link ───────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS wan_ip        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS firewall_link TEXT;

-- ─── Contacts: optional structured address (notes still free-form) ─────────────
-- A "contact" may be a person OR a branch office, so give it its own address fields.
ALTER TABLE customer_contacts
  ADD COLUMN IF NOT EXISTS address VARCHAR(255),
  ADD COLUMN IF NOT EXISTS city    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS zip     VARCHAR(20);

-- ─── Devices: type-specific fields ─────────────────────────────────────────────
-- The device form now changes per type (printer / NAS / network / workstation /
-- server). These columns back the new per-type fields. Unused columns simply stay
-- NULL for a given device type.
ALTER TABLE customer_devices
  -- printers, NAS, network gear all have an IP
  ADD COLUMN IF NOT EXISTS ip_address     VARCHAR(50),
  -- printer: optional link to its driver download
  ADD COLUMN IF NOT EXISTS driver_url     TEXT,
  -- network gear: who manages it (e.g. "us", "ISP", a 3rd-party MSP) + their email
  ADD COLUMN IF NOT EXISTS managed_by     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS manager_email  VARCHAR(255),
  -- workstation/server: multiple drives — [{ "label": "C:", "size": "512GB SSD" }, …]
  ADD COLUMN IF NOT EXISTS storage_drives JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- NAS: share paths — [{ "path": "\\\\nas\\backups", "note": "nightly backups" }, …]
  ADD COLUMN IF NOT EXISTS share_paths    JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Carry any existing single storage string into the new drives array so nothing
-- is lost. (No-op on fresh installs.)
UPDATE customer_devices
SET storage_drives = jsonb_build_array(jsonb_build_object('label', '', 'size', storage))
WHERE storage IS NOT NULL AND storage <> ''
  AND storage_drives = '[]'::jsonb;
