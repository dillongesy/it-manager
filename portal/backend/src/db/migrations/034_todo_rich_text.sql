-- Portal — customer To-Dos become free-form (rich text, like Guides)
-- Migration 034
--
-- Each to-do gains a short `title` (the checklist line shown in lists) while `content`
-- now holds rich-text HTML (formatting + inline base64 images), mirroring guides.
-- Existing plain-text to-dos: seed the title from the old content so nothing is lost.

ALTER TABLE customer_todos ADD COLUMN IF NOT EXISTS title VARCHAR(255);

UPDATE customer_todos SET title = LEFT(content, 120) WHERE title IS NULL OR title = '';

-- content was NOT NULL; a rich to-do may legitimately have an empty body, so relax it.
ALTER TABLE customer_todos ALTER COLUMN content DROP NOT NULL;
