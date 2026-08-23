# F-24 Check-in Special Squares Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task in ONE session. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution contract (overrides the usual per-task commits):** the user asked for a SINGLE
> commit and push at the very end. Do NOT commit after each task. Verify with static checks as
> you go; Task 10 is the only task that touches git.
>
> **If blocked or unsure:** an Opus 5 clarifier session is available; the brief it works from is
> `docs/superpowers/plans/2026-08-23-f24-checkin-special-squares-clarifier.md`. Ask the user to
> relay questions rather than guessing on anything that document flags as load-bearing.

**Goal:** Two data-backed squares on the check-in kiosk board — physical homework (authored as
`session_previews.homework_text`) and the vocab assignment (auto-derived, tap-overridable) — both
counting toward túi mù, plus per-student vocab assignment scope and a "Giao từ vựng" assign
surface at checkout.

**Architecture:** Special squares are real `checklist_items` rows with a new `kind` column,
get-or-created idempotently by the `/checkin` loader; all tap/bag/miss/tally machinery reuses the
existing paths unchanged. Per-student scope is a join table `vocab_assignment_students` (zero
rows = whole class) filtered in five existing `vocab_assignments` readers.

**Tech Stack:** React Router v7 on Cloudflare Workers, D1 + Drizzle, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-23-f24-checkin-special-squares-design.md` (read it first).

## Global Constraints

- Windows machine, PowerShell/Git Bash. No local dev server; verification is static checks only.
- Typecheck ONLY via `npm run typecheck` — never `tsc -b` (emits ~150 stray .js files).
- Free checks you may run at will: `npm run typecheck`, `npm run lint`, `npm run check:i18n`,
  `cd mobile && npm test` (needs Node 24). `npx prettier --write <only-files-you-touched>` — never
  repo-wide `npm run format` (CRLF tree makes it rewrite everything).
- Unit/e2e/worker SUITES ARE MANUAL-TRIGGER ONLY. Write the specs; NEVER run `npm test`,
  `npm run test:worker`, `npm run test:e2e*`, `npm run test:env:setup`, or `cd mobile && npm run
  test:device`/`test:bundle`.
- NO paid API calls (Anthropic /enrich-vocab, /generate-vocab; Workers AI images; Azure speech).
  Nothing in this plan needs one.
- Push to `main` only; no branches. ONE commit at the very end (Task 10), including a changelog
  entry via `node scripts/changelog.mjs "..."`.
- i18n: every new user-visible string gets an EN key and a VI key in `shared/i18n/strings.ts`;
  `npm run check:i18n` must pass.
- Multi-tenancy: every new raw query on a tenant-less table carries a `// tenant-unscoped:` escape
  comment naming its fence, matching the existing style in `server/services/checkin.ts` (the
  tripwire test looks for these).
- Match surrounding code style exactly — comment density, naming, JSDoc tone. These files are
  heavily commented with *why*-comments; keep that up.

---

### Task 1: Migration 0053 + Drizzle mirror + reset sweep

**Files:**
- Create: `migrations/0053_checkin_special_squares.sql`
- Modify: `server/db/schema.ts` (sessionPreviews ~line 641, checklistItems ~line 1538, new tables after checklistChecks ~line 1590)
- Modify: `scripts/test-accounts.sql` (near line 68 `DELETE FROM vocab_assignments;` and near line 133 `DELETE FROM checklist_checks;`)

**Interfaces:**
- Produces: columns `session_previews.homework_text`, `checklist_items.kind`; tables
  `vocab_assignment_students(assignment_id, student_id)`, `checklist_check_seeds(item_id,
  student_id, seeded_at)`; Drizzle objects `vocabAssignmentStudents`, `checklistCheckSeeds`,
  `sessionPreviews.homeworkText`, `checklistItems.kind`.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Mirror in `server/db/schema.ts`**

In `sessionPreviews` add after `vocabTopicId`:

```ts
    /** "Bài tập về nhà" for THIS session — the check-in homework square's text. */
    homeworkText: text('homework_text').notNull().default(''),
```

In `checklistItems` add after `phase`:

```ts
    /** 'custom' = teacher-authored; 'homework' | 'vocab' = seeded by the /checkin loader. */
    kind: text('kind').notNull().default('custom'),
```

and extend the table's third argument (currently one index) — `uniqueIndex` and `sql` are
imported at the top of the file already for other tables; add them to the existing import lists
if missing:

```ts
  (t) => [
    index('idx_checklist_items_occ').on(t.eventId, t.date, t.phase),
    // One special square of each kind per occurrence+phase — the seeding race collapses on this.
    uniqueIndex('uq_checklist_items_special')
      .on(t.eventId, t.date, t.phase, t.kind)
      .where(sql`kind <> 'custom'`),
  ],
```

After `checklistChecks` (~line 1590) add both new tables:

```ts
/**
 * Per-student narrowing of a vocab assignment. ZERO rows = the whole class — the meaning every
 * assignment written before 0053 keeps. No `tenantId`: reached only through its assignment,
 * which is scoped (the checklist_checks fence-through-parent pattern).
 */
export const vocabAssignmentStudents = sqliteTable(
  'vocab_assignment_students',
  {
    assignmentId: text('assignment_id')
      .notNull()
      .references(() => vocabAssignments.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.assignmentId, t.studentId] })],
);

/**
 * "The vocab auto-derivation checked this (item, student) once." Written only alongside an
 * auto-inserted check; presence means the current check state is manual truth. No `tenantId`:
 * the item is reached through a fenced event, same as checklistChecks.
 */
export const checklistCheckSeeds = sqliteTable(
  'checklist_check_seeds',
  {
    itemId: text('item_id')
      .notNull()
      .references(() => checklistItems.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    /** UTC ISO. */
    seededAt: text('seeded_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.studentId] })],
);
```

- [ ] **Step 3: Reset sweep** — in `scripts/test-accounts.sql` add
  `DELETE FROM vocab_assignment_students;` on the line ABOVE `DELETE FROM vocab_assignments;`,
  and `DELETE FROM checklist_check_seeds;` on the line ABOVE `DELETE FROM checklist_checks;`
  (children before parents; a failed run must not leak rows into the next reset).

- [ ] **Step 4: Verify** — `npm run typecheck` passes (nothing consumes the new objects yet).

---

### Task 2: Pure logic + unit tests

**Files:**
- Modify: `shared/logic/checkin.ts` (add near `nextOccurrenceDate` at the bottom; `addDaysIct` already exists there)
- Test: `test/checkin-logic.test.ts` (append new describes; note the file imports from `../shared/logic/checkin.js` with `.js` suffix)

**Interfaces:**
- Produces: `type ChecklistKind = 'custom' | 'homework' | 'vocab'`;
  `prevOccurrenceDate(recurrence: string | null | undefined, date: string): string | null`;
  `deadlineInVocabWindow(deadline: string, prevDate: string | null, date: string): boolean`;
  `vocabSquareMet(perAssignment: { done: number; requiredCount: number }[]): boolean`.
- Consumed by: Task 5 (`server/services/checkin.ts`) and Task 6 (kiosk/editor rendering by `kind`).

- [ ] **Step 1: Write the failing tests** (append to `test/checkin-logic.test.ts`; extend the
  existing import block with the three new names):

