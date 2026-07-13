# Phase 3 — Data layer: Drizzle + loaders/actions, retire the client store and `/api/*`

**Goal:** per-route server reads and validated mutations. At the end: `src/store.js` deleted,
`worker/api.ts` deleted, no `GET /api/state`, no whole-DB-to-client. Screens get exactly the data
their route loads.

---

## Task 1 — Drizzle schema (typed source of truth)

1. `npm i drizzle-orm && npm i -D drizzle-kit`
2. `server/db/schema.ts` — mirror the **existing** migrations exactly (do not "improve" the
   schema; drift here corrupts everything downstream). Column-complete reference — verify each
   against `migrations/0001_init.sql` and `0002_feedback.sql` while writing:
   ```ts
   import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

   export const staff = sqliteTable('staff', {
     id: text('id').primaryKey(),
     name: text('name').notNull(),
     email: text('email'),
     role: text('role').notNull().default('Teacher'),
     color: text('color').notNull().default('orange'),
     phone: text('phone'),
   });

   export const students = sqliteTable('students', {
     id: text('id').primaryKey(), name: text('name').notNull(), grade: text('grade'),
     guardian: text('guardian'), email: text('email'), color: text('color').notNull().default('blue'),
   });

   export const parents = sqliteTable('parents', {
     id: text('id').primaryKey(), name: text('name').notNull(), email: text('email'),
     phone: text('phone'), color: text('color').notNull().default('green'), relation: text('relation'),
   });

   export const classes = sqliteTable('classes', {
     id: text('id').primaryKey(), name: text('name').notNull(), subject: text('subject'),
     color: text('color').notNull().default('green'), room: text('room'),
   });

   export const classSchedule = sqliteTable('class_schedule', {
     id: integer('id').primaryKey({ autoIncrement: true }),
     classId: text('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
     day: integer('day').notNull(),
     startTime: text('start_time').notNull(),
     endTime: text('end_time').notNull(),
   }, (t) => [index('idx_class_schedule_class').on(t.classId)]);

   export const classStudents = sqliteTable('class_students', {
     classId: text('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
     studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
   }, (t) => [primaryKey({ columns: [t.classId, t.studentId] }),
              index('idx_class_students_student').on(t.studentId)]);

   export const parentStudents = sqliteTable('parent_students', { /* same pattern */ });

   export const events = sqliteTable('events', {
     id: text('id').primaryKey(), title: text('title').notNull(), date: text('date').notNull(),
     startTime: text('start_time'), endTime: text('end_time'), color: text('color'),
     classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
     location: text('location'), recurrence: text('recurrence').notNull().default('none'),
   }, (t) => [index('idx_events_date').on(t.date)]);

   // homework, materials, invites, settings, feedback, accounts, sessions: same pattern —
   // read the SQL and transcribe. booleans are INTEGER columns:
   //   done: integer('done', { mode: 'boolean' }).notNull().default(false)
   ```
3. `drizzle.config.ts`: `{ dialect: 'sqlite', schema: './server/db/schema.ts', out: './migrations' }`.
4. **Baseline check:** run `npx drizzle-kit generate`. The generated migration must be empty /
   no-op (schema == DB). If it isn't, the transcription is wrong — fix the schema, never the
   existing migrations. Delete the no-op file afterward. From now on, schema changes =
   edit `schema.ts` → `drizzle-kit generate` → review SQL → `wrangler d1 migrations apply`.
5. `server/db/index.ts`: `export const db = (env: Env) => drizzle(env.DB, { schema });` — created
   per-request in loaders/actions (Workers have no cross-request state guarantees).

## Task 2 — Shared zod schemas

`npm i zod`. `shared/schemas.ts` — one schema per collection, matching the client shapes (these
are the wire shapes the screens already use, **not** the snake_case DB columns):

```ts
import { z } from 'zod';
export const ColorId = z.enum(['violet', 'green', 'blue', 'orange', 'cocoa', 'rose']);
export const EventInput = z.object({
  title: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  end: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  color: ColorId.nullish(),
  classId: z.string().nullish(),
  location: z.string().max(200).nullish(),
  recurrence: z.enum(['none', 'daily', 'weekly']).default('none'),
});
export type EventInput = z.infer<typeof EventInput>;
// ClassInput (with schedule: array of {day: 0–6, start, end} and studentIds: string[]),
// StudentInput, StaffInput, ParentInput, HomeworkInput (points: int ≥ 0 nullable),
// MaterialInput (type enum notes|worksheet|video|link), InviteInput (role enum),
// FeedbackInput (category enum), ThemeInput (hex colors + bgOpacity 0–1) — same style.
```

