-- Shared text a question belongs to: a reading passage, a cloze paragraph, or the section
-- instruction that introduces a run of questions ("Read the passage and answer questions 30-36").
-- Nullable and unindexed: most questions stand alone, and nothing ever queries by it — it is
-- rendered above the prompt wherever the question is shown.
ALTER TABLE questions ADD COLUMN context TEXT;
