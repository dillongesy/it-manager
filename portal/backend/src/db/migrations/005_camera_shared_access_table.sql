-- Replace the single shared-credential columns (004) with a proper multi-user table

ALTER TABLE customer_camera_systems
  DROP COLUMN IF EXISTS shared_username,
  DROP COLUMN IF EXISTS shared_password_enc;

CREATE TABLE customer_camera_shared_access (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_system_id UUID         NOT NULL REFERENCES customer_camera_systems(id) ON DELETE CASCADE,
  label            VARCHAR(100) NOT NULL,   -- e.g. "Customer", "ABC Monitoring", "Owner"
  username         VARCHAR(100),
  password_enc     TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_camera_shared_camera ON customer_camera_shared_access(camera_system_id);
