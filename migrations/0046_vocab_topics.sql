-- The semantic topic set becomes ONE global list for the whole deployment.
--
-- "Topic" is overloaded in this schema, so be precise: `flashcard_topics` is a playable DECK (and,
-- from the curriculum migration onward, also a curriculum unit). `vocab_topics` below is a
-- SEMANTIC TAG on a word — Food, Travel, Environment. A word carries up to five of them.
--
-- Deliberately has no `tenant_id` at all, not even the nullable two-tier kind `flashcard_topics`
-- uses: "Food & Cooking" means the same thing at every school, so there is no school-local tier to
-- have. That also keeps it out of the tripwire's TENANT_TABLES, so reads need no fence.
--
-- The rows are not new: they are lifted verbatim from the hardcoded VOCAB_TOPICS array in
-- shared/logic/vocab-topics.ts, which until now existed only to populate the AI generator's
-- dropdown. `id` IS the old catalog id — which is why these are slugs rather than UUIDs — so any
-- stored reference to a catalog id keeps resolving. test/vocab-topics.test.ts holds the array and
-- this seed to each other so they cannot drift.
CREATE TABLE vocab_topics (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name_en    TEXT NOT NULL,
  name_vi    TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO vocab_topics (id, slug, name_en, name_vi, active, sort_order) VALUES
  ('family','family','Family','Gia đình',1,1),
  ('food','food','Food & Cooking','Ẩm thực & Nấu ăn',1,2),
  ('travel','travel','Travel','Du lịch',1,3),
  ('school','school','School','Trường học',1,4),
  ('animals','animals','Animals','Động vật',1,5),
  ('weather','weather','Weather','Thời tiết',1,6),
  ('sports','sports','Sports','Thể thao',1,7),
  ('health','health','Health','Sức khỏe',1,8),
  ('shopping','shopping','Shopping','Mua sắm',1,9),
  ('technology','technology','Technology','Công nghệ',1,10),
  ('jobs','jobs','Jobs & Work','Nghề nghiệp',1,11),
  ('emotions','emotions','Emotions & Feelings','Cảm xúc',1,12),
  ('clothing','clothing','Clothing','Quần áo',1,13),
  ('home','home','House & Home','Nhà cửa',1,14),
  ('nature','nature','Nature','Thiên nhiên',1,15),
  ('transport','transport','Transportation','Giao thông',1,16),
  ('music-arts','music-arts','Music & Arts','Âm nhạc & Nghệ thuật',1,17),
  ('time','time','Time & Dates','Thời gian & Ngày tháng',1,18),
  ('body','body','The Human Body','Cơ thể người',1,19),
  ('daily','daily','Daily Routines','Sinh hoạt hằng ngày',1,20),
  ('colors-shapes','colors-shapes','Colors & Shapes','Màu sắc & Hình khối',1,21),
  ('numbers','numbers','Numbers','Số đếm',1,22),
  ('hobbies','hobbies','Hobbies & Free Time','Sở thích',1,23),
  ('environment','environment','Environment','Môi trường',1,24);

-- A word's tags. No `tenant_id`: reached only through a word, whose deck is already fenced —
-- the same reasoning that leaves `flashcard_words` without one.
--
-- The column is `vocab_topic_id`, NOT `topic_id`. Everywhere else in this schema `topic_id` means a
-- DECK (`flashcard_topics`), so a join that confuses the two compiles, runs, and returns nothing.
CREATE TABLE vocab_word_topics (
  word_id        TEXT NOT NULL REFERENCES flashcard_words(id) ON DELETE CASCADE,
  vocab_topic_id TEXT NOT NULL REFERENCES vocab_topics(id) ON DELETE CASCADE,
  PRIMARY KEY (word_id, vocab_topic_id)
);
CREATE INDEX idx_vocab_word_topics_topic ON vocab_word_topics(vocab_topic_id);