```ts
describe('prevOccurrenceDate', () => {
  it('weekly steps back 7 ICT days, daily 1, one-off null', () => {
    expect(prevOccurrenceDate('weekly', '2026-08-23')).toBe('2026-08-16');
    expect(prevOccurrenceDate('daily', '2026-08-23')).toBe('2026-08-22');
    expect(prevOccurrenceDate('none', '2026-08-23')).toBeNull();
    expect(prevOccurrenceDate(null, '2026-08-23')).toBeNull();
  });
  it('crosses month boundaries', () => {
    expect(prevOccurrenceDate('weekly', '2026-09-03')).toBe('2026-08-27');
  });
});

describe('deadlineInVocabWindow', () => {
  it('is (prev, date] — exclusive at the previous session, inclusive today', () => {
    expect(deadlineInVocabWindow('2026-08-16', '2026-08-16', '2026-08-23')).toBe(false);
    expect(deadlineInVocabWindow('2026-08-17', '2026-08-16', '2026-08-23')).toBe(true);
    expect(deadlineInVocabWindow('2026-08-23', '2026-08-16', '2026-08-23')).toBe(true);
    expect(deadlineInVocabWindow('2026-08-24', '2026-08-16', '2026-08-23')).toBe(false);
  });
  it('null prev (one-off event) degrades to deadline === date, never open-ended', () => {
    expect(deadlineInVocabWindow('2026-08-23', null, '2026-08-23')).toBe(true);
    expect(deadlineInVocabWindow('2026-08-22', null, '2026-08-23')).toBe(false);
  });
});

describe('vocabSquareMet', () => {
  it('all assignments met', () => {
    expect(
      vocabSquareMet([
        { done: 3, requiredCount: 3 },
        { done: 5, requiredCount: 2 },
      ]),
    ).toBe(true);
  });
  it('one short → not met', () => {
    expect(
      vocabSquareMet([
        { done: 3, requiredCount: 3 },
        { done: 1, requiredCount: 2 },
      ]),
    ).toBe(false);
  });
  it('zero applicable assignments is vacuously met (fully narrowed-away student)', () => {
    expect(vocabSquareMet([])).toBe(true);
  });
});
```

- [ ] **Step 2: Implement** in `shared/logic/checkin.ts` (place right after `nextOccurrenceDate`,
  before the `addDaysIct` helper it reuses):

```ts
/** What kind of checklist cell a row is. Non-custom rows are seeded by the /checkin loader. */
export type ChecklistKind = 'custom' | 'homework' | 'vocab';

/**
 * Mirror of nextOccurrenceDate: the occurrence BEFORE this one. Weekly → −7 ICT days,
 * daily → −1; one-off events have no previous occurrence.
 */
export function prevOccurrenceDate(
  recurrence: string | null | undefined,
  date: string,
): string | null {
  if (recurrence === 'weekly') return addDaysIct(date, -7);
  if (recurrence === 'daily') return addDaysIct(date, -1);
  return null;
}

/**
 * Does an assignment deadline fall in this occurrence's vocab window (prevDate, date]?
 * A null prevDate (one-off event) degrades to deadline === date — never an open-ended lower
 * bound, so ancient assignments cannot leak into a new event's first check-in.
 */
export function deadlineInVocabWindow(
  deadline: string,
  prevDate: string | null,
  date: string,
): boolean {
  if (prevDate == null) return deadline === date;
  return deadline > prevDate && deadline <= date;
}

/**
 * Is the vocab square "met" for one student? Every applicable assignment satisfied; an empty
 * list is vacuously met — a student narrowed out of every windowed assignment was never asked
 * for anything, and must not lose the day's bag over it.
 */
export function vocabSquareMet(
  perAssignment: { done: number; requiredCount: number }[],
): boolean {
  return perAssignment.every((a) => a.done >= a.requiredCount);
}
```

- [ ] **Step 3: Verify** — `npm run typecheck` passes. Do NOT run the vitest suite; the specs
  are written and the user runs suites.

---

### Task 3: `homework_text` end-to-end (schema → service → routes → web Preview tab → mobile)

**Files:**
- Modify: `shared/schemas.ts` (`SessionPreviewInput`, line ~251)
- Modify: `shared/api-contract.ts` (`SessionPreviewRow`, line ~296)
- Modify: `server/services/session-preview.ts` (`SessionPreviewRow` type, `map`, `save`)
- Modify: `app/routes/event-previews.tsx` (action)
- Modify: `src/calendar/event-modal.tsx` (`PreviewTab`, lines ~181–265)
- Modify: `mobile/lib/types.ts` (`SessionPreviewRow`, line ~242), `mobile/lib/staff-data.ts`
  (`useSavePreview`, line ~205), `mobile/components/PreviewEditor.tsx`
- (No change needed in `app/routes/api.event-previews.tsx` — it parses the full
  `SessionPreviewInput` via `parseBody`, which picks the new field up automatically.)

**Interfaces:**
- Consumes: `sessionPreviews.homeworkText` from Task 1.
- Produces: `SessionPreviewInput.homeworkText: string` (Zod, default `''`);
  `SessionPreviewRow.homeworkText: string` on server, contract, and mobile types.
  Task 5 reads the column directly via Drizzle (not through this service).

- [ ] **Step 1: Zod input** — in `SessionPreviewInput` add after `focusText`:

```ts
  /** "Bài tập về nhà" for this session — becomes the check-in homework square. */
  homeworkText: z.string().max(2000).default(''),
```

- [ ] **Step 2: API contract** — in `shared/api-contract.ts` `SessionPreviewRow`, add
  `homeworkText: z.string(),` after `focusText`.

- [ ] **Step 3: Service** — in `server/services/session-preview.ts`:
  - `SessionPreviewRow` type: add `homeworkText: string;` after `focusText`.
  - `map()`: add `homeworkText: r.homeworkText,`.
  - `save()`: add `homeworkText: input.homeworkText,` to `values` AND to the
    `onConflictDoUpdate` `set` object.

- [ ] **Step 4: Web action** — in `app/routes/event-previews.tsx` `actionImpl`, add to the
  `safeParse` object: `homeworkText: formData.get('homeworkText') ?? '',`.

- [ ] **Step 5: Web Preview tab** — in `PreviewTab` (`src/calendar/event-modal.tsx`):
  - state: `const [homeworkText, setHomeworkText] = React.useState('');`
  - seed effect: add `setHomeworkText(data.preview?.homeworkText ?? '');`
  - `save()`: add `fd.set('homeworkText', homeworkText);`
  - render, directly under the focus-text field (same `mochi-field` pattern):

```tsx
      <div className="mochi-field">
        <label className="mochi-field__label">{t('prev_homework_label')}</label>
        <textarea
          className="mochi-input"
          rows={2}
          placeholder={t('prev_homework_ph')}
          value={homeworkText}
          onChange={(e) => setHomeworkText(e.target.value)}
          style={{ resize: 'vertical', minHeight: 56 }}
        />
      </div>
```

- [ ] **Step 6: Mobile round-trip** — REQUIRED, or a mobile save wipes web-authored homework
  (the API action parses the full input, where `homeworkText` defaults to `''`):
  - `mobile/lib/types.ts` `SessionPreviewRow`: add `homeworkText: string;`.
  - `mobile/lib/staff-data.ts` `useSavePreview` mutationFn input type: add
    `homeworkText: string;` and pass it through (it already spreads `...input`).
  - `mobile/components/PreviewEditor.tsx`: add `homeworkText` state seeded like `focusText`
    (`setHomeworkText(data.preview?.homeworkText ?? '')` inside the seeded-once effect), an
    `<Input label={t('prev_homework_label')} placeholder={t('prev_homework_ph')} value={homeworkText} onChangeText={setHomeworkText} />`
    under the focus input, and include `homeworkText` in `save.mutate({...})`.

- [ ] **Step 7: Verify** — `npm run typecheck` and `cd mobile && npm test` (free, ~1s) pass.
  (i18n keys `prev_homework_label` / `prev_homework_ph` land in Task 7; `check:i18n` is run there.)

---

### Task 4: Per-student vocab scope (garden service + schemas + AssignModal)

**Files:**
- Modify: `shared/schemas.ts` (`VocabAssignmentInput`, line ~1277)
- Modify: `server/services/garden.ts` (`VocabAssignmentRow` + `listAssignments` ~269,
  `getAssignment` ~308, `createAssignment` ~335, `updateAssignment` ~359, `assignmentProgress`
  ~514, `activeAssignmentsFor` ~602, `studentAssignments` ~646, `studentAssignmentsInMonth` ~736,
  `sweepCore` ~1485; new helpers near `countQualifying` ~557)
- Modify: `src/garden/assign-modal.tsx`
- Modify: `src/flashcards/index.tsx` (AssignModal call site ~line 504 — only if a prop rename
  forces it; the new props are optional, so likely no change)

