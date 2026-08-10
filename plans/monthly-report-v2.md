# Monthly parent report v2 — attendance, subjects, vocab homework, richer garden, roster + sent tracking

> **Delivery note:** on approval this file is committed verbatim to the repo as
> `plans/monthly-report-v2.md` (with a changelog entry) and pushed to `main`, so it can be
> executed from another machine. Execution machine: open the repo, read this file top to
> bottom, execute steps in order.

## Context

Feedback being addressed: *"Tạo form báo cáo tình hình học tập của học sinh cho phụ huynh sau 1
tháng — nội dung: tất tần tật từ ý thức, việc tự học (trồng cây), điểm trên lớp, ..."*

The report already exists — `monthly_remarks` (migration 0023), config-managed criteria
(0025), a teacher form on the assessments screen's "Monthly report" tab, and a printable
640px slip (`src/assessments/report-slip.tsx`) that is rasterized by `html-to-image` and
copied/sent to the family over Zalo. This work **extends** it; nothing is created from
scratch.

Gaps found in review, confirmed with the user, in scope:

1. **Attendance is printed from the wrong source.** The slip's vắng/muộn tiles come from
   `behavior_records` (a hand-entered incident log); the real roll is `attendance_records`
   (`present/late/absent/excused`). The tuition slip already prints the real breakdown, so a
   parent can receive two documents for the same month that disagree.
2. **No per-subject picture.** One merged average across all the student's classes; since
   0030 classes carry `subject_id`, and `score_records.classId` makes the split available.
3. **No author, no timestamps** on `monthly_remarks` — the slip has a signature line nobody
   signs.
4. **Vocab homework (`vocab_assignments`) never reaches parents** — the most actionable
   "tự học" data point, currently teacher-only.
5. **Garden detail on the slip is trimmed to 2 numbers** (active days, fruits). User wants
   plays + stages grown too (setbacks stay off the slip — deliberate; a keepsake, not a
   scolding).
6. **No coverage view** — the report tab shows one student at a time via a dropdown; there
   is no "12/30 written this month" roster, which is what makes the monthly ritual finish.
7. **No delivery record** — the Zalo send is fire-and-forget; nobody can answer "which
   families haven't received theirs".

User decisions (fixed):

- Sending stays **per-student** — no bulk blast. The roster is the cockpit: per-row
  written/sent status; each report goes out individually with its own teacher comment.
- **One taller slip** (still 640px wide) — no compact/detailed split.
- Numbers stay **live** — no freezing/snapshot; the sent PNG is the frozen artifact.

## Architecture constraints (verified against the code)

- Slip is rasterized client-side by `html-to-image`: system fonts only, no remote images,
  inline SVG only, fixed 640px width. There is NO server-side renderer — a bulk image send
  is impossible without one, which is part of why sends stay individual.
- `/api/*` is bearer-only; browser-cookie routes live at bare paths (`/zalo-send-card`,
  `/garden-month`). The slip route is registered OUTSIDE the `_app` layout and is
  deliberately uncached.
- `monthly_remarks.ratings` is a JSON object keyed by `remark_criteria` id — the contract is
  shared by web, mobile (`mobile/app/(app)/assessments.tsx`), and rankings. Do NOT change
  its shape. `MonthlyRemarkInput` (shared/schemas.ts) is imported by mobile; staff id and
  timestamps are **server-set**, never added to that input schema.
- Migrations are hand-written (drizzle-kit abandoned); `server/db/schema.ts` is a
  hand-maintained mirror edited in the same commit. Wrangler applies `migrations/`
  alphabetically. **Numbering has collided before (two 0030_* files): run `ls migrations/`
  and take the next free number at implementation time — expected 0031.**
- e2e: write specs in the same commit, but NEVER run `npm run test:e2e:staging` /
  `npm run test:env:setup` unasked — the user runs those. Playwright runs `workers: 1`,
  `fullyParallel: false` — specs never race each other.
- Every push to `main` gets a changelog entry: `node scripts/changelog.mjs "..."`.

## Corrections to naive assumptions (verified against code — trust these)

1. **`requireStaff` returns a nested shape.** `SessionUser = { kind, account, user: { id,
   name, ... } }` (server/services/auth.ts:23-38). The staff id is **`session.user.id`**.
   Precedent: `app/routes/flashcards.tsx:173` uses `staff.user.id`.
2. **`/zalo-send-card` already creates a db** (line 55) — only `ctx` needs to be
   additionally destructured for `notifyLive`. `notifyLive(env, ctx, domain)` is exported
   from `server/live.ts:13`.
3. **There is a second remark write path**: `app/routes/api.assessments.remarks.tsx`
   (mobile). Its `crud()` ctx provides `user` (an `ApiCtx`), so the new `staffId` argument
   must be passed there too or typecheck fails.
4. **`updateRemark` is also called with a `Partial<MonthlyRemarkInput>` patch by the API
   route** — the new signature must keep patch semantics.
5. The 1360px CSS uses `display: contents` to promote the rail's two cards into grid
   columns. With a roster added and the rail growing to 4 cards, that approach cannot
   survive; this plan **replaces** the ≥1360 block (rail becomes a real scrolling column).
6. Seeded attendance rows exist ONLY for `2026-06-22` (`seed.sql` lines 124-127: event
   e1/class c1 — s1 present, s2 late, s3 absent). E2E slip assertions must target month
   `2026-06`.
7. `GardenMonthSummary.plant` is `PlantView | null`; the streak field is **`plant.streak`**
   (shared/logic/garden.ts:112-131), already 0 when the run has lapsed.
8. `peopleSvc.listStaff(db)` exists (people.ts:22). `assess_no_class` i18n key exists (EN
   155 / VI 1379). `--cream-200` token exists (src/ds/styles/tokens/colors.css:57).
   `src/lib/assess.ts` re-exports `ATTENDANCE_META`/`ATTENDANCE_STATUSES` (lines 9-10).
   `src/screens-assessments.tsx` already imports `StudentRow` (line 25) and `RemarkRow`.

## Product decisions baked into this plan

- **Drop the behavior `late`/`absent` incident tiles from the slip** (keep
  `missing_homework`, `disruptive`, `other`, praise). The real roll now prints per-class
  Present/Late/Absent/Excused counts; printing hand-logged "Vắng: 2" next to roll-call
  "Vắng: 1" on one parent document invites "which is right?". The teacher rail keeps ALL
  behavior types (unchanged there). Implemented server-side by filtering in the report
  loader — the slip's incident-rendering JSX is untouched.
- **Sent-badge freshness**: after stamping `sent_at`, `/zalo-send-card` calls
  `notifyLive(env, ctx, 'assessments')`. The slip is a separate tab outside `_app` with no
  route cache; the client cache is per-tab memory, so the WebSocket broadcast is the only
  real freshness channel. The open `/assessments` tab receives it,
  `invalidateAfterRemoteMutation('assessments')` (src/lib/live.ts:75) marks
  `route:assessments` stale, and the visible route revalidates — the badge flips to "Sent"
  in ~2s. Honest fallback when the hub is down: stale until next load. Do NOT touch
  `MUTATION_EFFECTS` or add a clientAction anywhere.
- **Rail additions**: one new fetcher component rendering two small cards (Attendance,
  Vocabulary homework) fed by a new cookie-authed resource route `/report-extras` (twin of
  `/garden-month`). Rows + chips, NOT `Stat` tiles — keeps the e2e garden-card tile count
  (`.statcard__num` = 6, scoped to its card) safe and fits the 380px rail.

