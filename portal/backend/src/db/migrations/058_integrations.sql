-- Portal — linked outside systems (ConnectWise sites, UniFi consoles) + UniFi / Dell sync columns
-- Migration 058
--
-- 1. customer_integration_links — which ConnectWise RMM site, UniFi console, … a customer
--    is. Recorded when an import runs, so the next sync opens straight on the right
--    site/console for every tech (the ConnectWise picker used to remember it only in the
--    browser's localStorage). `location_id` = the branch office new records from that
--    source land in. Deleting a link never touches the records it imported.
--      provider = 'connectwise' → external_id "<companyId>/<siteId>"
--      provider = 'unifi'       → external_id the console (host) ID from api.ui.com
--      provider = 'tdsynnex'    → external_id the TD SYNNEX customer number
--
-- 2. UniFi links on the records an import creates or updates, so a re-import updates
--    instead of duplicating (like customer_devices.rmm_endpoint_id for ConnectWise):
--      customer_devices.unifi_device_id      — the device's UniFi ID (its MAC, as hex)
--      customer_camera_systems.unifi_host_id — the Protect console (NVR / Cloud Key)
--      customer_cameras.unifi_device_id      — the camera's UniFi ID
--
-- 3. Dell warranty detail on a device: the coverage name ("ProSupport Plus") and when
--    Dell was last asked, alongside the existing warranty_expires date.

CREATE TABLE IF NOT EXISTS customer_integration_links (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  provider       VARCHAR(30)  NOT NULL,
  external_id    VARCHAR(255) NOT NULL,
  external_name  TEXT,
  location_id    UUID         REFERENCES customer_locations(id) ON DELETE SET NULL,
  created_by     UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  UNIQUE (customer_id, provider, external_id)
);
CREATE INDEX IF NOT EXISTS idx_integration_links_customer ON customer_integration_links(customer_id);
CREATE INDEX IF NOT EXISTS idx_integration_links_external ON customer_integration_links(provider, external_id);

ALTER TABLE customer_devices
  ADD COLUMN IF NOT EXISTS unifi_device_id     VARCHAR(64),
  ADD COLUMN IF NOT EXISTS unifi_host_id       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS unifi_synced_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warranty_coverage   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS warranty_checked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_customer_devices_unifi
  ON customer_devices(unifi_device_id) WHERE unifi_device_id IS NOT NULL;

ALTER TABLE customer_camera_systems
  ADD COLUMN IF NOT EXISTS unifi_host_id   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS unifi_synced_at TIMESTAMPTZ;

ALTER TABLE customer_cameras
  ADD COLUMN IF NOT EXISTS unifi_device_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS unifi_synced_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_customer_cameras_unifi
  ON customer_cameras(unifi_device_id) WHERE unifi_device_id IS NOT NULL;
