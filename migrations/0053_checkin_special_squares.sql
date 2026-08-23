-- F-24: homework + vocab special squares on the check-in board, per-student vocab scope.
--
-- Special squares are ordinary checklist_items rows (kind 'homework' | 'vocab') seeded by the
-- /checkin loader, so taps, bags, misses and month tallies reuse the existing machinery. The
-- partial unique index is what makes concurrent get-or-create seeding collapse to a no-op.

-- The teacher's "bài tập về nhà" prose for the session this preview describes. The check-in of
-- (event, date) reads its OWN preview row — no previous-occurrence arithmetic for homework.
ALTER TABLE session_previews ADD COLUMN homework_text TEXT NOT NULL DEFAULT '';

-- 'custom' = teacher-authored (every existing row); 'homework'/'vocab' = system-seeded. Seeded
-- rows are id-stable like every other checklist item; only their label is rewritten.
ALTER TABLE checklist_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'custom';

-- At most ONE special square of each kind per occurrence+phase.
CREATE UNIQUE INDEX uq_checklist_items_special
  ON checklist_items(event_id, date, phase, kind) WHERE kind <> 'custom';

-- Per-student narrowing of a vocab assignment. ZERO rows = whole class — the meaning every
-- existing assignment keeps. No tenant_id: reached only through its assignment, which is
-- scoped — the same fence-through-parent pattern checklist_checks uses.
CREATE TABLE vocab_assignment_students (
  assignment_id TEXT NOT NULL REFERENCES vocab_assignments(id) ON DELETE CASCADE,
  student_id    TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (assignment_id, student_id)
);

-- "The vocab auto-derivation checked this (item, student) once." Written ONLY alongside an
-- auto-inserted check; its presence means the current check state is manual truth and the
-- derivation must keep its hands off. An unmet student gets no row, so becoming met later
-- still auto-checks them.
CREATE TABLE checklist_check_seeds (
  item_id    TEXT NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  seeded_at  TEXT NOT NULL,
  PRIMARY KEY (item_id, student_id)
);