Cross-check field names against what the screens actually submit (`grep` the screen modals) —
e.g. events use `start`/`end` in the UI but `start_time`/`end_time` in the DB; the service layer
owns that mapping.

## Task 3 — Service layer

`server/services/{classes,people,events,homework,materials,invites,feedback,theme}.ts`. Rules:

- Signature style: `list(db)`, `create(db, input: XInput)`, `update(db, id, patch)`,
  `remove(db, id)` — services take the Drizzle instance, return **wire-shaped** objects
  (camelCase, nested arrays like `class.studentIds`), never raw rows.
- Port the relation logic from `worker/api.ts` (`writeRelations`, `deleteItem` cleanup) into the
  matching service, using `db.batch([...])` for multi-statement writes so they're atomic.
- IDs: `crypto.randomUUID()` server-side. Reject client-supplied ids on create.
- `events.listRange(db, fromIso, toIso)` — add now: `WHERE date <= to AND (recurrence != 'none'
  OR date >= from)` (recurring events dated before the window still expand into it — the client
  recurrence expansion stays for display, so recurring rows must always be included).

## Task 4 — Convert routes, one screen per PR-sized commit

Order (simplest first): **feedback → homework → materials → classes → people → calendar →
profile → dashboard**. For each route:

1. **Loader** returns only what the screen reads. Examples:
   - `homework.tsx`: `{ homework: homework.list(db), classes: classes.listLite(db) /* id,name,color for tags */ }`
   - `calendar.tsx`: `{ events (raw rows incl. recurring), classes: listLite, theme }`
   - `dashboard.tsx`: `{ todayEvents, dueHomework, counts }` — computed server-side; the client
     stops receiving the whole DB.
2. **Action**: one action per route, dispatch on `formData.get('intent')`
   (`'create' | 'update' | 'delete' | …`), validate with the zod schema
   (`Schema.safeParse(Object.fromEntries(formData))` — JSON-encode array/nested fields like
   `schedule` into a single field and `JSON.parse` before validation), call the service, return
   `{ ok: true }` or `{ errors }` with 400.
3. **Screen refactor**: replace `useStore()` reads with `useLoaderData()`; replace `add/update/
   remove` calls with `useFetcher()` submissions. RR revalidates loaders after actions
   automatically — the old optimistic-mirror logic dies.
4. **Optimistic UI** (only where latency is felt): homework check-off and calendar
   drag-to-reschedule render from `fetcher.formData` while in flight:
   ```tsx
   const fetcher = useFetcher();
   const done = fetcher.formData ? fetcher.formData.get('done') === 'true' : hw.done;
   ```
5. **Sidebar badges**: `_app.tsx` loader returns `{ homeworkDueCount, unusedInviteCount,
   newFeedbackCount }` via one `db.batch` of three counts. Automatic revalidation keeps them live.
6. Delete the screen's collection from `worker/api.ts`'s `COLLECTIONS` map once migrated (keeps
   the retiring surface honest).

## Task 5 — Retirement and cleanup

1. When the last screen is converted: delete `src/store.js`, `worker/api.ts`, the `/api/` branch
   in `workers/app.ts`, and the worker API test suite; replace with service-level tests (call
   services against the migrated test D1 from Phase 0's `cloudflare:test` setup) plus one
   loader/action integration test per route.
2. `grep -rn "useStore\|/api/" src/ app/` → zero hits.
3. Theme: `calendar.tsx` loader includes it; theme panel submits via fetcher to the calendar
   action (`intent: 'theme'`), service merge-writes the `settings` row.

---

## Acceptance criteria

- [ ] `drizzle-kit generate` on a clean tree produces no new migration (schema == DB).
- [ ] No route loads data it doesn't render; `GET /api/state` is gone; devtools network tab on
      `/dashboard` shows **no** `/api/` requests.
- [ ] Every mutation validates: submitting an event with `date: 'garbage'` via curl returns 400
      with field errors and writes nothing.
- [ ] Multi-statement writes are atomic (`db.batch`): killing a class-save mid-way cannot leave
      schedule without roster (covered by a service test asserting batch usage).
- [ ] Homework check-off and calendar drag feel instant (optimistic), then persist across reload.
- [ ] Sidebar badge counts update after relevant mutations without a full reload.
- [ ] `src/store.js` and `worker/api.ts` deleted; tests, lint, typecheck, build green; manual
      click-through clean.
