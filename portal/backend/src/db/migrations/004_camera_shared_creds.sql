-- Add shared-access credential fields to camera systems
ALTER TABLE customer_camera_systems
  ADD COLUMN IF NOT EXISTS shared_username    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shared_password_enc TEXT;