---

# Implementation steps (execute in order)

## STEP 1 — Migration `migrations/0031_remark_meta.sql` (new file)

First run `ls migrations/` to confirm 0031 is still free. House style: prose header
explaining why. Exact content:

```sql
-- Monthly remark provenance + send tracking. Until now a monthly_remarks row said nothing about
-- who wrote it or when, and "did this family get their report?" lived in the teacher's memory —
-- the slip printed an anonymous signature line. Four nullable columns, no backfill: rows written
-- before this migration honestly have no author or timestamps, and the slip simply omits the
-- teacher's name for them rather than inventing one.
--   staff_id    author of the LAST save (create or update), printed by the slip next to the
--               signature; SET NULL on staff delete so a departed teacher never blocks cleanup.
--   created_at  first save only (the upsert never overwrites it); updated_at every save. ISO
--               strings stamped by server/services/assessments.ts, never by the client.
--   sent_at     stamped by /zalo-send-card when the slip image actually reached at least one
--               family chat for this remark; the report tab's roster shows it as a "Sent" badge.
ALTER TABLE monthly_remarks ADD COLUMN staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE monthly_remarks ADD COLUMN created_at TEXT;
ALTER TABLE monthly_remarks ADD COLUMN updated_at TEXT;
ALTER TABLE monthly_remarks ADD COLUMN sent_at TEXT;

CREATE INDEX idx_monthly_remarks_staff ON monthly_remarks(staff_id);
```

### 1b. Mirror in `server/db/schema.ts` (same commit)

In `monthlyRemarks` (currently lines 310-326), add after `comment: text('comment'),`:

```ts
    /** Author of the last save; see migrations/0031_remark_meta.sql. */
    staffId: text('staff_id').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
    /** When the slip image last reached a family chat via /zalo-send-card. */
    sentAt: text('sent_at'),
```

and in the table's index callback add:

```ts
    index('idx_monthly_remarks_staff').on(t.staffId),
```

`staff` is declared at the top of schema.ts (line 11), above `monthlyRemarks` — a direct
reference is fine.

**Do NOT touch `shared/schemas.ts`** — `MonthlyRemarkInput` stays as is (server-set fields
must not be client-postable). Mobile (`mobile/lib/types.ts` `MonthlyRemarkRow =
Row<z.infer<typeof MonthlyRemarkInput>>`) keeps compiling; new response fields are additive
and ignored.

## STEP 2 — Pure helper in `shared/logic/assess.ts`

Append after `scoreStats` (end of file, after line 185):

```ts
/** The minimum a score record must have for the per-class breakdown on the report slip. */
export interface ClassScoreLike extends ScoreLike {
  classId: string | null;
}

export type ClassScoreSummary = { classId: string | null; average: number; count: number };

/**
 * Per-class score averages for the monthly report. Records with no class group under
 * `classId: null` (rendered with the generic "no class" label). First-appearance order is kept:
 * the input is date-sorted, so classes come out in the order they were first tested that month.
 */
export function scoreStatsByClass(records: ClassScoreLike[]): ClassScoreSummary[] {
  const groups = new Map<string | null, number[]>();
  for (const r of records) {
    const list = groups.get(r.classId);
    if (list) list.push(r.score);
    else groups.set(r.classId, [r.score]);
  }
  const out: ClassScoreSummary[] = [];
  for (const [classId, scores] of groups) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    out.push({ classId, average: Math.round(avg * 10) / 10, count: scores.length });
  }
  return out;
}
```

No React, no server imports — mobile-safe like the rest of the file.

## STEP 3 — i18n keys in `shared/i18n/strings.ts`

One module: EN object first, then the `vi` block mirroring it (a `satisfies` clause enforces
key parity; `npm run check:i18n` verifies too). Insert at ALL FOUR anchor points; VI mirrors
EN ordering.

**EN — insert immediately after `remark_none: 'No remark for this month yet',` (line ~212):**

```ts
  remark_roster_title: 'Students',
  remark_coverage: '{n}/{total} reports written',
  remark_status_written: 'Written',
  remark_status_missing: 'Not written',
  remark_status_sent: 'Sent',
  remark_attendance_title: 'Attendance',
  remark_attendance_none: 'No roll-call records this month',
  remark_homework_title: 'Vocabulary homework',
  remark_homework_none: 'No assignments due this month',
```

**EN — insert immediately after `rslip_signature: 'Signature',` (line ~217):**

```ts
  rslip_attendance: 'Attendance',
  rslip_scores_by_class: 'Scores by class',
  rslip_score_count: '{n} tests',
  rslip_homework: 'Vocabulary homework',
  rslip_homework_done: '{done}/{total} assignments completed',
```

**VI — insert immediately after the vi line for `remark_none` (near line 1435):**

```ts
    remark_roster_title: 'Học sinh',
    remark_coverage: 'Đã viết {n}/{total} phiếu',
    remark_status_written: 'Đã viết',
    remark_status_missing: 'Chưa viết',
    remark_status_sent: 'Đã gửi',
    remark_attendance_title: 'Chuyên cần',
    remark_attendance_none: 'Tháng này chưa có điểm danh',
    remark_homework_title: 'Bài tập từ vựng',
    remark_homework_none: 'Không có bài tập đến hạn trong tháng',
```

**VI — insert immediately after `rslip_signature: 'Ký tên',` (line ~1440):**

```ts
    rslip_attendance: 'Chuyên cần',
    rslip_scores_by_class: 'Điểm theo lớp',
    rslip_score_count: '{n} bài kiểm tra',
    rslip_homework: 'Bài tập từ vựng',
    rslip_homework_done: 'Hoàn thành {done}/{total} bài',
```

Reused existing keys (do NOT re-add): `att_present/att_late/att_absent/att_excused`,
`remark_garden_plays`, `remark_garden_stages`, `garden_streak`, `rslip_garden_days`,
`rslip_garden_fruit`, `assess_no_class`, `rslip_teacher_sign`. The teacher's printed NAME
needs no key (it is data). Run `npm run check:i18n` after this step.

## STEP 4 — New attendance function, `server/services/attendance.ts`

Replace the import lines (1-3) with:

```ts
import { eq, and, gte, lte, isNotNull } from 'drizzle-orm';
import { attendanceRecords, classes, events } from '../db/schema';
import type { Db } from '../db/index';
```

Append at end of file:

```ts
/** One student's month of roll-calls folded per class — the attendance block on the monthly report. */
export type ClassAttendanceSummary = {
  classId: string;
  className: string;
  /** status -> count; only statuses that occurred are present. */
  counts: Record<string, number>;
  total: number;
};

/**
 * `attendance_records` has no class column, so the class comes from the event — the same join
 * tuition bills from (tuition.ts computeMonthLines) and the leaderboard reads (rankings.ts
 * listMonthAttendance). Rows on an event with no class are dropped: an ad-hoc one-off is not
 * part of any class roll. Month range is the project convention `${month}-01`..`${month}-31`,
 * compared lexically (dates are zero-padded).
 */
export async function studentMonthAttendance(
  db: Db,
  studentId: string,
  month: string,
): Promise<ClassAttendanceSummary[]> {
  const rows = await db
    .select({
      classId: events.classId,
      className: classes.name,
      status: attendanceRecords.status,
    })
    .from(attendanceRecords)
    .innerJoin(events, eq(attendanceRecords.eventId, events.id))
    .innerJoin(classes, eq(classes.id, events.classId))
    .where(
      and(
        eq(attendanceRecords.studentId, studentId),
        gte(attendanceRecords.date, `${month}-01`),
        lte(attendanceRecords.date, `${month}-31`),
        isNotNull(events.classId),
      ),
    );

  const byClass = new Map<string, ClassAttendanceSummary>();
  for (const r of rows) {
    if (!r.classId) continue; // the inner join already excluded these; narrowing for TypeScript
    let s = byClass.get(r.classId);
    if (!s) {
      s = { classId: r.classId, className: r.className, counts: {}, total: 0 };
      byClass.set(r.classId, s);
    }
    s.counts[r.status] = (s.counts[r.status] ?? 0) + 1;
    s.total += 1;
  }
  return [...byClass.values()].sort((a, b) => a.className.localeCompare(b.className));
}
```

