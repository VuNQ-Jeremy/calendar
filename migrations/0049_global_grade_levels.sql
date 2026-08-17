-- Khối (grade_levels) becomes ONE global list for the whole deployment, editable by platform admins
-- only and read-only to a school's own Admin.
--
-- Why: the vocabulary curriculum library (0047) is two-tier, and a platform-library curriculum cannot
-- reference one school's Khối 9 row. Khối 6-9 is a national concept — identical at every school — so
-- the per-school copies that 0045 created, and that server/services/tenant-defaults.ts reproduced for
-- every new school, were duplication rather than customization.
--
-- ============================================================================================
-- WHY THIS IS NOT JUST A REBUILD PLUS THREE UPDATEs
-- ============================================================================================
--
-- `tenant_id` is half of UNIQUE (tenant_id, name), which is a sqlite_autoindex, so ALTER TABLE DROP
-- COLUMN refuses and the table has to be rebuilt. But `DROP TABLE` performs an implicit DELETE FROM,
-- and that FIRES FOREIGN KEY ACTIONS — `classes`, `questions` and `tests` all reference this table
-- ON DELETE SET NULL. So by the time the new table exists, all three child columns have already been
-- nulled, and repointing them beforehand achieves nothing.
--
-- This is MEASURED, not inferred. Applying 0045 to production on 2026-08-17 with a baseline recorded
-- first did exactly this:
--
--     classes.grade_level_id            2 -> 0
--     classes.subject_id                2 -> 0
--     classes.class_level_id            2 -> 0
--     score_records.assessment_type_id  2 -> 0
--     tuition_lines (rows)              2 -> 0   (ON DELETE CASCADE deletes rather than nulls)
--
-- `PRAGMA defer_foreign_keys = true` — which 0045 sets — did NOT prevent it: it defers violation
-- REPORTING, not ACTIONS. D1 runs each migration inside an implicit transaction and does not let a
-- migration turn enforcement off, so the standard 12-step "rebuild a table" recipe is unavailable.
--
-- Hence: snapshot the child links, already mapped onto the surviving row, BEFORE the drop; restore
-- them AFTER the rename. Ordering is load-bearing in both directions — a restore before the rename
-- hits "no such table: main.grade_levels".

PRAGMA defer_foreign_keys = true;

-- --------------------------------------------------------------------------------------------
-- 1. Elect one winner per distinct name.
--
--    The original school's row wins if it has one, so the historical ids gl6..gl9 from 0017 survive
--    and its own children need no repointing at all; failing that the lowest id, which is
--    deterministic if this ever has to be re-derived.
-- --------------------------------------------------------------------------------------------

CREATE TABLE _gl_map (old_id TEXT PRIMARY KEY, new_id TEXT NOT NULL, name TEXT NOT NULL);

INSERT INTO _gl_map (old_id, new_id, name)
SELECT g.id,
       (SELECT w.id
          FROM grade_levels w
         WHERE w.name = g.name
         ORDER BY (w.tenant_id = 'tnt_mochi_0001') DESC, w.id ASC
         LIMIT 1),
       g.name
  FROM grade_levels g;

-- --------------------------------------------------------------------------------------------
-- 2. Snapshot the child links, keyed by the CHILD's own id and already mapped onto the winner.
--
--    This MUST precede the DROP — the drop is what destroys them. The JOIN discards NULLs and any
--    already-dangling id for free, so only real links are restored.
-- --------------------------------------------------------------------------------------------

CREATE TABLE _gl_fix_classes   (id TEXT PRIMARY KEY, gl TEXT NOT NULL);
CREATE TABLE _gl_fix_questions (id TEXT PRIMARY KEY, gl TEXT NOT NULL);
CREATE TABLE _gl_fix_tests     (id TEXT PRIMARY KEY, gl TEXT NOT NULL);

INSERT INTO _gl_fix_classes (id, gl)
  SELECT c.id, m.new_id FROM classes   c JOIN _gl_map m ON m.old_id = c.grade_level_id;
INSERT INTO _gl_fix_questions (id, gl)
  SELECT q.id, m.new_id FROM questions q JOIN _gl_map m ON m.old_id = q.grade_level_id;
INSERT INTO _gl_fix_tests (id, gl)
  SELECT t.id, m.new_id FROM tests     t JOIN _gl_map m ON m.old_id = t.grade_level_id;

-- --------------------------------------------------------------------------------------------
-- 3. Rebuild without tenant_id. UNIQUE (name) replaces UNIQUE (tenant_id, name).
--
--    `active` is MAX across the duplicates for the four canonical khối — one school having
--    deactivated Khối 9 must not deactivate it for everybody — but 0 for any other name, so a
--    school's private invention ("Lớp cô Hương buổi tối") survives as a valid FK target without
--    appearing in every other school's picker. Every picker in the app already filters
--    `g.active || g.id === currentValue`, so an inactive survivor shows up only on the row that
--    already uses it, and on /config where a platform admin can curate it.
--
--    `sort_order` is MIN, which reproduces 1..4 for Khối 6..9.
-- --------------------------------------------------------------------------------------------

CREATE TABLE grade_levels_new (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO grade_levels_new (id, name, active, sort_order)
SELECT (SELECT w.id
          FROM grade_levels w
         WHERE w.name = g.name
         ORDER BY (w.tenant_id = 'tnt_mochi_0001') DESC, w.id ASC
         LIMIT 1),
       g.name,
       CASE WHEN g.name IN ('Khối 6','Khối 7','Khối 8','Khối 9') THEN MAX(g.active) ELSE 0 END,
       MIN(g.sort_order)
  FROM grade_levels g
 GROUP BY g.name;

DROP TABLE grade_levels;                            -- nulls the three children; see the header
ALTER TABLE grade_levels_new RENAME TO grade_levels;

-- --------------------------------------------------------------------------------------------
-- 4. Restore and collapse in one pass. The snapshot already holds the winner id, so this is both
--    the recovery from step 3 and the merge of the losing duplicates — one UPDATE per table.
--
--    NOT the naive form, which reads a column the DROP has already emptied:
--      UPDATE classes SET grade_level_id =
--        (SELECT new_id FROM _gl_map WHERE old_id = classes.grade_level_id);   -- always NULL
-- --------------------------------------------------------------------------------------------

UPDATE classes
   SET grade_level_id = (SELECT f.gl FROM _gl_fix_classes f WHERE f.id = classes.id)
 WHERE id IN (SELECT id FROM _gl_fix_classes);

UPDATE questions
   SET grade_level_id = (SELECT f.gl FROM _gl_fix_questions f WHERE f.id = questions.id)
 WHERE id IN (SELECT id FROM _gl_fix_questions);

UPDATE tests
   SET grade_level_id = (SELECT f.gl FROM _gl_fix_tests f WHERE f.id = tests.id)
 WHERE id IN (SELECT id FROM _gl_fix_tests);

-- --------------------------------------------------------------------------------------------
-- 5. Scratch. The id map is KEPT (renamed rather than dropped): it is the only record of which
--    school's khối row became which global one, and there is no down-migration — re-splitting would
--    need to know which school each child belonged to, which is unrecoverable for `questions`, whose
--    tenant_id is nullable by design. Drop it in a later migration once nobody has asked.
-- --------------------------------------------------------------------------------------------

DROP TABLE _gl_fix_classes;
DROP TABLE _gl_fix_questions;
DROP TABLE _gl_fix_tests;
ALTER TABLE _gl_map RENAME TO grade_levels_merge_0049;
