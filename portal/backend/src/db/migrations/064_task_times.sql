-- A scheduled task can sit at a time of day, for a length, like a calendar appointment:
-- scheduled_time is office (wall-clock) time; NULL = an all-day task on scheduled_date.
-- duration_minutes is how long it's booked for; NULL = use the estimate (else an hour).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_time   TIME;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
DO $$ BEGIN
  ALTER TABLE tasks ADD CONSTRAINT tasks_duration_minutes_range CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 10080);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