Uses the existing `idx_attendance_student(student_id, date)` index.

## STEP 5 — Month-windowed assignments in `server/services/garden.ts`

`countQualifying` (line 377) and `deadlineEndUtc` (line 323) are module-private — the new
function lives in this file to reuse them. Add `lte` to the drizzle import on line 1.

Insert AFTER `studentAssignments` ends (after line 483), BEFORE the
`// ---- The play hook ----` comment:

```ts
export type StudentMonthAssignment = {
  id: string;
  topicName: string;
  className: string;
  deadline: string;
  requiredCount: number;
  done: number;
  /** done >= requiredCount — what the slip prints as hoàn thành. */
  completed: boolean;
};

/**
 * Every assignment whose DEADLINE falls inside one ICT month, for one student, with progress —
 * the homework block on the monthly report slip. Contrast `studentAssignments` above, which is
 * forward-looking (deadline >= today) for the /vocabulary chips; a report describes a finished
 * window, missed deadlines included. Same per-assignment `countQualifying` loop, kept on
 * purpose: a student has a handful of assignments a month, and the loop is what lets this share
 * the module-private window logic (created_at .. deadlineEndUtc) with everything else that counts.
 */
export async function studentAssignmentsInMonth(
  db: Db,
  studentId: string,
  month: string,
): Promise<StudentMonthAssignment[]> {
  const list = await db
    .select({
      id: vocabAssignments.id,
      topicId: vocabAssignments.topicId,
      topicName: flashcardTopics.name,
      className: classes.name,
      deadline: vocabAssignments.deadline,
      requiredCount: vocabAssignments.requiredCount,
      minScorePct: vocabAssignments.minScorePct,
      createdAt: vocabAssignments.createdAt,
    })
    .from(vocabAssignments)
    .innerJoin(classStudents, eq(classStudents.classId, vocabAssignments.classId))
    .innerJoin(flashcardTopics, eq(flashcardTopics.id, vocabAssignments.topicId))
    .innerJoin(classes, eq(classes.id, vocabAssignments.classId))
    .where(
      and(
        eq(classStudents.studentId, studentId),
        gte(vocabAssignments.deadline, `${month}-01`),
        lte(vocabAssignments.deadline, `${month}-31`),
      ),
    )
    .orderBy(asc(vocabAssignments.deadline));

  const out: StudentMonthAssignment[] = [];
  for (const a of list) {
    const counts = await countQualifying(
      db,
      a.topicId,
      [studentId],
      a.minScorePct,
      a.createdAt,
      deadlineEndUtc(a.deadline),
    );
    const done = counts.get(studentId) ?? 0;
    out.push({
      id: a.id,
      topicName: a.topicName,
      className: a.className,
      deadline: a.deadline,
      requiredCount: a.requiredCount,
      done,
      completed: done >= a.requiredCount,
    });
  }
  return out;
}
```

## STEP 6 — `server/services/assessments.ts`: RemarkRow fields, stamped writes, markRemarkSent

### 6a. RemarkRow (lines 136-159)

Add to the type after `comment: string | null;`:

```ts
  staffId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** When the slip image last reached a family chat; null = never sent. */
  sentAt: string | null;
```

and in the `mapRemark` return object after `comment: r.comment,`:

```ts
    staffId: r.staffId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    sentAt: r.sentAt,
```

### 6b. createRemark (lines 184-197) — replace the function (keep the existing UPSERT doc comment above it)

```ts
export async function createRemark(
  db: Db,
  input: MonthlyRemarkInput,
  staffId: string | null,
): Promise<RemarkRow> {
  const now = new Date().toISOString();
  const fields = {
    ratings: JSON.stringify(input.ratings),
    comment: input.comment ?? null,
    staffId,
    updatedAt: now,
  };
  await db
    .insert(monthlyRemarks)
    .values({
      id: crypto.randomUUID(),
      studentId: input.studentId,
      month: input.month,
      createdAt: now,
      ...fields,
    })
    .onConflictDoUpdate({
      target: [monthlyRemarks.studentId, monthlyRemarks.month],
      // created_at and sent_at deliberately survive the upsert: first save and delivery are
      // historical facts a re-save must not rewrite.
      set: fields,
    });
  return (await getRemark(db, input.studentId, input.month))!;
}
```

### 6c. updateRemark (lines 199-214) — new signature + stamps

```ts
export async function updateRemark(
  db: Db,
  id: string,
  patch: Partial<MonthlyRemarkInput>,
  staffId: string | null,
): Promise<RemarkRow> {
  const set: Partial<typeof monthlyRemarks.$inferInsert> = {};
  if (patch.studentId !== undefined) set.studentId = patch.studentId;
  if (patch.month !== undefined) set.month = patch.month;
  if (patch.ratings !== undefined) set.ratings = JSON.stringify(patch.ratings);
  if (patch.comment !== undefined) set.comment = patch.comment ?? null;
  if (Object.keys(set).length) {
    set.staffId = staffId;
    set.updatedAt = new Date().toISOString();
    await db.update(monthlyRemarks).set(set).where(eq(monthlyRemarks.id, id));
  }
  const rows = await db.select().from(monthlyRemarks).where(eq(monthlyRemarks.id, id));
  return mapRemark(rows[0]);
}
```

### 6d. markRemarkSent — append after `removeRemark`

```ts
/**
 * Stamp the moment a slip image for this remark reached at least one family chat.
 * Called by /zalo-send-card only after Zalo accepted the photo — never speculatively.
 * A repeat send simply moves the stamp forward; "last sent" is the honest reading.
 */
export async function markRemarkSent(db: Db, id: string): Promise<void> {
  await db
    .update(monthlyRemarks)
    .set({ sentAt: new Date().toISOString() })
    .where(eq(monthlyRemarks.id, id));
}
```

### 6e. Call sites (BOTH, or typecheck fails)

**`app/routes/assessments.tsx`** — line 60: change `await requireStaff(request, env);` to

```ts
  const session = await requireStaff(request, env);
```

Line 107: `await assessSvc.createRemark(db, parsed.data, session.user.id);`
Line 114: `await assessSvc.updateRemark(db, id, parsed.data, session.user.id);`

**`app/routes/api.assessments.remarks.tsx`** — lines 11-12:

```ts
  create: (input, { db, user }) => svc.createRemark(db, input, user.user.id),
  update: (id, patch, { db, user }) => svc.updateRemark(db, id, patch, user.user.id),
```

(`level: 'staff'` guarantees `user.kind === 'staff'`, so `user.user.id` is a staff id.)

## STEP 7 — Report loader, `app/routes/assessments.$month.$studentId.report.tsx`

Add imports:

```ts
import * as attendanceSvc from '../../server/services/attendance';
import * as subjectsSvc from '../../server/services/subjects';
```

