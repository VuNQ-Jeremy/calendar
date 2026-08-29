-- 0056: mascot logo library (ipaslogo.com, "free to download and use commercially").
--
-- Deliberately NOT tenant-scoped, for the same reason as global_grade_levels: this is shared
-- reference art, identical for every school, and nobody edits it from the app. Reads therefore
-- skip TenantDb entirely -- there is no `own`/`pool` decision to get wrong here.
--
-- Rows are generated, not hand-written: scripts/import-logos.mjs classifies each source filename
-- with the hand-authored lexicon in scripts/logo-taxonomy.mjs and emits scripts/logo-library-seed.sql.
-- Re-running the importer regenerates that file deterministically; there is no model call in the
-- path, so a re-run against the same corpus produces byte-identical SQL.
--
-- The stored asset is the 512px webp preview (~9KB), not the 1254px source png (~1.1MB): the whole
-- library is 33MB in R2 that way. `source_width`/`source_height` record the original so a
-- higher-resolution re-import later does not need to re-derive them.
CREATE TABLE logo_library (
  -- The 16-hex content hash the source filename carries; already collision-free across the corpus.
  id TEXT PRIMARY KEY,
  -- R2 object key under the FILES bucket, e.g. 'logos/a746787047a05c50-quokka-2.webp'.
  storage_key TEXT NOT NULL UNIQUE,
  -- Full descriptive slug from the filename, e.g. 'deer-alert-round-eyes-left'.
  slug TEXT NOT NULL,
  -- Level 1: one of the 12 buckets in scripts/logo-taxonomy.mjs BUCKETS.
  category TEXT NOT NULL,
  -- Level 2: the subject head noun, e.g. 'cat', 'whale', 'moka-pot'.
  subject TEXT NOT NULL,
  -- Nth drawing of the same subject; 1 when the filename carries no trailing number.
  variant INTEGER NOT NULL DEFAULT 1,
  -- Flat background the artwork was composed on; lets a grid render a placeholder before load.
  background_color TEXT NOT NULL,
  source_width INTEGER NOT NULL,
  source_height INTEGER NOT NULL
);

-- Browsing is always "pick a category, then scan subjects", so the composite leads on category.
CREATE INDEX idx_logo_library_category_subject ON logo_library(category, subject);
-- Searching by subject across categories ("every cat") needs its own entry point.
CREATE INDEX idx_logo_library_subject ON logo_library(subject);
