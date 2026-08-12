-- Example sentences for the sentence-level games (cloze, listen) plus the per-assignment
-- question count for round sizing.
--
-- `example_en` is one simple learner sentence containing the word; `example_answer` is the exact
-- surface form used in it (the AI may inflect: run -> ran), stored separately so the games can
-- blank/grade the real token. Both NULL until AI enrichment or the teacher fills them.
-- `question_count` (5-30) sizes rounds for every mode except flip; NULL = pre-0036 default sizes.
ALTER TABLE flashcard_words ADD COLUMN example_en TEXT;
ALTER TABLE flashcard_words ADD COLUMN example_answer TEXT;
ALTER TABLE vocab_assignments ADD COLUMN question_count INTEGER;
