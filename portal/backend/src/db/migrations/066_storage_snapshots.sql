-- Portal - server storage history
--
-- One row every few hours, written by the Portal API (lib/storage.js). Used to show
-- how fast the disk is filling and to forecast when it will be full. Sizes in bytes.
-- field_* is NULL when the Field App could not be reached at the time.

CREATE TABLE IF NOT EXISTS storage_snapshots (
  id               BIGSERIAL   PRIMARY KEY,
  taken_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disk_total       BIGINT      NOT NULL,
  disk_used        BIGINT      NOT NULL,
  disk_free        BIGINT      NOT NULL,
  portal_database  BIGINT      NOT NULL,
  portal_files     BIGINT      NOT NULL,
  field_database   BIGINT,
  field_files      BIGINT
);

CREATE INDEX IF NOT EXISTS idx_storage_snapshots_taken_at ON storage_snapshots (taken_at);