**Interfaces:**
- Consumes: `vocabAssignmentStudents` from Task 1.
- Produces: `VocabAssignmentInput.studentIds: string[] | null` (CSV in, array out);
  `VocabAssignmentRow.studentIds: string[]`;
  `qualifyingCounts(db, a, studentIds): Promise<Map<string, number>>` (exported);
  `narrowMap(db, assignmentIds): Promise<Map<string, Set<string>>>` (module-private).
  Task 5 consumes `qualifyingCounts` and reads `vocabAssignmentStudents` directly.

- [ ] **Step 1: Zod field** — add to `VocabAssignmentInput` after `batches` (same CSV-with-NULL
  shape as `modes`):

```ts
  /**
   * Which students this assignment applies to: a CSV of student ids, or NULL / '' for the whole
   * class — the meaning every assignment written before 0053 keeps. Stored as join rows in
   * vocab_assignment_students (zero rows = whole class), same NULL-means-everything shape as
   * `modes` above.
   */
  studentIds: z
    .string()
    .max(2000)
    .nullish()
    .transform((v) => {
      if (v == null || v === '') return null;
      const ids = v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return ids.length ? ids : null;
    }),
```

- [ ] **Step 2: Narrow helpers + qualifying export** in `server/services/garden.ts`. Import
  `vocabAssignmentStudents` in the schema import block. Add near `countQualifying`:

```ts
/**
 * assignmentId -> the students it is narrowed to. An absent key means the whole class — the
 * meaning of zero join rows. Filtered in JS on purpose: a class has a handful of assignments
 * and this avoids a correlated subquery in the five readers that need it.
 */
async function narrowMap(
  db: TenantDb,
  assignmentIds: string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!assignmentIds.length) return out;
  // tenant-unscoped: vocab_assignment_students has no tenant_id — every id here comes from an
  // already own-scoped vocab_assignments read.
  const rows = await db.raw
    .select()
    .from(vocabAssignmentStudents)
    .where(inArray(vocabAssignmentStudents.assignmentId, assignmentIds));
  for (const r of rows) {
    let s = out.get(r.assignmentId);
    if (!s) out.set(r.assignmentId, (s = new Set()));
    s.add(r.studentId);
  }
  return out;
}

/** Does this assignment apply to this student, given its narrow set (absent = whole class)? */
function appliesTo(narrow: Set<string> | undefined, studentId: string): boolean {
  return !narrow || narrow.has(studentId);
}

/**
 * Qualifying-round counts for one assignment over its own window — the checkin service's way
 * into `countQualifying` without re-deriving the created_at..deadlineEndUtc window rules.
 */
export async function qualifyingCounts(
  db: TenantDb,
  a: {
    topicId: string;
    minScorePct: number;
    createdAt: string;
    deadline: string;
    deadlineTime: string | null;
    modes: string | null;
  },
  studentIds: string[],
): Promise<Map<string, number>> {
  return countQualifying(
    db,
    a.topicId,
    studentIds,
    a.minScorePct,
    a.createdAt,
    deadlineEndUtc(a.deadline, a.deadlineTime),
    parseModes(a.modes),
  );
}
```

- [ ] **Step 3: Rows carry scope** — `VocabAssignmentRow` type gains
  `/** Narrowed-to students; empty = the whole class. */ studentIds: string[];`.
  In `listAssignments`, after the select resolves, load `narrowMap(db, rows.map(r => r.id))`
  once and return `rows.map((r) => ({ ...r, studentIds: [...(narrow.get(r.id) ?? [])] }))`.
  In `getAssignment`, same for the single row.

- [ ] **Step 4: CRUD** —
  - `createAssignment`: after the insert, when `input.studentIds?.length`:

```ts
  if (input.studentIds?.length) {
    // tenant-unscoped: fenced by the assignment insert above, which is tenant-scoped.
    await db.raw
      .insert(vocabAssignmentStudents)
      .values(input.studentIds.map((studentId) => ({ assignmentId: id, studentId })))
      .onConflictDoNothing();
  }
```

  - `updateAssignment`: after the column update, replace-set when the field was submitted at all
    (`'studentIds' in patch` — `null` means "back to whole class", absent means "don't touch"):

```ts
  if (patch.studentIds !== undefined) {
    // Replace-set, the event-materials pattern: join rows carry no children of their own.
    // tenant-unscoped: fenced by the caller's own-scoped assignment update above.
    await db.raw
      .delete(vocabAssignmentStudents)
      .where(eq(vocabAssignmentStudents.assignmentId, id));
    if (patch.studentIds?.length) {
      await db.raw
        .insert(vocabAssignmentStudents)
        .values(patch.studentIds.map((studentId) => ({ assignmentId: id, studentId })))
        .onConflictDoNothing();
    }
  }
```

  - `deleteAssignment`: no change (FK cascade).

- [ ] **Step 5: The five readers.** Pattern everywhere: load `narrowMap` for the candidate
  assignment ids, then drop what doesn't apply.
  - `studentAssignments`: after `const open = rows.filter(...)`, add
    `const narrow = await narrowMap(db, open.map((a) => a.id));` and change the loop to skip
    `if (!appliesTo(narrow.get(a.id), studentId)) continue;`.
  - `activeAssignmentsFor`: same — narrow the post-filtered array before returning:
    `const narrow = await narrowMap(db, rows.map((a) => a.id)); return rows.filter((a) => nowIso < deadlineEndUtc(a.deadline, a.deadlineTime) && appliesTo(narrow.get(a.id), studentId));`.
  - `studentAssignmentsInMonth`: narrow `list` the same way before the progress loop (this is
    what keeps the report card honest for narrowed assignments).
  - `assignmentProgress`: after loading `members`, narrow the member list:
    `const narrow = (await narrowMap(db, [assignment.id])).get(assignment.id); const scoped = members.filter((m) => appliesTo(narrow, m.id));` and use `scoped` for both `countQualifying` and the returned rows.
  - `sweepCore` (**CRITICAL — same commit as the table or narrowed assignments garden-penalize
    the whole class**): inside the `for (const a of overdue)` loop, right after `members` loads:
    `const narrow = (await narrowMap(db, [a.id])).get(a.id);` then in the member loop add
    `if (!appliesTo(narrow, m.studentId)) continue;` before the `done.has` check.

- [ ] **Step 6: AssignModal** (`src/garden/assign-modal.tsx`) — two additive optional
  capabilities; the existing `/flashcards` caller keeps working unchanged:
  - Props: `topic` becomes `topic?: { id: string; name: string } | null`; add
    `topics?: { id: string; name: string }[]` and
    `rosterStudents?: { id: string; name: string }[]`.
  - Topic picker state: `const [topicId, setTopicId] = React.useState(existing?.topicId ?? topic?.id ?? '');`
    When `!topic`, render above the class select:

```tsx
      {!topic && (
        <MSelect
          label={t('garden_assign_topic')}
          value={topicId}
          onChange={setTopicId}
          options={(topics ?? []).map((x) => ({ value: x.id, label: x.name }))}
        />
      )}
```

    `submit()` sets `fd.set('topicId', topic?.id ?? topicId);` and `valid` becomes
    `Boolean(classId && deadline && (topic?.id || topicId) && (scopeAll || picked.size > 0))`.
    The `Modal` `subtitle` becomes `topic?.name ?? topics?.find((x) => x.id === topicId)?.name ?? ''`.
  - Scope state:

```ts
  // Whole class is the default AND the meaning of zero join rows; editing preloads the stored
  // narrow set so a save from a surface without the picker cannot silently widen the scope.
  const [scopeAll, setScopeAll] = React.useState(!(existing?.studentIds?.length ?? 0));
  const [picked, setPicked] = React.useState<Set<string>>(
    () => new Set(existing?.studentIds ?? []),
  );
```

    In `submit()`:

```ts
    // '' means the whole class through the schema's transform. When this dialog has no roster
    // picker (the /flashcards surface), echo the stored scope back unchanged.
    fd.set(
      'studentIds',
      rosterStudents
        ? scopeAll
          ? ''
          : [...picked].join(',')
        : (existing?.studentIds ?? []).join(','),
    );
```

    Render (only when `rosterStudents` is provided), below the modes field — radio pair styled
    with the existing `Checkbox` component for the student list:

