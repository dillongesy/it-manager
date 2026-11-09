-- Portal — Tasks: the Backlog and customer To-Dos become one internal task list
-- Migration 061
--
-- A backlog item (an incoming request) and a customer to-do were the same thing kept in
-- two places. Both become a `task`: the work that's on the back burner until there's time
-- — projects big and small that don't affect a customer's uptime. Internal only; customers
-- never see it.
--
--   status:   open → scheduled → in_progress → waiting → done
--   kind:     task | project
--   priority: low | normal | high | urgent
--   customer_id NULL = internal work ("rebuild the office rack")
--   scheduled_date = the day we plan to do it (the week calendar); due_date = when it must
--   be done by; rank = position in the queue (lower = sooner).
--
-- task_events is each task's history: comments plus status / assignment / schedule
-- changes, so "who's on it and what happened" lives with the task.
--
-- Every backlog item and customer to-do is carried over (legacy_source + legacy_id, so
-- re-running is harmless). The old tables stay in place, unused, until a later migration
-- drops them.

CREATE TABLE IF NOT EXISTS tasks (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  number            SERIAL        UNIQUE,
  title             VARCHAR(255)  NOT NULL,
  notes             TEXT,
  kind              VARCHAR(20)   NOT NULL DEFAULT 'task',
  status            VARCHAR(20)   NOT NULL DEFAULT 'open',
  waiting_on        VARCHAR(20),
  priority          VARCHAR(10)   NOT NULL DEFAULT 'normal',
  customer_id       UUID          REFERENCES customers(id) ON DELETE CASCADE,
  location_id       UUID          REFERENCES customer_locations(id) ON DELETE SET NULL,
  assigned_to       UUID          REFERENCES users(id) ON DELETE SET NULL,
  scheduled_date    DATE,
  due_date          DATE,
  estimated_hours   NUMERIC(6,2),
  rank              INTEGER       NOT NULL DEFAULT 0,
  requested_by      VARCHAR(255),
  requested_phone   VARCHAR(50),
  requested_date    DATE,
  requested_time    VARCHAR(20),
  status_changed_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  done_at           TIMESTAMPTZ,
  done_by           UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_by        UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  legacy_source     VARCHAR(20),
  legacy_id         UUID,
  UNIQUE (legacy_source, legacy_id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned  ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_customer  ON tasks(customer_id);
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_date);

CREATE TABLE IF NOT EXISTS task_events (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID         NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    UUID         REFERENCES users(id) ON DELETE SET NULL,
  kind       VARCHAR(20)  NOT NULL,      -- comment | created | status | assigned | scheduled | due | priority | edited | work_order
  body       TEXT,
  data       JSONB,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, created_at);

-- Carry everything over in the order it was created, so task numbers read chronologically.
-- A backlog item has no title: it takes the first line of its notes, else who called.
INSERT INTO tasks (title, notes, customer_id, assigned_to, status, status_changed_at, done_at, done_by,
                   requested_by, requested_phone, requested_date, requested_time,
                   created_by, created_at, updated_at, legacy_source, legacy_id)
SELECT title, notes, customer_id, assigned_to, status, status_changed_at, done_at, done_by,
       requested_by, requested_phone, requested_date, requested_time,
       created_by, created_at, updated_at, legacy_source, legacy_id
FROM (
  SELECT LEFT(COALESCE(NULLIF(TRIM(t.title), ''), 'To-do'), 255) AS title,
         t.content AS notes, t.customer_id, t.assigned_to,
         CASE WHEN t.is_done THEN 'done' ELSE 'open' END AS status,
         COALESCE(t.done_at, t.updated_at) AS status_changed_at, t.done_at, t.done_by,
         NULL::varchar AS requested_by, NULL::varchar AS requested_phone, NULL::date AS requested_date, NULL::varchar AS requested_time,
         t.created_by, t.created_at, t.updated_at, 'customer_todo' AS legacy_source, t.id AS legacy_id
    FROM customer_todos t
  UNION ALL
  SELECT LEFT(
           CASE WHEN b.customer_id IS NULL AND COALESCE(b.company, '') <> '' THEN b.company || ': ' ELSE '' END ||
           COALESCE(
             NULLIF(LEFT(TRIM(regexp_replace(replace(replace(regexp_replace(COALESCE(b.notes, ''), '<[^>]+>', ' ', 'g'), '&nbsp;', ' '), '&amp;', '&'), '\s+', ' ', 'g')), 120), ''),
             CASE WHEN COALESCE(b.caller_name, '') <> '' THEN 'Request from ' || b.caller_name END,
             'Backlog request'),
           255) AS title,
         b.notes, b.customer_id, b.assigned_to,
         CASE WHEN b.is_done THEN 'done' ELSE 'open' END,
         COALESCE(b.done_at, b.updated_at), b.done_at, b.done_by,
         NULLIF(b.caller_name, ''), NULLIF(b.phone, ''), b.call_date, NULLIF(b.call_time, ''),
         b.created_by, b.created_at, b.updated_at, 'backlog_item', b.id
    FROM backlog_items b
) carried
-- Skip anything already carried over (rather than ON CONFLICT, which would still use up
-- task numbers on a re-run).
WHERE NOT EXISTS (SELECT 1 FROM tasks x WHERE x.legacy_source = carried.legacy_source AND x.legacy_id = carried.legacy_id)
ORDER BY created_at;

-- Queue order for the carried-over tasks: oldest first.
UPDATE tasks SET rank = number * 10 WHERE legacy_source IS NOT NULL AND rank = 0;

INSERT INTO task_events (task_id, user_id, kind, body, created_at)
SELECT t.id, t.created_by, 'created',
       CASE t.legacy_source WHEN 'backlog_item' THEN 'Carried over from the Backlog' ELSE 'Carried over from the customer''s To-Do list' END,
       t.created_at
  FROM tasks t
 WHERE t.legacy_source IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM task_events e WHERE e.task_id = t.id AND e.kind = 'created');
