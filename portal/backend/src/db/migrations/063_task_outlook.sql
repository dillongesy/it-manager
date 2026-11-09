-- "Add to Outlook" on a task: the event the Portal put on the shared Outlook calendar for it
-- (Microsoft Graph immutable ID), so changes to the task's date, title or tech follow it there.
-- NULL = not on Outlook.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS outlook_event_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_outlook_event ON tasks (outlook_event_id) WHERE outlook_event_id IS NOT NULL;