```tsx
      {rosterStudents && (
        <div className="mochi-field">
          <label className="mochi-field__label">{t('garden_scope_label')}</label>
          <div className="m-row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <Checkbox
              checked={scopeAll}
              onChange={() => setScopeAll(true)}
              label={t('garden_scope_all')}
            />
            <Checkbox
              checked={!scopeAll}
              onChange={() => setScopeAll(false)}
              label={t('garden_scope_selected')}
            />
          </div>
          {!scopeAll && (
            <div className="m-row" style={{ gap: '4px 14px', flexWrap: 'wrap', marginTop: 6 }}>
              {rosterStudents.map((s) => (
                <Checkbox
                  key={s.id}
                  checked={picked.has(s.id)}
                  onChange={(on: boolean) =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(s.id);
                      else next.delete(s.id);
                      return next;
                    })
                  }
                  label={s.name}
                />
              ))}
            </div>
          )}
        </div>
      )}
```

    NOTE: check `Checkbox`'s actual prop names in `src/ds` before writing (it may take
    `onCheckedChange` or children instead of `label`) and mirror how `assign-modal.tsx` already
    uses it for modes.

- [ ] **Step 7: Verify** — `npm run typecheck` and `npm run lint` pass.

---

### Task 5: Check-in service seeding + `/checkin` loader wiring

**Files:**
- Modify: `server/services/checkin.ts`
- Modify: `app/routes/checkin.tsx`

**Interfaces:**
- Consumes: `ChecklistKind`, `prevOccurrenceDate`, `deadlineInVocabWindow`, `vocabSquareMet`
  (Task 2); `qualifyingCounts` (Task 4); `checklistCheckSeeds`, `vocabAssignmentStudents`,
  `checklistItems.kind`, `sessionPreviews.homeworkText` (Task 1); `ictDateOf` from
  `shared/logic/tests`.
- Produces: `ChecklistItemRow.kind: ChecklistKind`;
  `ensureSpecialItems(db, eventId, date, nowUtcIso): Promise<void>`;
  `seedVocabChecks(db, eventId, date, rosterIds, nowUtcIso): Promise<void>`;
  `/checkin` loader payload gains `openAssignments: VocabAssignmentRow[]`.

- [ ] **Step 1: `kind` through the row type.** Imports: add `ChecklistKind`,
  `prevOccurrenceDate`, `deadlineInVocabWindow`, `vocabSquareMet` to the `shared/logic/checkin`
  import; add `checklistCheckSeeds`, `vocabAssignmentStudents`, `flashcardTopics`,
  `sessionPreviews`, `vocabAssignments` to the schema import; add
  `import { ictDateOf } from '../../shared/logic/tests';` and
  `import { qualifyingCounts } from './garden';`.
  - `ChecklistItemRow`: add `kind: ChecklistKind;` — `mapItem`: add `kind: r.kind as ChecklistKind,`.
  - `createItem`: add `kind: 'custom',` to the insert values (explicit beats default).

- [ ] **Step 2: Seeder owns special rows.** Guard the editor CRUD:
  - `updateItem`: after `if (!before) return null;` add
    `if (before.kind !== 'custom') return null; // special rows belong to the seeder — 404, same answer as a foreign id`
  - `deleteItem`: fetch via `ownedItem` into a variable instead of the bare truthiness check and
    keep the existing `recordDelete` + delete calls unchanged below the guard:

```ts
/** Checks cascade with the item — a removed cell takes its taps with it, and tallies self-correct. */
export async function deleteItem(db: TenantDb, id: string): Promise<void> {
  const item = await ownedItem(db, id);
  // Special rows belong to the seeder (ensureSpecialItems) — the editor cannot delete them.
  if (!item || item.kind !== 'custom') return;
  // `checklist_items` carries no tenant_id, so `recordDelete`'s own fence degrades to a plain
  // id match here — `ownedItem` above is what makes that safe.
  await recordDelete(db, 'checklist_item', checklistItems, id);
  await db.raw.delete(checklistItems).where(eq(checklistItems.id, id));
}
```

  - `reorderItems`: extend the `owned` query's `where` with
    `eq(checklistItems.kind, 'custom')` so seeded rows fall out of the renumbering the same way
    foreign ids do.

- [ ] **Step 3: Extend `ownedEvent`** to also return the recurrence (both callers destructure
  only what they need):

```ts
async function ownedEvent(
  db: TenantDb,
  eventId: string,
): Promise<{ classId: string | null; recurrence: string } | null> {
  const rows = await db.raw
    .select({ classId: events.classId, recurrence: events.recurrence })
    .from(events)
    .where(db.own(events, eq(events.id, eventId)));
  return rows[0] ?? null;
}
```

- [ ] **Step 4: `ensureSpecialItems` + helpers** (place after `reorderItems`, before the kiosk
  write section):

