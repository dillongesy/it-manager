-- Portal - camera system detail
-- Migration 050
--
-- Two parts:
--
-- 1. The camera SYSTEM (NVR/DVR) gains an install date and a physical location.
--    `system_location` is where the box physically sits ("server closet, back wall rack") -
--    distinct from `location_id`, which is the branch office the system belongs to.
--
-- 2. Individual CAMERAS hanging off a system. Techs need per-camera detail on site:
--    which channel it's on, its IP/MAC for finding it on the network, model/serial for
--    warranty + replacement, and its own login (many camera lines are activated with a
--    per-camera password, not the NVR's). Cameras cascade with their system.

ALTER TABLE customer_camera_systems
  ADD COLUMN IF NOT EXISTS install_date    DATE,
  ADD COLUMN IF NOT EXISTS system_location TEXT;

CREATE TABLE IF NOT EXISTS customer_cameras (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_system_id UUID         NOT NULL REFERENCES customer_camera_systems(id) ON DELETE CASCADE,
  name             VARCHAR(255),          -- name / location, e.g. "Front Door", "Warehouse NE"
  channel          VARCHAR(20),           -- channel or port on the NVR (free text: "4", "A2")
  ip_address       VARCHAR(50),
  mac_address      VARCHAR(50),
  manufacturer     VARCHAR(255),
  model            VARCHAR(255),
  serial_number    VARCHAR(100),
  camera_type      VARCHAR(30),           -- dome / bullet / turret / PTZ / fisheye / other
  resolution       VARCHAR(50),           -- e.g. "4MP", "8MP / 4K"
  firmware         VARCHAR(100),
  connected_to     TEXT,                  -- PoE switch + port, injector, NVR port…
  install_date     DATE,
  username         VARCHAR(100),
  password_enc     TEXT,                  -- AES-256-GCM, same as every other stored credential
  notes            TEXT,
  sort_order       INTEGER      NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_cameras_system ON customer_cameras(camera_system_id);