and change the shared-logic import to:

```ts
import { NEGATIVE_TYPES, scoreStats, scoreStatsByClass } from '../../shared/logic/assess';
```

Replace the loader body from the `Promise.all` (line 39) through the end of the returned
object (line 89) with:

```ts
  const vnToday = ictDateOf(new Date().toISOString());
  const [
    students,
    classes,
    remark,
    scores,
    behavior,
    criteria,
    garden,
    attendance,
    homework,
    subjects,
    staffList,
  ] = await Promise.all([
    peopleSvc.listStudents(db),
    classesSvc.listLite(db),
    assessSvc.getRemark(db, studentId, month),
    assessSvc.listScores(db),
    assessSvc.listBehavior(db),
    criteriaSvc.list(db),
    // The slip is a keepsake, so a garden hiccup must not 500 the whole document — it drops the
    // garden line and prints everything else.
    gardenSvc.studentGardenMonth(db, studentId, month, vnToday).catch(() => null),
    attendanceSvc.studentMonthAttendance(db, studentId, month),
    // Same degrade-do-not-die posture as the garden line above.
    gardenSvc.studentAssignmentsInMonth(db, studentId, month).catch(() => []),
    subjectsSvc.list(db),
    peopleSvc.listStaff(db),
  ]);

  const student = students.find((s) => s.id === studentId);
  if (!student) throw Response.json({ error: 'unknown_student' }, { status: 404 });

  const monthScores = scores.filter((r) => r.studentId === studentId && r.date.startsWith(month));
  const monthBehavior = behavior.filter(
    (r) => r.studentId === studentId && r.date.startsWith(month),
  );

  // The real roll now prints on the slip, so the hand-logged behavior 'late'/'absent' incidents
  // stay off it — two disagreeing absence numbers on one parent document read as an error. The
  // teacher-facing rail still shows every type.
  const incidents: Record<string, number> = {};
  for (const ty of NEGATIVE_TYPES) {
    if (ty === 'late' || ty === 'absent') continue;
    const n = monthBehavior.filter((r) => r.type === ty).length;
    if (n > 0) incidents[ty] = n;
  }

  const classById = new Map(classes.map((c) => [c.id, c]));
  const subjectById = new Map(subjects.map((s) => [s.id, s.name]));
  const scoreLines = scoreStatsByClass(monthScores).map((g) => {
    const cls = g.classId ? classById.get(g.classId) : undefined;
    return {
      className: cls?.name ?? null,
      subjectName: cls?.subjectId ? (subjectById.get(cls.subjectId) ?? null) : null,
      average: g.average,
      count: g.count,
    };
  });

  return {
    month,
    student: { id: student.id, name: student.name },
    classNames: classes.filter((c) => student.classIds.includes(c.id)).map((c) => c.name),
    // null when the teacher has not written one yet — the slip renders empty stars and says so,
    // rather than 404ing on a URL that is perfectly valid.
    remark,
    // The teacher who last saved the remark, for the signature block. Null for rows that predate
    // the provenance columns (migration 0031) — the slip omits the name rather than guessing.
    teacher: remark?.staffId
      ? (staffList.find((s) => s.id === remark.staffId)?.name ?? null)
      : null,
    // Active criteria only: a retired criterion disappears from newly printed slips even for
    // months whose stored ratings still carry its key.
    criteria: criteria.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name })),
    stats: {
      average: scoreStats(monthScores).average,
      testCount: monthScores.length,
      incidents,
      praiseCount: monthBehavior.filter((r) => r.type === 'praise').length,
    },
    // Per-class averages, subject resolved through the managed subjects list.
    scoreLines,
    // The real roll, per class. Empty array hides the section.
    attendance,
    // Assignments whose deadline fell in this month, done or not.
    homework,
    // Month-scoped garden numbers. Streak is "as of today", so it is only claimed while the
    // reported month is still the running month. NO setbacks on a keepsake — deliberate.
    garden:
      garden && (garden.activeDays > 0 || garden.fruits > 0)
        ? {
            activeDays: garden.activeDays,
            playDays: garden.playDays,
            stagesGained: garden.stagesGained,
            fruits: garden.fruits,
            streak: month === vnToday.slice(0, 7) ? (garden.plant?.streak ?? 0) : 0,
          }
        : null,
  };
```

All existing response fields keep their names/shapes (only `garden` gains fields and
`incidents` loses two keys). Keep the existing loader prologue (env, requireStaff, month
parse) untouched.

## STEP 8 — Slip view, `src/assessments/report-slip.tsx`

### 8a. Imports — line 6:

```ts
import { ATTENDANCE_META, ATTENDANCE_STATUSES, BEHAVIOR_META, scoreColorId } from '../../shared/logic/assess.js';
```

### 8b. `ReportLoaderData` (lines 20-40) — replace the `garden` field and add new fields

```ts
  teacher: string | null;
  scoreLines: {
    className: string | null;
    subjectName: string | null;
    average: number;
    count: number;
  }[];
  attendance: {
    classId: string;
    className: string;
    counts: Record<string, number>;
    total: number;
  }[];
  homework: {
    id: string;
    topicName: string;
    className: string;
    deadline: string;
    requiredCount: number;
    done: number;
    completed: boolean;
  }[];
  /** The month's vocabulary garden, or null when there was no activity worth printing. */
  garden: {
    activeDays: number;
    playDays: number;
    stagesGained: number;
    fruits: number;
    /** 0 unless the reported month is still running. */
    streak: number;
  } | null;
```

### 8c. Destructure (line 233)

```ts
  const {
    month,
    student,
    classNames,
    remark,
    criteria,
    stats,
    scoreLines,
    attendance,
    homework,
    garden,
    teacher,
  } = useLoaderData() as ReportLoaderData;
```

### 8d. SLIP_CSS additions (append inside the `SLIP_CSS` template string, before the closing backtick)

```css
.rslip__table { width: 100%; border-collapse: collapse; font-size: 14px; }
.rslip__table td, .rslip__table th { padding: 4px 6px; border-bottom: 1px dotted #A9C3AF; }
.rslip__table-h { font-size: 12px; color: var(--muted); font-weight: 700; text-align: center; white-space: nowrap; }
.rslip__table-name { text-align: left; font-weight: 600; }
.rslip__table-sub { color: var(--muted); font-weight: 400; font-size: 13px; }
.rslip__table-avg { text-align: center; font-size: 15px; }
.rslip__table-n { text-align: center; color: var(--muted); }
.rslip__hw { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 3px 2px 4px; border-bottom: 1px dotted #A9C3AF; font-size: 14px; }
.rslip__hw-name { min-width: 0; word-break: break-word; }
.rslip__hw-count { font-weight: 700; color: #B3261E; white-space: nowrap; }
.rslip__hw-count--done { color: #2F5C3A; }
.rslip__hw-summary { font-weight: 400; text-transform: none; letter-spacing: 0; }
.rslip__sign-name { font-weight: 700; font-size: 15px; margin-top: 2px; }
```

### 8e. JSX — section order inside `.rslip__body`

head → student field → class field → **stats tile row** (avg, tests, remaining incidents,
praise, garden tiles) → **Scores by class** → **Attendance** → ratings (`remark_title`) →
comment → **Vocabulary homework** → foot/signature.

**(i) Garden tiles** — replace the existing `{garden && (...)}` fragment inside
`.rslip__stats` (lines 391-403) with:

```tsx
                {garden && (
                  <>
                    <span className="rslip__stat rslip__stat--garden">
                      <Sprout />
                      {t('rslip_garden_days')}: <b>{garden.activeDays}</b>
                    </span>
                    <span className="rslip__stat rslip__stat--garden">
                      {t('remark_garden_plays')}: <b>{garden.playDays}</b>
                    </span>
                    {garden.stagesGained > 0 && (
                      <span className="rslip__stat rslip__stat--garden">
                        {t('remark_garden_stages')}: <b>{garden.stagesGained}</b>
                      </span>
                    )}
                    {garden.fruits > 0 && (
                      <span className="rslip__stat rslip__stat--garden">
                        {t('rslip_garden_fruit')}: <b>{garden.fruits}</b>
                      </span>
                    )}
                    {garden.streak > 1 && (
                      <span className="rslip__stat rslip__stat--garden">
                        {t('garden_streak', { n: garden.streak })}
                      </span>
                    )}
                  </>
                )}
```

**(ii) Scores by class + Attendance** — insert immediately after the closing `</div>` of
`.rslip__stats`, before `<p className="rslip__section-title">{t('remark_title')}</p>`:

```tsx
              {scoreLines.length > 0 && (
                <>
                  <p className="rslip__section-title">{t('rslip_scores_by_class')}</p>
                  <table className="rslip__table">
                    <tbody>
                      {scoreLines.map((l, i) => {
                        const c = colorOf(scoreColorId(l.average));
                        return (
                          <tr key={i}>
                            <td className="rslip__table-name">
                              {l.className ?? t('assess_no_class')}
                              {l.subjectName && (
                                <span className="rslip__table-sub"> · {l.subjectName}</span>
                              )}
                            </td>
                            <td className="rslip__table-avg">
                              <b style={{ color: c.ink }}>{l.average}</b>
                            </td>
                            <td className="rslip__table-n">
                              {t('rslip_score_count', { n: l.count })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}

              {attendance.length > 0 && (
                <>
                  <p className="rslip__section-title">{t('rslip_attendance')}</p>
                  <table className="rslip__table">
                    <thead>
                      <tr>
                        <th />
                        {ATTENDANCE_STATUSES.map((s) => (
                          <th key={s} className="rslip__table-h">
                            {t(ATTENDANCE_META[s].tk)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {attendance.map((a) => (
                        <tr key={a.classId}>
                          <td className="rslip__table-name">{a.className}</td>
                          {ATTENDANCE_STATUSES.map((s) => (
                            <td key={s} className="rslip__table-n">
                              {a.counts[s] ?? 0}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
```

**(iii) Homework** — insert after the comment block (`<p className="rslip__comment...">`),
before `.rslip__foot`:

```tsx
              {homework.length > 0 && (
                <>
                  <p className="rslip__section-title">
                    {t('rslip_homework')}
                    {' — '}
                    <span className="rslip__hw-summary">
                      {t('rslip_homework_done', {
                        done: homework.filter((h) => h.completed).length,
                        total: homework.length,
                      })}
                    </span>
                  </p>
                  {homework.map((h) => (
                    <div key={h.id} className="rslip__hw">
                      <span className="rslip__hw-name">
                        {h.topicName} · {h.className}
                      </span>
                      <span
                        className={`rslip__hw-count${h.completed ? ' rslip__hw-count--done' : ''}`}
                      >
                        {h.done}/{h.requiredCount} {h.completed ? '✓' : ''}
                      </span>
                    </div>
                  ))}
                </>
              )}
```

(U+2713 in a system font rasterizes fine; nothing remote is fetched.)

**(iv) Signature block** (lines 419-425) — add the author name line:

```tsx
              <div className="rslip__foot">
                <div className="rslip__sign">
                  <div className="rslip__sign-role">{t('rslip_teacher_sign')}</div>
                  {teacher && <div className="rslip__sign-name">{teacher}</div>}
                  <div className="rslip__sign-hint">{t('rslip_signature')}</div>
                  <div className="rslip__sign-rule" />
                </div>
              </div>
```

**(v) sendToZalo remarkId** — in `sendToZalo`, after `body.set('caption', ...)` (line 299):

```tsx
      // Lets the server stamp monthly_remarks.sent_at — only when there is a saved remark to stamp.
      if (remark) body.set('remarkId', remark.id);
```

The slip stays LIVE and one column (640px); it simply gets taller. No theme/freeze changes.

## STEP 9 — `app/routes/zalo-send-card.tsx`: remarkId + broadcast

Add imports (after line 5):

```ts
import * as assessSvc from '../../server/services/assessments';
import { notifyLive } from '../../server/live';
```

Line 50: change `const env = context.get(cloudflareCtx).env;` to

```ts
  const { env, ctx } = context.get(cloudflareCtx);
```

After `const sent = results.filter((r) => r.ok).length;` (line 92), before the final `return`:

```ts
  // Optional send-tracking: the monthly report slip passes the remark row it was rendered from,
  // and a delivery that reached at least one chat stamps monthly_remarks.sent_at. try/catch so a
  // bookkeeping hiccup can never turn a delivered photo into a reported failure — the send
  // happened either way. notifyLive because the roster on /assessments shows the stamp as a
  // "Sent" badge and this document tab has no route cache of its own to invalidate: the
  // broadcast is the only freshness channel there is, and a downed hub honestly degrades to
  // stale-until-next-load.
  const remarkId = String(form.get('remarkId') ?? '');
  if (remarkId && sent > 0) {
    try {
      await assessSvc.markRemarkSent(db, remarkId);
      notifyLive(env, ctx, 'assessments');
    } catch (err) {
      console.error('[zalo] sent-stamp failed', { remarkId, err: String(err) });
    }
  }
```

Also extend the route's doc comment (near line 10) to mention the optional `remarkId`
FormData field. No status-code changes; a missing/unknown remarkId is a silent no-op
(staff-only endpoint — worst case is stamping a row the caller could edit anyway).

Do NOT modify `MUTATION_EFFECTS`, `src/lib/route-cache.ts`, or add cache code to the slip —
the `notifyLive` broadcast is the whole freshness mechanism (see product decisions above).

## STEP 10 — New resource route `app/routes/report-extras.tsx` + registration

New file, exact content:

```tsx
import type { LoaderFunctionArgs } from 'react-router';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as attendanceSvc from '../../server/services/attendance';
import * as gardenSvc from '../../server/services/garden';
import { TuitionMonth } from '../../shared/schemas';

/**
 * Attendance + vocabulary homework for one (student, month) — the report tab's rail cards.
 *
 * Cookie-authenticated twin pattern of routes/garden-month.tsx, for the same reason: everything
 * under /api/* authenticates by `Authorization: Bearer` only, so a browser `useFetcher().load`
 * (cookie, no header) would 401 and the cards would silently vanish. Query params over path
 * segments, matching that twin. The `{ data }` envelope matches it too, so the card's `error`
 * branch (drop the cards, keep the report) works the same way.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);

  const url = new URL(request.url);
  const studentId = url.searchParams.get('student');
  if (!studentId) return Response.json({ error: 'missing_student' }, { status: 400 });
  const parsed = TuitionMonth.safeParse(url.searchParams.get('month'));
  if (!parsed.success) return Response.json({ error: 'bad_month' }, { status: 400 });

  const [attendance, homework] = await Promise.all([
    attendanceSvc.studentMonthAttendance(db, studentId, parsed.data),
    gardenSvc.studentAssignmentsInMonth(db, studentId, parsed.data),
  ]);
  return { data: { attendance, homework } };
}
```