```ts
// ---- Special squares (F-24) ----
//
// The homework and vocab squares are ordinary checklist_items rows with kind 'homework' /
// 'vocab', seeded here so taps, bags, misses and month tallies reuse the existing machinery
// unchanged. Their lifecycle belongs to this seeder alone — the item CRUD above refuses them.

/** The class's assignments whose deadline falls in this occurrence's (prev, date] window. */
async function windowedAssignments(
  db: TenantDb,
  classId: string,
  recurrence: string,
  date: string,
): Promise<
  {
    id: string;
    topicId: string;
    topicName: string;
    requiredCount: number;
    minScorePct: number;
    deadline: string;
    deadlineTime: string | null;
    modes: string | null;
    createdAt: string;
  }[]
> {
  const prev = prevOccurrenceDate(recurrence, date);
  const rows = await db.raw
    .select({
      id: vocabAssignments.id,
      topicId: vocabAssignments.topicId,
      topicName: flashcardTopics.name,
      requiredCount: vocabAssignments.requiredCount,
      minScorePct: vocabAssignments.minScorePct,
      deadline: vocabAssignments.deadline,
      deadlineTime: vocabAssignments.deadlineTime,
      modes: vocabAssignments.modes,
      createdAt: vocabAssignments.createdAt,
    })
    .from(vocabAssignments)
    .innerJoin(flashcardTopics, eq(flashcardTopics.id, vocabAssignments.topicId))
    .where(db.own(vocabAssignments, eq(vocabAssignments.classId, classId)))
    .orderBy(asc(vocabAssignments.deadline));
  // Window applied in JS: `prev` may be null (one-off event), and a class has a handful of
  // assignments — not worth a two-branch SQL condition.
  return rows.filter((a) => deadlineInVocabWindow(a.deadline, prev, date));
}

/**
 * Get-or-create / relabel / delete ONE special square so it mirrors `label` (null = no square).
 * Id-stable: an existing row only ever has its label rewritten, so kids' taps survive edits.
 * The partial unique index uq_checklist_items_special turns a two-tab seeding race into
 * ON CONFLICT DO NOTHING plus a re-read.
 */
async function syncSpecialItem(
  db: TenantDb,
  eventId: string,
  date: string,
  kind: ChecklistKind,
  label: string | null,
  sortOrder: number,
  nowUtcIso: string,
): Promise<void> {
  // tenant-unscoped: checklist_items has no tenant_id; the caller fenced eventId.
  const findWhere = and(
    eq(checklistItems.eventId, eventId),
    eq(checklistItems.date, date),
    eq(checklistItems.phase, 'checkin'),
    eq(checklistItems.kind, kind),
  );
  const existing = await db.raw.select().from(checklistItems).where(findWhere);
  const row = existing[0];

  if (label == null) {
    if (row) {
      // Checks cascade with the row and tallies self-correct — deleteItem's documented contract.
      await db.raw.delete(checklistItems).where(eq(checklistItems.id, row.id));
      record({ action: 'delete', entityType: 'checklist_item', entityId: row.id, meta: { kind } });
    }
    return;
  }

  if (!row) {
    await db.raw
      .insert(checklistItems)
      .values({
        id: crypto.randomUUID(),
        eventId,
        date,
        phase: 'checkin',
        kind,
        activityTypeId: null,
        label,
        sortOrder,
        createdBy: null,
        createdAt: nowUtcIso,
      })
      .onConflictDoNothing();
    const re = await db.raw.select().from(checklistItems).where(findWhere);
    if (re[0]) {
      record({
        action: 'create',
        entityType: 'checklist_item',
        entityId: re[0].id,
        meta: { kind },
      });
    }
    return;
  }

  if (row.label !== label) {
    await db.raw.update(checklistItems).set({ label }).where(eq(checklistItems.id, row.id));
  }
}

/**
 * Make the occurrence's special squares mirror their backing data. Runs on every /checkin
 * loader hit, so it is idempotent and bounded (≤4 small queries per kind).
 *
 * The today-guard is LOAD-BEARING: without it, a teacher browsing a past occurrence would mint
 * a vocab square into a closed month and create retroactive misses in rankings.
 */
export async function ensureSpecialItems(
  db: TenantDb,
  eventId: string,
  date: string,
  nowUtcIso: string,
): Promise<void> {
  if (date < ictDateOf(nowUtcIso)) return;
  const ev = await ownedEvent(db, eventId);
  if (!ev) return;

  // Homework: this occurrence's OWN preview row carries the text (authored last session).
  const prevRows = await db.raw
    .select({ homeworkText: sessionPreviews.homeworkText })
    .from(sessionPreviews)
    .where(
      db.own(sessionPreviews, eq(sessionPreviews.eventId, eventId), eq(sessionPreviews.date, date)),
    );
  const hw = (prevRows[0]?.homeworkText ?? '').trim();
  await syncSpecialItem(db, eventId, date, 'homework', hw ? hw.slice(0, 300) : null, -2, nowUtcIso);

  // Vocab: any assignment for the class due since the previous session.
  let vocabLabel: string | null = null;
  if (ev.classId) {
    const windowed = await windowedAssignments(db, ev.classId, ev.recurrence, date);
    if (windowed.length) {
      vocabLabel = windowed
        .map((a) => a.topicName)
        .join(', ')
        .slice(0, 300);
    }
  }
  await syncSpecialItem(db, eventId, date, 'vocab', vocabLabel, -1, nowUtcIso);
}

/**
 * Auto-derivation for the vocab square: pre-check students who met every applicable windowed
 * assignment. A seed row is written ONLY alongside an auto-inserted check — its presence means
 * the current state is manual truth (a teacher's uncheck must never be resurrected). Unmet
 * students get no seed row, so meeting the bar later still auto-checks them; derivation never
 * deletes a check, so a teacher's manual check on an unmet student is never disturbed either.
 */
export async function seedVocabChecks(
  db: TenantDb,
  eventId: string,
  date: string,
  rosterIds: string[],
  nowUtcIso: string,
): Promise<void> {
  if (date < ictDateOf(nowUtcIso) || !rosterIds.length) return;
  const ev = await ownedEvent(db, eventId);
  if (!ev?.classId) return;

  // tenant-unscoped: checklist_items has no tenant_id; eventId fenced by ownedEvent above.
  const items = await db.raw
    .select()
    .from(checklistItems)
    .where(
      and(
        eq(checklistItems.eventId, eventId),
        eq(checklistItems.date, date),
        eq(checklistItems.phase, 'checkin'),
        eq(checklistItems.kind, 'vocab'),
      ),
    );
  const item = items[0];
  if (!item) return;

  const windowed = await windowedAssignments(db, ev.classId, ev.recurrence, date);
  if (!windowed.length) return;

  // tenant-unscoped: vocab_assignment_students has no tenant_id; ids from the fenced read above.
  const narrowRows = await db.raw
    .select()
    .from(vocabAssignmentStudents)
    .where(
      inArray(
        vocabAssignmentStudents.assignmentId,
        windowed.map((a) => a.id),
      ),
    );
  const narrow = new Map<string, Set<string>>();
  for (const r of narrowRows) {
    let s = narrow.get(r.assignmentId);
    if (!s) narrow.set(r.assignmentId, (s = new Set()));
    s.add(r.studentId);
  }

  // tenant-unscoped: checklist_check_seeds has no tenant_id; item fenced above.
  const seeded = await db.raw
    .select()
    .from(checklistCheckSeeds)
    .where(eq(checklistCheckSeeds.itemId, item.id));
  const done = new Set(seeded.map((r) => r.studentId));
  const fresh = rosterIds.filter((sid) => !done.has(sid));
  if (!fresh.length) return;

  const counts = new Map<string, Map<string, number>>();
  for (const a of windowed) {
    counts.set(a.id, await qualifyingCounts(db, a, fresh));
  }

  for (const sid of fresh) {
    const applicable = windowed.filter((a) => {
      const set = narrow.get(a.id);
      return !set || set.has(sid);
    });
    const met = vocabSquareMet(
      applicable.map((a) => ({
        done: counts.get(a.id)?.get(sid) ?? 0,
        requiredCount: a.requiredCount,
      })),
    );
    if (!met) continue;
    // tenant-unscoped (both): fenced by the item read above. Seed first, check second — a crash
    // between the two re-runs harmlessly (both inserts are ON CONFLICT DO NOTHING).
    await db.raw
      .insert(checklistCheckSeeds)
      .values({ itemId: item.id, studentId: sid, seededAt: nowUtcIso })
      .onConflictDoNothing();
    await db.raw
      .insert(checklistChecks)
      .values({ itemId: item.id, studentId: sid, checkedAt: nowUtcIso })
      .onConflictDoNothing();
  }
}
```

