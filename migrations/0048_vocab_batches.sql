-- Numbering the words inside a deck, so vocabulary homework can be handed out ten at a time
-- instead of all-or-nothing ("I don't want to assign 100 words all at once, but I will assign 20 at
-- a time").
--
-- Two columns, no new table:
--   flashcard_words.sort_order  1-based position inside its topic. The deck's numbering, and the
--                               only input to a batch label ("1-10").
--   vocab_assignments.batches   which index windows this assignment covers: '1-10,21-30'.
--                               NULL / '' = the whole deck, which is what every row written before
--                               this migration means — so no open homework changes meaning and
--                               there is nothing to backfill.
--
-- WHY THE ORDER HAS TO BE MATERIALISED RATHER THAN DERIVED
--
-- `insertWords` (server/services/flashcards.ts) stamps ONE created_at for every word of an import,
-- so a 100-word paste produces 100 rows with an identical timestamp and `ORDER BY created_at` is
-- not an order at all — today's list only looks stable because SQLite happens to return rowid
-- order. `created_at` is also nullable, so pre-0011 rows sort first. And `rowid` itself is not a
-- durable sort key: this table's primary key is TEXT, so VACUUM may renumber it. Hence a real
-- column, frozen once from today's insertion order, and data from then on.
--
-- WHY A DELETE LEAVES A HOLE INSTEAD OF RENUMBERING
--
-- sort_order is append-only: a new word takes max+1, a deleted word's index is retired, and nothing
-- in the app ever rewrites an existing value. Batches are windows over the VALUE, so deleting word
-- 5 leaves batch 1 holding nine words and batch 2 still means words 11-20. Under a rank-based
-- scheme, deleting word 5 would pull word 11 into batch 1 and silently change which words an
-- assignment already handed to a class refers to — with no error to see and no way to detect it
-- afterwards. A short batch is visible in the picker ("1-10 · 9 words"); a shifted one is not.
--
-- If drag-to-reorder is ever wanted, the stored ranges must first be resolved to word ids in a
-- migration. Ranges are positions, so reordering would rewrite their meaning.

ALTER TABLE flashcard_words ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Freeze the current order. Deliberately no window function: ROW_NUMBER() is almost certainly
-- available on D1's SQLite but is not documented as such, and this runs once over a few thousand
-- rows. `rowid <= rowid` within the topic partition IS the dense rank of insertion order, and
-- insertion order is what a teacher typed or pasted.
UPDATE flashcard_words
SET sort_order = (
  SELECT COUNT(*) FROM flashcard_words w
   WHERE w.topic_id = flashcard_words.topic_id
     AND w.rowid <= flashcard_words.rowid
);

-- Two jobs: it serves every batch read index-only over (topic_id, sort_order), and its uniqueness
-- is the guarantee that makes a batch window a partition rather than an estimate — two words in one
-- deck can never share an index.
CREATE UNIQUE INDEX uq_flashcard_words_order ON flashcard_words(topic_id, sort_order);

-- Canonical form (sorted, merged, always unions of whole 10-windows) lives in
-- shared/logic/vocab-batches.ts; shared/schemas.ts is the gate that rejects a misaligned range.
ALTER TABLE vocab_assignments ADD COLUMN batches TEXT;

-- REPAIR, idempotent. Run by hand if any row turns up still at the default 0 — a word written by a
-- Worker older than this migration, since code reaches the edge before D1 migrations are applied.
-- Ranks the stragglers AFTER their topic's high-water mark rather than interleaving them.
--
--   UPDATE flashcard_words SET sort_order =
--     (SELECT COALESCE(MAX(a.sort_order),0) FROM flashcard_words a
--       WHERE a.topic_id = flashcard_words.topic_id)
--     + (SELECT COUNT(*) FROM flashcard_words b
--         WHERE b.topic_id = flashcard_words.topic_id AND b.sort_order = 0
--           AND b.rowid <= flashcard_words.rowid)
--   WHERE sort_order = 0;