No default export (resource route — a component export would make React Router serve the
SSR shell instead of JSON). Register in `app/routes.ts` directly under the `garden-month`
line (line 13):

```ts
  // Cookie-authed attendance + homework for the report tab's rail — same twin reasoning.
  route('report-extras', 'routes/report-extras.tsx'),
```

`/report-extras` is deliberately uncached (no clientLoader), like `/garden-month`;
`cacheKeyForPath` does not match it.

## STEP 11 — Roster + rail cards in `src/screens-assessments.tsx`

### 11a. Imports

- Extend the `./lib/assess.js` import (lines 9-18) with `ATTENDANCE_META,
  ATTENDANCE_STATUSES` (alphabetical, before BEHAVIOR_META). `src/lib/assess.ts` re-exports
  `shared/logic/assess.ts`, so both are available.
- Add type imports below the existing service-type imports (lines 23-28):

```ts
import type { ClassAttendanceSummary } from '../server/services/attendance.js';
import type { StudentMonthAssignment } from '../server/services/garden.js';
```

- Line 30: `const { Card, Button, IconButton, Tabs, Badge, Avatar, ProgressBar } = DS;`
  (All exist in `src/ds/bundle.d.ts`: `Avatar{name,color,size}`, `Badge{color,children}`,
  `ProgressBar{value:0-100,color:'brand'|'violet'|'green'|'blue'}`.)

### 11b. New component `ReportRoster` — insert after `TypeBadge` (line 313), before `AssessmentsScreen`

```tsx
/**
 * Who has this month's report and who does not — the coverage column on the report tab.
 * Pure client derivation: the loader already carries every remark and every student, so
 * written/sent needs no extra fetch. Clicking a row drives the same `studentId` state as the
 * Student dropdown; the two controls stay in agreement because they share it.
 */
function ReportRoster({
  students,
  remarkByStudent,
  activeStudentId,
  onSelect,
}: {
  students: StudentRow[];
  remarkByStudent: Map<string, RemarkRow>;
  activeStudentId: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useLang();
  const written = students.filter((s) => remarkByStudent.has(s.id)).length;
  const pct = students.length ? Math.round((written / students.length) * 100) : 0;
  return (
    <Card className="assess-report__roster" style={{ padding: 14 }}>
      <div className="m-spread" style={{ marginBottom: 8, gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-base)' }}>{t('remark_roster_title')}</h2>
        <span className="m-muted" style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>
          {t('remark_coverage', { n: written, total: students.length })}
        </span>
      </div>
      <ProgressBar value={pct} color="green" />
      <div className="assess-report__roster-list">
        {students.map((s) => {
          const r = remarkByStudent.get(s.id);
          return (
            <button
              key={s.id}
              type="button"
              className={`assess-report__roster-row${
                s.id === activeStudentId ? ' is-active' : ''
              }`}
              aria-pressed={s.id === activeStudentId}
              onClick={() => onSelect(s.id)}
            >
              <Avatar name={s.name} color={s.color} size="sm" />
              <span className="assess-report__roster-name">{s.name}</span>
              {r?.sentAt ? (
                <Badge color="blue">{t('remark_status_sent')}</Badge>
              ) : r ? (
                <Badge color="green">{t('remark_status_written')}</Badge>
              ) : (
                <Badge>{t('remark_status_missing')}</Badge>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
```

### 11c. New component `ReportExtrasCards` — insert after `GardenMonthCard` (line 304)

```tsx
/**
 * Attendance and vocabulary homework for the shown (student, month) — the same fetch discipline
 * as GardenMonthCard above (one load per pair; the previous numbers stay on screen while a fetch
 * is in flight), against the cookie-authed /report-extras twin. Chips and rows rather than stat
 * tiles: the rail is 380px, and these are rosters, not headline numbers.
 */
function ReportExtrasCards({ studentId, month }: { studentId: string; month: string }) {
  const { t } = useLang();
  const fetcher = useFetcher<{
    data?: { attendance: ClassAttendanceSummary[]; homework: StudentMonthAssignment[] };
    error?: string;
  }>();

  const key = `${studentId}:${month}`;
  const loaded = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!studentId || loaded.current === key) return;
    loaded.current = key;
    fetcher.load(`/report-extras?student=${encodeURIComponent(studentId)}&month=${month}`);
  }, [key, studentId, month, fetcher]);

  const d = fetcher.data?.data;
  if (fetcher.data?.error || !d) return null;

  return (
    <>
      <Card style={{ padding: 14 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 'var(--text-base)' }}>
          {t('remark_attendance_title')}
        </h2>
        {d.attendance.length ? (
          <div className="m-stack" style={{ gap: 8 }}>
            {d.attendance.map((a) => (
              <div key={a.classId} className="m-spread" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{a.className}</span>
                <span className="m-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {ATTENDANCE_STATUSES.filter((s) => (a.counts[s] ?? 0) > 0).map((s) => {
                    const c = colorOf(ATTENDANCE_META[s].color);
                    return (
                      <span
                        key={s}
                        className="mchip"
                        style={{ background: c.soft, color: c.ink, fontWeight: 700 }}
                      >
                        {t(ATTENDANCE_META[s].tk)} · {a.counts[s]}
                      </span>
                    );
                  })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
            {t('remark_attendance_none')}
          </p>
        )}
      </Card>

      <Card style={{ padding: 14 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 'var(--text-base)' }}>
          {t('remark_homework_title')}
        </h2>
        {d.homework.length ? (
          <div className="m-stack" style={{ gap: 8 }}>
            {d.homework.map((h) => (
              <div key={h.id} className="m-spread" style={{ gap: 8 }}>
                <span style={{ fontSize: 'var(--text-sm)', minWidth: 0 }}>
                  {h.topicName} · {h.className}
                </span>
                <Badge color={h.completed ? 'green' : 'rose'}>
                  {h.done}/{h.requiredCount}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
            {t('remark_homework_none')}
          </p>
        )}
      </Card>
    </>
  );
}
```

### 11d. Wiring inside `AssessmentsScreen`

Replace `existingRemark` (lines 470-472) with:

```tsx
  // One report per (student, month): this map is both the roster's coverage source and the
  // form's "existing" lookup, so the two can never disagree.
  const reportRemarks = React.useMemo(
    () => new Map(remarks.filter((r) => r.month === reportMonth).map((r) => [r.studentId, r])),
    [remarks, reportMonth],
  );
  const existingRemark = reportRemarks.get(activeStudentId);
```

Report tab JSX (currently lines 815-857) — final structure (stats card content stays
byte-identical):

```tsx
        <div className="assess-report">
          <ReportRoster
            students={visibleStudents}
            remarkByStudent={reportRemarks}
            activeStudentId={activeStudentId}
            onSelect={setStudentId}
          />
          <RemarkForm
            key={`${activeStudentId}:${reportMonth}`}
            className="assess-report__form"
            criteria={criteria.filter((c) => c.active)}
            existing={existingRemark}
            printHref={`/assessments/${reportMonth}/${activeStudentId}/report`}
            onSave={saveRemark}
            onDelete={() => void removeRemarkRec()}
          />
          <div className="assess-report__rail">
            <Card className="assess-report__stats" style={{ padding: 14 }}>
              {/* ...existing stats card content UNCHANGED... */}
            </Card>
            <GardenMonthCard studentId={activeStudentId} month={reportMonth} />
            <ReportExtrasCards studentId={activeStudentId} month={reportMonth} />
          </div>
        </div>
```