- [ ] **Step 5: Loader wiring** — in `app/routes/checkin.tsx`, add imports
  `import * as gardenSvc from '../../server/services/garden';` and
  `import { ictDateOf } from '../../shared/logic/tests';`. Restructure the loader body after the
  param check (sequential where order matters, parallel where it doesn't):

```ts
  const now = new Date().toISOString();
  // Seed/refresh the special squares BEFORE reading the occurrence, so the payload includes them.
  await checkinSvc.ensureSpecialItems(db, eventId, date, now);
  const roster = await rosterOf(db, eventId);
  const kiosk = url.searchParams.get('kiosk') === '1';
  if (kiosk) {
    // Kiosk loads only: the derivation is per-student work the authoring tab has no use for.
    await checkinSvc.seedVocabChecks(db, eventId, date, roster.studentIds, now);
  }
  const occ = await checkinSvc.getOccurrence(db, eventId, date);
  const flags = await checkinSvc.occurrenceFlags(db, eventId, date, roster.studentIds);
  // The authoring tab's "Giao từ vựng" section lists what is currently open for this class.
  const openAssignments = roster.classId
    ? await gardenSvc.listAssignments(db, { classId: roster.classId, activeFrom: ictDateOf(now) })
    : [];
  if (!kiosk || !roster.classId) return { ...occ, flags, openAssignments };
  const tallies = await checkinSvc.classMonthTallies(db, roster.classId, monthOfVn(date));
  return {
    ...occ,
    flags,
    openAssignments,
    bagsByStudent: Object.fromEntries(
      roster.studentIds.map((sid) => [sid, tallies.get(sid)?.bags ?? 0]),
    ),
  };
```

- [ ] **Step 6: Verify** — `npm run typecheck` and `npm run lint` pass.

---

### Task 6: Web UI — editor chips, "Giao từ vựng" section, kiosk special cells + shortcut

**Files:**
- Modify: `src/calendar/event-modal.tsx` (`CheckinPayload` ~428, `ChecklistItemsEditor` ~439,
  `CheckinTab` ~596)
- Modify: `src/kiosk/kiosk.tsx`
- Modify: `src/styles/app.css` (near the `.kiosk-cell` block ~3357 and the `.ck-item-row` styles)

**Interfaces:**
- Consumes: `ChecklistItemRow.kind`, `openAssignments` payload (Task 5),
  `VocabAssignmentRow.studentIds` (Task 4), extended `AssignModal` props (Task 4), i18n keys
  (Task 7 — write the `t('...')` calls now, add the keys in Task 7).

- [ ] **Step 1: Payload type** — `CheckinPayload` in `event-modal.tsx` gains
  `openAssignments?: VocabAssignmentRow[];` with
  `import type { VocabAssignmentRow } from '../../server/services/garden.js';`.

- [ ] **Step 2: Editor edits only custom rows; specials render as chips.** In
  `ChecklistItemsEditor`, change the `rows` line to
  `const rows = items.filter((i) => i.phase === phase && i.kind === 'custom').sort((a, b) => a.sortOrder - b.sortOrder);`
  and above the rows render read-only chips (check-in phase only — specials never exist for
  checkout):

```tsx
      {phase === 'checkin' &&
        items
          .filter((i) => i.phase === 'checkin' && i.kind !== 'custom')
          .map((i) => (
            <div key={i.id} className="ck-special-chip" data-kind={i.kind}>
              <MIcon name={i.kind === 'homework' ? 'book' : 'star'} size={16} />
              <b>{t(i.kind === 'homework' ? 'ck_sq_homework' : 'ck_sq_vocab')}</b>
              <span>{i.label}</span>
              <span className="ck-special-chip__auto">{t('ck_special_hint')}</span>
            </div>
          ))}
```

- [ ] **Step 3: "Giao từ vựng" section in `CheckinTab`.** State + data: the topics come from the
  SAME cached payload the Preview tab uses (shared key, no new endpoint):

```ts
  const [assignOpen, setAssignOpen] = React.useState(false);
  const { data: prevData } = useCachedLoad<{ topics: { id: string; name: string }[] }>(
    `prev:${eventId}:${date}`,
    `/event-previews?eventId=${encodeURIComponent(eventId)}&date=${encodeURIComponent(date)}`,
  );
  const assignFetcher = useFetcher<{ ok: boolean }>();
  React.useEffect(() => {
    if (assignFetcher.state === 'idle' && assignFetcher.data?.ok) {
      setAssignOpen(false);
      onMutated(); // refresh openAssignments in the ck: payload
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignFetcher.data, assignFetcher.state]);
```

  Render, between the checkout section and the flags section:

```tsx
      <div className="ck-section ck-section--assign">
        <div className="m-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h4 style={{ margin: 0 }}>{t('ck_assign_vocab')}</h4>
          <CBtn variant="secondary" size="sm" onClick={() => setAssignOpen(true)}>
            {t('ck_assign_vocab')}
          </CBtn>
        </div>
        <div className="m-stack" style={{ gap: 6 }}>
          {(data?.openAssignments ?? []).length === 0 ? (
            <p className="m-muted" style={{ fontSize: 'var(--text-sm)', margin: 0 }}>
              {t('ck_assign_none')}
            </p>
          ) : (
            (data?.openAssignments ?? []).map((a) => (
              <div key={a.id} className="lrow">
                <span style={{ flex: 1 }} className="lrow__title">
                  {a.topicName}
                </span>
                <span className="m-muted">{a.deadline}</span>
                <span className="mchip">
                  {a.studentIds.length === 0
                    ? t('garden_scope_all')
                    : `${a.studentIds.length} HS`}
                </span>
              </div>
            ))
          )}
        </div>
        {assignOpen && (
          <AssignModal
            topics={prevData?.topics ?? []}
            classes={classes.filter((c) => c.id === classId)}
            today={date}
            onClose={() => setAssignOpen(false)}
            onSubmit={(fd) => assignFetcher.submit(fd, { action: '/flashcards', method: 'post' })}
            rosterStudents={roster.map((s) => ({ id: s.id, name: s.name }))}
          />
        )}
      </div>
```

  Imports in `event-modal.tsx`: `import { AssignModal } from '../garden/assign-modal.jsx';`.
  NOTE: `VocabAssignmentRow` includes `topicName` — verify the exact property name in
  `listAssignments`' select in `server/services/garden.ts` and use what it exposes.

- [ ] **Step 4: Kiosk special cells.** In the personal-board cell map in `src/kiosk/kiosk.tsx`,
  branch on `item.kind`:

```tsx
                {items.map((item) => {
                  const special = item.kind !== 'custom';
                  const type = special
                    ? null
                    : data?.activityTypes.find((a) => a.id === item.activityTypeId);
                  const c = colorOf(special ? (item.kind === 'homework' ? 'blue' : 'green') : (type?.color ?? 'orange'));
                  const checked = localChecks.has(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`kiosk-cell${special ? ' kiosk-cell--special' : ''}`}
                      style={{
                        background: checked ? c.base : c.soft,
                        color: checked ? '#fff' : c.ink,
                        borderColor: special ? c.base : 'transparent',
                      }}
                      onClick={() => toggle(item.id)}
                    >
                      <MIcon
                        name={special ? (item.kind === 'homework' ? 'book' : 'star') : ((type?.icon as IconName) ?? 'star')}
                        size={40}
                      />
                      {/* Both halves, not one or the other: the type says what kind of homework
                          this was, the label says which — "Vocabulary" over "10 words: Animals". */}
                      {special ? (
                        <span className="kiosk-cell-type">
                          {t(item.kind === 'homework' ? 'ck_sq_homework' : 'ck_sq_vocab')}
                        </span>
                      ) : (
                        type && <span className="kiosk-cell-type">{type.name}</span>
                      )}
                      {item.label && <span className="kiosk-cell-label">{item.label}</span>}
                      {checked && (
                        <span className="kiosk-cell-check" aria-hidden="true">
                          <MIcon name="check" size={22} />
                        </span>
                      )}
                    </button>
                  );
                })}
```

  NOTE: verify `'blue'` and `'green'` are valid names in `PALETTE`/`colorOf`
  (`src/lib/core.js`); if not, pick the nearest existing names (e.g. `'sky'`, `'leaf'`) and keep
  the two kinds visually distinct from each other and from the default `'orange'`.

- [ ] **Step 5: Kiosk checkout "Giao từ vựng" shortcut.** A lazily-mounted launcher so the
  topics request only fires when a teacher actually opens the dialog. Add to `kiosk.tsx`:

```tsx
/**
 * "Giao từ vựng" from the kiosk's checkout screen — same dialog as the event modal's section.
 * Its own component so the /event-previews load (for the topic picker) mounts only on demand;
 * kids tapping through checkout never pay for it.
 */
function KioskAssign({
  eventId,
  date,
  classId,
  classes,
  roster,
  onClose,
}: {
  eventId: string;
  date: string;
  classId: string;
  classes: ClassRow[];
  roster: StudentRow[];
  onClose: () => void;
}) {
  const { data } = useCachedLoad<{ topics: { id: string; name: string }[] }>(
    `prev:${eventId}:${date}`,
    `/event-previews?eventId=${encodeURIComponent(eventId)}&date=${encodeURIComponent(date)}`,
  );
  const fetcher = useFetcher<{ ok: boolean }>();
  React.useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.ok) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);
  return (
    <AssignModal
      topics={data?.topics ?? []}
      classes={classes.filter((c) => c.id === classId)}
      today={date}
      onClose={onClose}
      onSubmit={(fd) => fetcher.submit(fd, { action: '/flashcards', method: 'post' })}
      rosterStudents={roster.map((s) => ({ id: s.id, name: s.name }))}
    />
  );
}
```

  In `KioskModal`: `const [assigning, setAssigning] = React.useState(false);`, a button in the
  chrome only during checkout —

```tsx
      {phase === 'checkout' && (
        <Button variant="secondary" onClick={() => setAssigning(true)}>
          {t('ck_assign_vocab')}
        </Button>
      )}
```

  (place it inside `.kiosk-chrome` before the close IconButton), and next to the existing
  `{celebrate && ...}` block:

```tsx
        {assigning && (
          <KioskAssign
            eventId={eventId}
            date={date}
            classId={classId}
            classes={classes}
            roster={roster}
            onClose={() => setAssigning(false)}
          />
        )}
```

  Imports: `AssignModal` is used only inside `KioskAssign`; add
  `import { AssignModal } from '../garden/assign-modal.jsx';` and `useCachedLoad` is already
  imported.
  NOTE: `AssignModal`'s `Modal` portals to `document.body` (same layer family as the kiosk
  overlay). Verify it stacks above `.kiosk-overlay` — if it renders underneath, raise the
  modal's z-index in `src/styles/app.css` rather than moving the mount.

