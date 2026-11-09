-- Portal — branch-awareness for per-customer records
-- Migration 038
--
-- Customers with multiple offices can now assign each device, credential, camera
-- system, file/proposal, license, and contact to a specific office. NULL = the main
-- office (whose details live on the customers row), matching the work_order.location_id
-- convention. Single-office customers are unaffected — everything stays NULL.

ALTER TABLE customer_devices        ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES customer_locations(id) ON DELETE SET NULL;
ALTER TABLE customer_credentials    ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES customer_locations(id) ON DELETE SET NULL;
ALTER TABLE customer_camera_systems ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES customer_locations(id) ON DELETE SET NULL;
ALTER TABLE customer_files          ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES customer_locations(id) ON DELETE SET NULL;
ALTER TABLE customer_licenses       ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES customer_locations(id) ON DELETE SET NULL;
ALTER TABLE customer_contacts       ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES customer_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customer_devices_location     ON customer_devices(location_id);
CREATE INDEX IF NOT EXISTS idx_customer_credentials_location ON customer_credentials(location_id);
CREATE INDEX IF NOT EXISTS idx_customer_cameras_location     ON customer_camera_systems(location_id);
CREATE INDEX IF NOT EXISTS idx_customer_files_location       ON customer_files(location_id);
CREATE INDEX IF NOT EXISTS idx_customer_licenses_location    ON customer_licenses(location_id);
CREATE INDEX IF NOT EXISTS idx_customer_contacts_location    ON customer_contacts(location_id);