Do NOT change the `key={...}` on RemarkForm (load-bearing draft reset) or the stats card
content. The roster respects `classFilter` automatically because it receives
`visibleStudents`.

## STEP 12 — `src/styles/app.css`

### 12a. Roster column — insert right after the `.assess-report` rule (after line 1243), before the `.assess-report__rail` comment

```css
/* The roster: who has a report this month and who does not. A fixed-width scrolling column like
   .assess-split__list, so a long roll never stretches the row. */
.assess-report__roster {
  width: 250px;
  flex: none;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.assess-report__roster-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.assess-report__roster-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-md);
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.assess-report__roster-row:hover,
.assess-report__roster-row.is-active {
  background: var(--cream-200);
}
.assess-report__roster-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  font-size: var(--text-sm);
}
```

### 12b. REPLACE the whole `@media (min-width: 1360px)` block (lines 1349-1396 — from its leading comment through the block's closing brace) with:

```css
/* Wide screens: roster | form | rail as grid tracks. The old version promoted the rail's two
   cards to grid columns via `display: contents`; the rail now holds four cards (stats, garden,
   attendance, homework), so it goes back to being a real scrolling column and keeps the compact
   tile styling at every width. The form keeps its 340px floor for the criteria rows. */
@media (min-width: 1360px) {
  .assess-report {
    display: grid;
    grid-template-columns: 260px minmax(340px, 1fr) 380px;
    align-items: stretch;
  }
  /* a grid item's width comes from its track */
  .assess-report__roster {
    width: auto;
  }
  /* the stacked-layout content-height cap does not apply to a full-height column */
  .assess-report__form {
    align-self: stretch;
    max-height: none;
  }
}
```

This intentionally deletes: the `display: contents` on `.assess-report__rail`, the
`minmax(290px,340px)` columns, and the tall/centered `.assess-report__rail .statcard`
overrides (the compact tiles defined at lines 1285-1308 now apply at all widths).

### 12c. Inside the `@media (max-width: 1100px)` block (lines 1398-1432), add:

```css
  /* stacked: the roster is a capped, full-width list above the form */
  .assess-report__roster {
    width: auto;
  }
  .assess-report__roster-list {
    max-height: 280px;
  }
```

## STEP 13 — `docs/api.md`

Line 133 (`/api/assessments/remarks/:id?` row) — extend the description cell to:

```
| `/api/assessments/remarks/:id?` | staff | `MonthlyRemarkInput` — one row per (student, month); POST upserts on that pair. `ratings` is `{ criterionId: 1-5 }`, keyed by `/api/remark-criteria` ids. Rows also carry server-set `staffId` (last author), `createdAt`, `updatedAt`, `sentAt` (last Zalo delivery of the printed slip) — never accepted from the client |
```

## STEP 14 — Unit tests

### 14a. `test/assess.test.ts` — add cases for `scoreStatsByClass` (match the file's existing import/describe style; read its top first)

```ts
describe('scoreStatsByClass', () => {
  it('groups by class, rounds to 1dp, keeps first-appearance order', () => {
    const rows = [
      { classId: 'c1', score: 7.5 },
      { classId: 'c2', score: 8 },
      { classId: 'c1', score: 8.5 },
      { classId: null, score: 5 },
    ];
    expect(scoreStatsByClass(rows)).toEqual([
      { classId: 'c1', average: 8, count: 2 },
      { classId: 'c2', average: 8, count: 1 },
      { classId: null, average: 5, count: 1 },
    ]);
  });
  it('returns [] for no records', () => {
    expect(scoreStatsByClass([])).toEqual([]);
  });
});
```

### 14b. `test-worker/services.test.js` — remark provenance (migrations auto-apply via `test-worker/apply-migrations.js`, so 0031 is live)

Follow the file's existing style (plain service calls against `db()`; create FK parents
first). Check `peopleSvc.createStaff` / `createStudent` input shapes in
`server/services/people.ts` before writing (StaffInput needs `role` + `color`; StudentInput
needs `classIds`).

```js
describe('monthly remarks provenance', () => {
  it('stamps created_at/updated_at/staff_id on create; created_at and sent_at survive the upsert', async () => {
    const d = db();
    const teacher = await peopleSvc.createStaff(d, { name: 'T', role: 'Teacher', color: 'blue' });
    const student = await peopleSvc.createStudent(d, { name: 'S', color: 'green', classIds: [] });
    const input = { studentId: student.id, month: '2026-07', ratings: { rc: 4 }, comment: 'x' };

    const first = await assessSvc.createRemark(d, input, teacher.id);
    expect(first.staffId).toBe(teacher.id);
    expect(first.createdAt).toBeTruthy();
    expect(first.updatedAt).toBeTruthy();
    expect(first.sentAt).toBeNull();

    await assessSvc.markRemarkSent(d, first.id);
    const second = await assessSvc.createRemark(d, { ...input, comment: 'y' }, null);
    expect(second.id).toBe(first.id);               // upsert landed on the same row
    expect(second.createdAt).toBe(first.createdAt); // first save survives
    expect(second.sentAt).toBeTruthy();             // delivery survives a re-save
    expect(second.staffId).toBeNull();              // last author wins

    const patched = await assessSvc.updateRemark(d, first.id, { comment: 'z' }, teacher.id);
    expect(patched.staffId).toBe(teacher.id);
    expect(patched.comment).toBe('z');
  });
});
```

### 14c. (Recommended) `test-worker/garden.test.js` — one case for `studentAssignmentsInMonth`: an assignment whose deadline is inside the month is returned with `done`/`completed`; one dated the month after is not. Reuse the file's existing helpers for creating classes/students/topics/assignments and playing rounds (see lines ~184-240).

## STEP 15 — E2E, `e2e/crud-assess.spec.ts` (write only; do NOT run the staging suite)

**Existing assertions that survive unchanged (verify, do not touch):**
- The remark test's card locator (heading "Monthly remark"), star count 4 (4 seeded
  criteria), "Save report" / "Print report" strings, delete flow.
- The garden test's `.statcard__num` count of 6 — it is scoped to the "Vocabulary garden"
  card, and the new rail cards deliberately use chips/badges, not statcards.

**Add two tests inside the existing describe** (Playwright runs `workers: 1`, so the
count-based assertions cannot race another spec):

