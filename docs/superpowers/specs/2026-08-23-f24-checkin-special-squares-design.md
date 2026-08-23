# F-24 — Homework + vocab special squares on the check-in board (design)

Feedback F-24 (`8a35bd53-3533-45e8-a39a-f1e38e3bd006`): every student check-in should also show
two squares that are NOT teacher-authored checklist rows — one for the **vocabulary assignment**
(data already in `vocab_assignments`) and one for **physical homework** assigned at the previous
class session (no model today; the old `homework` tables were dropped in migration 0018). The
teacher checks homework yes/no at the next check-in; the vocab square derives from actual
flashcard play. Design artifact (visual): https://claude.ai/code/artifact/4ba9e71e-dac1-48e2-a1b7-212952d339ae

## Decisions locked with the user (do not reopen)

| Question | Decision |
|---|---|
| Where & who taps | Kiosk check-in board; anyone taps (kid or teacher), same as existing cells |
| Vocab yes/no source | Auto-derived from qualifying flashcard rounds; a tap is a manual override and the override wins |
| Homework authoring | New `homework_text` column on `session_previews` (Preview tab) |
| Bag maths | Both squares count toward túi mù / misses / rankings exactly like any cell |
| Empty sessions | A square renders only when something is behind it — never an empty blocker |
| Vocab judge window | Assignments for the class whose deadline ∈ (previous occurrence, this occurrence], wherever they were created |
| Assign UI | Both: event dialog Check-in tab (under the checkout block) AND a kiosk checkout shortcut, same dialog |
| Per-student scope | New join table `vocab_assignment_students`; zero rows = whole class |

## Core design: auto-seeded `checklist_items` with a `kind` column

Special squares become real `checklist_items` rows (`kind` = `'homework' | 'vocab'`; existing rows
default `'custom'`), get-or-created by the `/checkin` loader when backing data exists. Everything
downstream reuses existing machinery unchanged: `checklist_checks` taps, `setCheck` bag logic,
`phaseComplete`, `monthOccurrences` → `tallyTuiMuMonth` month tallies, rankings, `sessionRan`,
audit, tenancy fences.

Guards that make it safe:

1. **Seed race** (two tabs load simultaneously): partial unique index
   `(event_id, date, phase, kind) WHERE kind <> 'custom'` + `ON CONFLICT DO NOTHING` + re-read.
2. **Derivation must not resurrect a teacher's uncheck**: sidecar table
   `checklist_check_seeds(item_id, student_id)` = "the auto-derivation checked this pair once".
   The seed row is written **only together with an auto-inserted check**. A pair that has a seed
   row is never auto-written again — the current check state is manual truth. An *unmet* student
   gets no seed row, so becoming met later still auto-checks them on a later load; a teacher
   manually checking an unmet student is never disturbed either (derivation only ever inserts,
   never deletes).
3. **No retroactive misses**: seeding only runs when `date >= ictToday`. Old occurrences render
   whatever rows they already have; closed months cannot shift.

Homework square: check-in at `(event, D)` reads `session_previews(event, D).homework_text` — the
preview row already describes session D, so no date arithmetic. Non-empty → get-or-create the
`kind='homework'` row with the text as label; cleared → delete the row (checks cascade; tallies
self-correct — the documented `deleteItem` contract). Labels re-sync on edit; ids stay stable.

Vocab square: window = `(prevOccurrenceDate(recurrence, D), D]`; ≥1 assignment for the class in
the window → get-or-create the `kind='vocab'` row labeled with the topic names; 0 → delete it.
A student is "met" when they reached `requiredCount` qualifying rounds for **all** applicable
windowed assignments (narrowed per student where `vocab_assignment_students` rows exist; a
student narrowed out of every assignment is vacuously met and auto-checks).

Special rows are owned by the seeder: the authoring editor and the item CRUD intents refuse to
update/delete/reorder `kind <> 'custom'` rows.

## Schema (migration 0053)

- `ALTER TABLE session_previews ADD COLUMN homework_text TEXT NOT NULL DEFAULT ''`
- `ALTER TABLE checklist_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'custom'`
- `CREATE UNIQUE INDEX uq_checklist_items_special ON checklist_items(event_id, date, phase, kind) WHERE kind <> 'custom'`
- `vocab_assignment_students(assignment_id → vocab_assignments CASCADE, student_id → students CASCADE, PK(both))` — no tenant_id, fence-through-parent
- `checklist_check_seeds(item_id → checklist_items CASCADE, student_id → students CASCADE, seeded_at, PK(item_id, student_id))` — no tenant_id, fence-through-parent

## Per-student narrowing ripples (must land in the same commit as the table)

Every reader of `vocab_assignments` gains the filter "applies to student iff no narrow rows OR a
row for that student": `studentAssignments`, `activeAssignmentsFor`, `studentAssignmentsInMonth`
(fixes the report-card feed for free), `assignmentProgress` (narrows the member list), and
`sweepCore` (**critical** — without it a narrowed assignment garden-penalizes the whole class;
`forecastGardenSweep` shares `sweepCore`). `createAssignment`/`updateAssignment` accept
`studentIds` (replace-set); `getAssignment`/`listAssignments` return `studentIds: string[]`
(empty = whole class). Accepted gap: `deckAssignState` batch coverage stays class-level.

## Accepted risks

- The completion bar rises mid-month on affected occurrences; already-earned bags are never
  revoked (append-only ledger, `checkinFull` lets the ledger win).
- The kiosk checkout "Giao từ vựng" shortcut is reachable by kids on the shared tablet (rides the
  staff session like every kiosk write) — accepted; the dialog is two deliberate steps deep.
- Mobile note: the mobile preview editor must round-trip `homeworkText` in its save payload, or
  its save (which posts the full `SessionPreviewInput`, where `homeworkText` defaults to `''`)
  would silently wipe web-authored homework.
