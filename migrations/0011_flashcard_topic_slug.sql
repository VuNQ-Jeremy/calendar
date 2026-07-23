ALTER TABLE flashcard_topics ADD COLUMN slug TEXT;

-- Best-effort backfill for existing rows: lowercase, spaces to hyphens.
-- Non-ASCII names keep their characters here; renaming the topic in the app
-- regenerates a clean ASCII slug. Old UUID links keep working regardless
-- because lookups fall back to the id.
UPDATE flashcard_topics
SET slug = lower(replace(replace(trim(name), ' ', '-'), '/', '-'))
WHERE slug IS NULL OR slug = '';

CREATE INDEX idx_flashcard_topics_slug ON flashcard_topics(slug);