```ts
  test('report roster: coverage counter, status badges, row click switches student', async ({
    page,
  }) => {
    const k = ui(page);
    await page.getByRole('tab', { name: 'Monthly report' }).click();

    const roster = page.locator('.mochi-card', {
      has: page.getByRole('heading', { name: 'Students', exact: true }),
    });
    await expect(roster).toBeVisible();
    // Coverage header always reads n/m — n depends on rows other tests may have left behind.
    await expect(roster.getByText(/\d+\/\d+ reports written/)).toBeVisible();
    // Four seeded students, one row each (default class filter is "All classes").
    await expect(roster.locator('.assess-report__roster-row')).toHaveCount(4);

    // Clicking a roster row drives the same state as the Student dropdown: the remark form
    // re-keys to the clicked student, so its print link now carries her id.
    await roster.locator('.assess-report__roster-row', { hasText: 'Mia Chen' }).click();
    const card = page.locator('.mochi-card', {
      has: page.getByRole('heading', { name: 'Monthly remark' }),
    });

    // Writing a report flips the badge to Written and bumps the counter by one.
    const before = await roster.getByText(/\d+\/\d+ reports written/).textContent();
    const beforeN = Number(before!.match(/(\d+)\//)![1]);
    for (const star of await card.getByRole('button', { name: '5', exact: true }).all()) {
      await star.click();
    }
    let post = k.posted('/assessments');
    await card.getByRole('button', { name: 'Save report' }).click();
    await post;
    await expect(card.locator('a', { hasText: 'Print report' })).toHaveAttribute(
      'href',
      /\/s2\/report$/,
    );
    const miaRow = roster.locator('.assess-report__roster-row', { hasText: 'Mia Chen' });
    await expect(miaRow.getByText('Written')).toBeVisible();
    // Zalo is disabled in the test env, so a Sent badge can never appear here.
    await expect(miaRow.getByText('Sent')).toHaveCount(0);
    await expect(roster.getByText(`${beforeN + 1}/`)).toBeVisible();

    // Clean up the row this test created.
    post = k.posted('/assessments');
    await card.getByRole('button', { name: 'Delete' }).click();
    await k.dlgOf('Delete').getByRole('button', { name: 'Confirm' }).click();
    await post;
    await expect(miaRow.getByText('Written')).toHaveCount(0);
  });

  test('report slip: prints real attendance and per-class scores for a seeded month', async ({
    page,
  }) => {
    // June 2026 is the seeded month: attendance rows exist only for 2026-06-22 (s1 present in
    // Biology 9A), and s1 has June scores in c1 and c3. Navigate the document route directly.
    await page.goto('/assessments/2026-06/s1/report');
    await expect(page.getByRole('heading', { name: 'MONTHLY STUDENT REPORT' })).toBeVisible();

    // Attendance section: the real roll, per class.
    await expect(page.getByText('Attendance', { exact: true })).toBeVisible();
    await expect(page.locator('.rslip__table', { hasText: 'Biology 9A' }).first()).toBeVisible();

    // Per-class scores: Biology 9A (7.5, 8.5 -> 8) and World Lit (8) both print.
    await expect(page.getByText('Scores by class')).toBeVisible();
    await expect(page.getByText('World Lit')).toBeVisible();

    // No vocab assignments are seeded for June, so the homework section stays off the slip.
    await expect(page.getByText('Vocabulary homework')).toHaveCount(0);
  });
```

Notes for the implementer:
- The existing remark test clicks star "4"; the new roster test uses "5" so the two never
  share identical selectors. Both create AND delete their own rows — nothing is seeded in
  `monthly_remarks`, and `scripts/test-accounts.sql` does not sweep it (cleanup only
  cascades from re-seeding students).
- The roster-click follow-up is asserted through the Print-report link's `href` (contains
  `/s2/`), which avoids depending on MSelect internals.
- Language is pinned to `en` by `signInStaff`, so English strings are stable. The slip
  heading `rslip_title` renders in an `<h1>`.

## STEP 16 — Verification checklist + delivery

1. `npm run typecheck` (runs `react-router typegen` first — required for the new route file).
2. `npm run lint`.
3. `npm run check:i18n` (EN/VI parity for the new keys).
4. `npm test` (vitest browser project + workers project; D1 migrations auto-applied — 0031
   included).
5. Do NOT run the staging e2e suite; the new specs are code-only deliverables. Say in one
   line that the change affects behaviour the suite covers, and let the user decide.
6. Apply the migration to prod as part of deploy (`npm run db:migrate`) if the deploy flow
   does not do it automatically — check how previous migrations reached prod first.
7. On push: `node scripts/changelog.mjs "Phiếu nhận xét: điểm danh thật theo lớp, điểm trung bình theo lớp/môn, bài tập từ vựng, tên giáo viên và theo dõi gửi Zalo; tab báo cáo thêm danh sách học sinh với tiến độ viết phiếu"` (stages CHANGELOG.md), commit, push to `main`.
8. After push, verify the EAS workflow fired: `cd mobile && npx eas-cli workflow:runs` (top
   entry = your commit, `Status SUCCESS`). Mobile code is untouched by this plan but the
   OTA pipeline ships on every push.

Manual smoke (optional, `npm run dev`): /assessments → Monthly report tab → roster renders;
save a remark → badge flips to Written and the counter bumps; open Print report → new
sections print; resize below 1360px and 1100px to check all three layouts; delete the test
remark.

## STEP 17 — Risks / gotchas for the implementer

1. **Both remark call sites must change together** (web action +
   `app/routes/api.assessments.remarks.tsx`) or `tsc` fails; there are exactly two.
2. **Do not add staffId/timestamps to `MonthlyRemarkInput`** (shared/schemas.ts) — mobile
   posts that schema; server-set fields arriving from a client must stay impossible.
3. **`RemarkForm`'s `key={...}` is load-bearing** (draft reset on student/month switch). The
   roster's `onSelect` goes through `setStudentId` → `activeStudentId`, so the reset keeps
   working — do not add roster-local selection state.
4. **`visibleStudents` vs `activeStudentId` fallback** (screens-assessments.tsx:333-337):
   when the class filter hides the selected student, `activeStudentId` falls back to the
   first visible one. Pass `activeStudentId` (not raw `studentId`) to the roster's
   active-row check, as prescribed.
5. **The 1360px CSS replacement is all-or-nothing.** Leaving `display: contents` on
   `.assess-report__rail` while switching the grid template will scatter the rail cards into
   wrong tracks. Delete the whole old block and paste the new one.
6. **e2e garden test counts `.statcard__num` = 6 scoped to the garden card** — keep the new
   rail cards on chips/badges (as prescribed), not the local `Stat` component.
7. **`onConflictDoUpdate` set must NOT include `createdAt` or `sentAt`** — insert-only
   stamping is the point; the 14b test pins it.
8. **`sent_at` stamping must come AFTER `sent` is computed, only when `sent > 0`, inside
   try/catch** — a D1 hiccup must not convert a delivered photo into an error response.
9. **Zalo is disabled in the test env** (`zalo.isEnabled` → 503), so the sent path is
   untestable e2e beyond asserting the badge's absence; the service-level `markRemarkSent`
   unit test is the real coverage.
10. **Month range convention is `${month}-01`..`${month}-31` lexical** (zero-padded dates;
    rankings.ts:67-69 precedent) — copy it exactly; do not "fix" it to real month ends.
11. **Streak on the slip only for the running month** — `month === vnToday.slice(0, 7)` with
    `vnToday = ictDateOf(...)`, not the Worker's UTC date, or a slip printed late evening VN
    time flips months.
12. **Report/print routes and `/report-extras` stay uncached** (outside `_app`, no
    clientLoader). `cacheKeyForPath` matches neither — do not add keys.
13. **`session.user.id` nesting** — `SessionUser.user.id` is the staff id; `session.id` does
    not exist and will not compile.
14. **i18n parity** — every EN key needs its VI mirror or both `tsc` (the `satisfies`
    clause) and `check:i18n` fail.
15. **Seeded classes have `subject_id = NULL`** (seed.sql inserts only the legacy `subject`
    text), so `subjectName` is null in dev/e2e slips and the "· subject" suffix simply does
    not render. Not a bug.
16. **`studentAssignmentsInMonth`'s N+1 loop is deliberate** (module-private
    `countQualifying` reuse; a student-month has few assignments). Do not export
    `countQualifying`.
17. **Two `0030_*` migrations exist** (numbering collided once); `0031_remark_meta.sql`
    sorts after both. Run `ls migrations/` before creating the file — another session may
    have taken 0031 by then.
18. **NO setbacks and NO behavior late/absent tiles on the slip** are deliberate product
    decisions — the rationale lives in the loader comments this plan prescribes.
