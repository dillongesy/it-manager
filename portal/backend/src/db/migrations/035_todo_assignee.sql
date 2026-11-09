-- Portal — assign customer To-Dos to a technician
-- Migration 035
--
-- A customer to-do can be assigned to a tech so it surfaces in their view (the
-- Backlog page's "Customer To-Dos" tab, tech-filtered) as well as on the customer's
-- own To-Do tab. NULL = unassigned.

ALTER TABLE customer_todos ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customer_todos_assigned ON customer_todos(assigned_to);