- [ ] **Step 6: CSS** — in `src/styles/app.css`, next to the existing `.kiosk-cell` rules:

```css
/* F-24 special squares: framed so a teacher can tell "system square" from "my checklist row". */
.kiosk-cell--special {
  border: 2px solid transparent; /* color set inline from the palette */
}
.ck-special-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--surface-2, #f6f1e7);
  font-size: var(--text-sm);
}
.ck-special-chip__auto {
  margin-left: auto;
  color: var(--ink-muted, #8a8171);
  font-size: var(--text-xs, 11px);
}
```

  NOTE: check which surface/ink custom properties actually exist in `app.css` (grep
  `--surface` / `--ink`) and use those — an undefined custom property silently renders as
  nothing (see the repo's `verify-css-without-deploying` lesson).

- [ ] **Step 7: Verify** — `npm run typecheck`, `npm run lint`.

---

### Task 7: i18n strings

**Files:**
- Modify: `shared/i18n/strings.ts` — EN block near `ck_bag_earned` (~line 1805) and
  `prev_*` keys (~line 570); VI block at the mirrored positions (`ck_tab` VI is at ~line 3663).

- [ ] **Step 1: EN keys** (inside the ck_/prev_ groups, keeping neighbors together):

```ts
  prev_homework_label: 'Homework (checked at next check-in)',
  prev_homework_ph: 'e.g. Workbook p.32-33',
  ck_sq_homework: 'Homework',
  ck_sq_vocab: 'Vocabulary',
  ck_special_hint: 'Automatic',
  ck_assign_vocab: 'Assign vocabulary',
  ck_assign_none: 'No open vocabulary assignments',
  garden_assign_topic: 'Topic',
  garden_scope_label: 'Students',
  garden_scope_all: 'Whole class',
  garden_scope_selected: 'Selected students',
```

- [ ] **Step 2: VI keys** (same keys in the VI object):

```ts
    prev_homework_label: 'Bài tập về nhà (kiểm tra ở check-in buổi sau)',
    prev_homework_ph: 'VD: Workbook trang 32-33',
    ck_sq_homework: 'Bài tập',
    ck_sq_vocab: 'Từ vựng',
    ck_special_hint: 'Tự động',
    ck_assign_vocab: 'Giao từ vựng',
    ck_assign_none: 'Chưa có bài tập từ vựng nào đang mở',
    garden_assign_topic: 'Chủ đề',
    garden_scope_label: 'Học sinh',
    garden_scope_all: 'Cả lớp',
    garden_scope_selected: 'Chọn học sinh',
```

- [ ] **Step 3: Verify** — `npm run check:i18n` passes (it enforces EN/VI parity), plus
  `npm run typecheck`.

---

### Task 8: E2E specs (written, NOT run)

**Files:**
- Create: `e2e/crud-checkin-special.spec.ts`
- Create: `e2e/crud-vocab-scope.spec.ts`

Conventions (from `e2e/crud-helpers.ts` and the sibling specs): `crudGuard()` at the top of the
describe; `signInStaff(page)`; locate inputs structurally via `.mochi-field` labels (no `name=`);
combobox options from `page` (portalled); ALWAYS `await k.posted('/path')` around the click that
posts before asserting re-rendered state; unique `E2E … ${Date.now()}` names; clean up
everything created. UI language in the test env is EN — use the EN strings from Task 7.

- [ ] **Step 1: `e2e/crud-checkin-special.spec.ts`** — homework square lifecycle + vocab square
  presence. Model the setup/cleanup EXACTLY on `e2e/crud-kiosk.spec.ts` (today event on
  `Biology 9A`, seeded student `Leo Park`, delete the event at the end):

```ts
import { test, expect } from '@playwright/test';
import { crudGuard, eventTitleInput, signInStaff, ui } from './crud-helpers';

/**
 * F-24 special squares. The homework square mirrors session_previews.homework_text: writing
 * the text makes the square appear on the kiosk board, a tap checks it, clearing the text
 * removes square and taps together. The vocab square appears when an assignment's deadline
 * falls in the occurrence's window (deadline == today for a non-recurring event).
 */

test.describe('CRUD: check-in special squares', () => {
  crudGuard();

  test('homework text -> kiosk square -> tap -> clear text -> square gone', async ({ page }) => {
    const k = ui(page);
    const title = `E2E hw square ${Date.now()}`;

    await signInStaff(page);
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'New event' }).click();
    await eventTitleInput(k.dlg).fill(title);
    await k.pickSel('Class', 'Biology 9A');
    let post = k.posted('/calendar');
    await k.submit().click();
    await post;

    await page.getByRole('tab', { name: 'Agenda' }).click();
    await page.locator('.aev', { hasText: title }).click();

    // Author the homework text on the occurrence's own preview row.
    await k.dlg.getByRole('tab', { name: 'Next session' }).click();
    await k.dlg.getByPlaceholder('e.g. Workbook p.32-33').fill('Workbook p.32');
    post = k.posted('/event-previews');
    await k.dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await post;

    // The authoring tab shows the seeded square as a read-only chip.
    await k.dlg.getByRole('tab', { name: 'Check-in/out' }).click();
    const chip = k.dlg.locator('.ck-special-chip[data-kind="homework"]');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Workbook p.32');

    // On the kiosk it is a tappable framed cell.
    const kiosk = page.locator('.kiosk-overlay');
    await k.dlg.locator('.ck-section--this').getByRole('button', { name: 'Open check-in kiosk' }).click();
    await kiosk.locator('.kiosk-card', { hasText: 'Leo Park' }).click();
    const cell = kiosk.locator('.kiosk-cell--special');
    await expect(cell).toHaveCount(1);
    await expect(cell.locator('.kiosk-cell-type')).toHaveText('Homework');
    await expect(cell.locator('.kiosk-cell-label')).toHaveText('Workbook p.32');

    let tap = k.posted('/checkin');
    await cell.click();
    await tap;
    await expect(cell.locator('.kiosk-cell-check')).toBeVisible();
    await kiosk.getByRole('button', { name: 'Close kiosk' }).click();

    // Clearing the text deletes the square (and its taps) on the next load.
    await k.dlg.getByRole('tab', { name: 'Next session' }).click();
    await k.dlg.getByPlaceholder('e.g. Workbook p.32-33').fill('');
    post = k.posted('/event-previews');
    await k.dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await post;

    await k.dlg.getByRole('tab', { name: 'Check-in/out' }).click();
    await k.dlg.locator('.ck-section--this').getByRole('button', { name: 'Open check-in kiosk' }).click();
    // Board empties: with no custom items and the square gone, the kiosk shows its empty state.
    await expect(kiosk.locator('.kiosk-empty')).toBeVisible();
    await kiosk.getByRole('button', { name: 'Close kiosk' }).click();

    // Cleanup: delete the event.
    await k.dlg.getByRole('tab', { name: 'Details' }).click();
    post = k.posted('/calendar');
    await k.dlg.locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await post;
  });
});
```

  NOTE: if the empty-state assertion is flaky because the kiosk payload is cached, mirror how
  other specs force a fresh load (close/reopen the dialog before reopening the kiosk).

- [ ] **Step 2: `e2e/crud-vocab-scope.spec.ts`** — scoped assign through the event dialog's new
  section, verifying the vocab square appears; then scope round-trip and cleanup. The spec
  needs a flashcard topic to assign: create and later delete it EXACTLY the way
  `e2e/crud-garden.spec.ts` (or `crud-vocab.spec.ts`) creates its throwaway topic — read that
  spec first and reuse its steps verbatim rather than inventing new selectors. Skeleton with
  the load-bearing assertions:

```ts
import { test, expect } from '@playwright/test';
import { crudGuard, eventTitleInput, signInStaff, ui } from './crud-helpers';

/**
 * F-24: "Giao từ vựng" from the event dialog's Check-in tab, narrowed to selected students
 * (vocab_assignment_students), and the vocab square the assignment produces on the kiosk.
 */

test.describe('CRUD: vocab assign scope', () => {
  crudGuard();

  test('assign to selected students from the Check-in tab; vocab square appears', async ({
    page,
  }) => {
    const k = ui(page);
    const topicName = `E2E scope topic ${Date.now()}`;
    const title = `E2E scope session ${Date.now()}`;

    await signInStaff(page);

    // 1. Throwaway topic — mirror the topic setup from e2e/crud-garden.spec.ts verbatim.
    //    (Create topic `topicName` with at least one word via /flashcards.)

    // 2. Today event on Biology 9A (same as crud-kiosk.spec.ts).
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'New event' }).click();
    await eventTitleInput(k.dlg).fill(title);
    await k.pickSel('Class', 'Biology 9A');
    let post = k.posted('/calendar');
    await k.submit().click();
    await post;
    await page.getByRole('tab', { name: 'Agenda' }).click();
    await page.locator('.aev', { hasText: title }).click();

    // 3. Assign from the Check-in tab, deadline = today (default is +7 days -> set it to today),
    //    scope = selected students (Leo Park only).
    await k.dlg.getByRole('tab', { name: 'Check-in/out' }).click();
    await k.dlg.locator('.ck-section--assign').getByRole('button', { name: 'Assign vocabulary' }).click();
    const assignDlg = k.dlgOf('Assign vocabulary'); // adjust to the modal's actual title key (garden_assign_title)
    await k.pickSel('Topic', topicName);
    // Deadline: pick today in the date picker — reuse the pickDay helper pattern from
    // crud-checkin-author.spec.ts if the default isn't today.
    await assignDlg.getByText('Selected students').click();
    await assignDlg.getByText('Leo Park').click();
    post = k.posted('/flashcards');
    await assignDlg.getByRole('button', { name: 'Save', exact: true }).click();
    await post;

    // 4. The section lists the assignment with a 1-student scope chip.
    const row = k.dlg.locator('.ck-section--assign .lrow', { hasText: topicName });
    await expect(row).toBeVisible();
    await expect(row.locator('.mchip')).toHaveText('1 HS');

    // 5. The kiosk board now shows the vocab square (unchecked — nobody played rounds).
    const kiosk = page.locator('.kiosk-overlay');
    await k.dlg.locator('.ck-section--this').getByRole('button', { name: 'Open check-in kiosk' }).click();
    await kiosk.locator('.kiosk-card', { hasText: 'Leo Park' }).click();
    const cell = kiosk.locator('.kiosk-cell--special');
    await expect(cell.locator('.kiosk-cell-type')).toHaveText('Vocabulary');
    await expect(cell.locator('.kiosk-cell-check')).toHaveCount(0);
    await kiosk.getByRole('button', { name: 'Close kiosk' }).click();

    // 6. Cleanup: delete the event, the assignment (via /flashcards, mirroring crud-garden's
    //    cleanup), and the throwaway topic.
    await k.dlg.getByRole('tab', { name: 'Details' }).click();
    post = k.posted('/calendar');
    await k.dlg.locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await post;
    // ... assignment + topic cleanup mirrored from crud-garden.spec.ts ...
  });
});
```

  The two `// mirror ... verbatim` markers are the ONLY places you fill from another spec —
  everything else above is exact. Read `e2e/crud-garden.spec.ts` before writing this file and
  replace those markers with its real steps (topic create, assignment delete, topic delete).

- [ ] **Step 3: Verify** — `npm run lint` and `npm run typecheck` pass (Playwright specs are
  type-checked). Do NOT run the suite.

---

### Task 9: Full static verification

- [ ] **Step 1:** `npm run typecheck` — clean.
- [ ] **Step 2:** `npm run lint` — clean.
- [ ] **Step 3:** `npm run check:i18n` — clean.
- [ ] **Step 4:** `cd mobile && npm test` — green (~1s; needs Node 24).
- [ ] **Step 5:** `npx prettier --write` on ONLY the files you created/modified (never repo-wide;
  the CRLF tree makes `--check` flag everything).
- [ ] **Step 6:** Re-read the diff (`git diff --stat` then spot-check) against the spec's
  decision table. Confirm: sweep narrowing present; today-guard present; seed-only-when-met
  present; mobile `homeworkText` round-trip present; both new tables in `scripts/test-accounts.sql`.

---

### Task 10: Single commit, push, and post-push operations

- [ ] **Step 1: Changelog** — `node scripts/changelog.mjs "feat(checkin): homework + vocab special squares on the kiosk board (F-24); per-student vocab assignment scope"`
  (it stages `CHANGELOG.md` itself).

- [ ] **Step 2: ONE commit** — stage everything this plan touched (including
  `docs/superpowers/**` if not already committed) and commit:

```bash
git add migrations/0053_checkin_special_squares.sql server/db/schema.ts scripts/test-accounts.sql \
  shared/logic/checkin.ts test/checkin-logic.test.ts shared/schemas.ts shared/api-contract.ts \
  server/services/session-preview.ts server/services/garden.ts server/services/checkin.ts \
  app/routes/event-previews.tsx app/routes/checkin.tsx \
  src/calendar/event-modal.tsx src/garden/assign-modal.tsx src/kiosk/kiosk.tsx src/styles/app.css \
  shared/i18n/strings.ts mobile/lib/types.ts mobile/lib/staff-data.ts mobile/components/PreviewEditor.tsx \
  e2e/crud-checkin-special.spec.ts e2e/crud-vocab-scope.spec.ts
git commit -m "feat(checkin): homework + vocab special squares on the kiosk board (F-24)

Special squares are seeded checklist_items rows (kind homework|vocab) driven by
session_previews.homework_text and vocab assignments due since the previous
occurrence; both count toward tui mu like any cell. Vocab auto-checks students
who met every applicable assignment (checklist_check_seeds makes overrides
sticky). New vocab_assignment_students narrows assignments to picked students
(zero rows = whole class) across chips, progress, report card and the garden
sweep. Assign UI at checkout in the event dialog and on the kiosk.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Push** — `git push origin main`. If the push 403s with a `tech-entag`
  credential, clear it: `printf 'protocol=https\nhost=github.com\n' | git credential reject`
  and retry (the correct account is vunq-jeremy).

- [ ] **Step 4: Apply the D1 migration to prod IMMEDIATELY after the push** — Workers Builds
  deploys the new code on push and the code reads the new columns, so the migration must land
  before/as the deploy goes live:

```bash
npx wrangler d1 migrations apply mochi-class --remote
npx wrangler d1 migrations list mochi-class --remote   # 0053 must NOT be listed as pending
```

  This needs the ngqv0712 Cloudflare account: `CLOUDFLARE_API_TOKEN` must be set in the
  environment (NEVER `wrangler login` — it evicts the global entag credential). If the token
  isn't configured in this session, STOP and tell the user to run the two commands themselves —
  do not improvise credentials.

- [ ] **Step 5: Verify the OTA published** — `cd mobile && npx eas-cli workflow:runs`; the top
  entry should be your commit with `Status SUCCESS` (allow a minute or two). The workflow has
  been failing on free-tier CI quota; if it FAILED or is missing, publish manually:

```bash
cd mobile && npx eas-cli update --branch preview --platform android --environment preview --message "F-24 checkin special squares"
```

  (NEVER drop `--environment preview` — without it the bundle boots with no API URL and rolls
  back silently.) Optionally verify delivery:
  `curl -s -H "expo-platform: android" -H "expo-runtime-version: $(node -p "require('./shared/version.json').runtimeVersion")" -H "expo-channel-name: preview" -H "expo-protocol-version: 1" -H "accept: multipart/mixed" https://u.expo.dev/83251f6c-1fa9-4724-ba61-39a9eb806aab | grep -o '"gitSha":"[a-f0-9]*"'`
  — the sha must equal the pushed commit.

- [ ] **Step 6: Report** — tell the user: what shipped; that the e2e/unit suites are written but
  NOT run and which ones this plausibly affects (`crud-checkin-author`, `crud-kiosk`,
  `crud-tui-mu`, `crud-garden*`, the two new specs, `test/checkin-logic.test.ts`, the worker
  suite); the migration + OTA status from Steps 4–5; and that `mobile/lib` changes were
  type-level only (no new mobile logic test — flag it, per the mobile-test rule, for the user
  to judge).
