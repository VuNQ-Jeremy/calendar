# Phase 5 — Remaining staff surfaces: people, materials, assessments, config, feedback

**Depends on:** Phase 4
**Touches:** `mobile/` only
**Risk:** low-medium — mostly volume, few unknowns
**Deliverable:** **full parity.** Everything the web app does, the phone does.

## Why last

These are the administrative screens: enrolling a student, uploading a worksheet, reviewing a
term's scores, renaming an assessment type. They are done sitting at a desk, usually on a
laptop, usually in a batch. They are the least urgent on a phone — but parity was the explicit
requirement, so they get built.

This phase is the largest by line count and the smallest by risk. There is no new architecture
here. Every pattern was established in Phases 2–4: React Query keys, the endpoints module, the
theme primitives, list → detail navigation, role gating.

---

## Task 5.1 — People

Source: `src/screens-manage/people.tsx` — **1049 lines**, the largest screen in the codebase.
It handles four entity families (students, staff, parents, invites) with create/update/delete
for each, plus per-student flashcard stats, in one file with one action.

**Do not port it as one screen.** Split:

```
/people                    → top tabs: Students · Staff · Parents · Invites
/people/student/[id]       → detail + edit + class memberships + flashcard stats
/people/staff/[id]         → detail + edit  (role: Teacher | Admin | Assistant)
/people/parent/[id]        → detail + edit + linked students
/people/invites            → list, generate, revoke
```

Details that matter:

- **Search is essential.** The web has a `min-width: 240px` search input; on mobile it is the
  primary way to find anyone. Put it in the header, always visible.
- **Class membership** (`class_students`) is edited from both the class roster (Phase 4) and the
  student detail. Both write the same join table — make sure both invalidate `['classes']` and
  `['people']`.
- **Parent accounts are unsupported** — `getUser` returns `null` for them
  (`server/services/auth.ts:104`). Parents exist as *records* (contactable people linked to
  students) but cannot log in. Manage the records; do not build a parent app experience, and do
  not offer to send them an invite that will not work. Check `redeemInvite` behavior for the
  `'Parent'` role before deciding what the invite UI should offer.
- **Invite codes** are `XXX-XXX`. The web copies them with `navigator.clipboard`
  (`people.tsx:859,964`). On mobile use **`expo-clipboard`** plus a **native share sheet**
  (`expo-sharing` / `Share`) — sending a code over Zalo or SMS is the actual delivery mechanism
  here, and it is a genuine improvement over the web.

---

## Task 5.2 — Materials

Source: `app/routes/materials.tsx`, `src/screens-extra.tsx`, `src/material-search.tsx`.

- **List** with search, type filter (`notes | worksheet | video | link | curriculum`), and
  favorites.
- **Upload** — `expo-document-picker` → multipart `FormData` → `POST /api/materials`.
  Keep the **20 MB cap** and surface it *before* the upload fails. Show real progress; a
  20 MB upload on Vietnamese mobile data is slow enough that a spinner is not enough.
- **Add a link** — the `url` variant, no file.
- **Preview** — `docx-preview` is DOM-only and does not port. Open
  `/materials/:id/view` (bearer-authenticated, Phase 1) in a `WebView`, or hand off to the
  platform viewer via `Linking` / `expo-sharing`. Also wire `/materials/:id/download`
  (`content-disposition: attachment`) to the system downloader.
- **Photo upload** — `expo-image-picker` for camera capture. A genuinely new capability: a
  teacher can photograph a whiteboard and attach it. Optional, but cheap and clearly useful.

The web's `materials.tsx` `clientAction` is the one place that **writes the mutated row back
into the cache** so post-action revalidation is a cache hit (`app/routes/materials.tsx:90-120`).
The React Query equivalent is `setQueryData` in `onSuccess`. Mirror it — this screen was
optimized deliberately.

---

## Task 5.3 — Assessments

Source: `app/routes/assessments.tsx`, `src/screens-assessments.tsx` (622 lines).

Two record types, both CRUD:

- **`score_records`** — `studentId`, `classId?`, `date`, `score` (0–10, `real`),
  `assessmentTypeId?`, `notes?`
- **`behavior_records`** — `studentId`, `classId?`, `date`, `type`, `notes?`, where `type` ∈
  `late | absent | missing_homework | disruptive | praise | other` (`BehaviorType`,
  `shared/schemas.ts:146`)

**Charts:** `src/components/charts.tsx` hand-rolls `ProgressLineChart` and `StackedBarChart` in
raw SVG. These port to **`react-native-svg`** with near-identical code — the path math is
unchanged, only the element names differ (`<svg>` → `<Svg>`, `<path>` → `<Path>`). This is the
easiest part of the phase.

**Tables:** the web renders wide score tables. On a phone, a table is the wrong form. Use a
per-student card list with the score prominent, filterable by class, date range, and assessment
type. If a table is genuinely needed, put it in a **horizontally scrollable container** —
never let the page itself scroll sideways.

---

## Task 5.4 — Config (Admin only)

Source: `app/routes/config.tsx`, `src/screens-config.tsx`. Gated on `user.role === 'Admin'`;
the API enforces it with a 403 (`requireApiAdmin`).

- **Assessment types** — CRUD plus **reorder**. The web uses HTML5 `draggable` + drag events
  (`src/screens-config.tsx:156-171`), which **does not work on touch**. Use
  `react-native-draggable-flatlist`, posting the new order to
  `POST /api/assessment-types/reorder` (`AssessmentTypeReorder` = `{ ids: string[] }`).
- **Scrollbar style preference** (`slim | inset | brand | ghost`) — **drop it.** Android has no
  styleable scrollbar; the setting is meaningless on mobile. Leave the value untouched so the
  web keeps working, and simply do not surface it. Note the omission in the More screen if
  users might look for it.

---

## Task 5.5 — Feedback

Source: `app/routes/feedback.tsx`, `src/feedback.tsx`. The in-app feedback inbox: list by status
(`new | reviewed | done`), read, update status. Plus the submit form, which on web lives in a
modal in the `_app.tsx` shell.

On mobile, put **submit** in the More screen ("Send feedback") and the **inbox** as its own
screen. Prefill `author` from the logged-in user, and include the app version and
`runtimeVersion` in the message metadata — with OTA updates, knowing which bundle a user is on
is the difference between a reproducible bug report and a guess.

---

## Task 5.6 — Parity audit

The last real task of the project. Walk the web app's 13 routes and confirm each has a mobile
equivalent, or a **deliberate, documented** omission.

| Web route | Mobile | Notes |
|---|---|---|
| `/dashboard` | Phase 4 | |
| `/calendar` | Phase 4 | Week time-grid may be deliberately omitted |
| `/classes` | Phase 4 | |
| `/people` | Phase 5 | |
| `/materials` | Phase 5 | docx preview via platform viewer, not `docx-preview` |
| `/homework` | Phase 4 | |
| `/assessments` | Phase 5 | Tables → cards |
| `/flashcards` | Phase 3 | |
| `/flashcards/:slug` | Phase 3 | |
| `/config` | Phase 5 | Scrollbar pref deliberately dropped |
| `/feedback` | Phase 5 | |
| `/profile` | Phase 2 | |
| `/login` | Phase 2 | Password-reset deep link may be deferred |

Also check the shell-level features in `app/routes/_app.tsx`: the **badge counts** on nav items,
the **feedback modal**, and the **dev inspector** (`src/dev-inspector.tsx` — skip it, it is a web
debugging tool). The first-visit intro modal was removed from the web app, so there is nothing
to port.

Write the result into `docs/mobile-parity.md`, listing every deliberate omission with its
reason. Future-you will ask.

---

## Acceptance criteria

- [ ] People: all four entity families listable, searchable, and editable; changes visible on
      the web.
- [ ] Invite code generation works and shares via the native share sheet.
- [ ] Materials: upload a file (with progress), add a link, favorite, search, and open a `.docx`
      and a `.pdf` in a viewer.
- [ ] The 20 MB cap is enforced **before** upload with a clear message.
- [ ] Assessments: create score and behavior records; charts render; filters work.
- [ ] Config (Admin): assessment type CRUD and drag-reorder both work. A **Teacher** cannot
      reach the screen and the API returns 403.
- [ ] Feedback: submit and inbox both work.
- [ ] `docs/mobile-parity.md` written, with every omission justified.
- [ ] Full click-through of every mobile screen on a physical device at 360dp width: no
      horizontal scroll, no clipped text, no touch target under 48dp.
- [ ] Every string translated in both EN and VI. Grep the `mobile/` tree for quoted
      user-facing literals — there should be none outside `strings.ts`.
- [ ] Committed and pushed to `main`; `eas update --branch preview` shipped.

## Notes for the executor

- This phase is volume, not difficulty. If something here feels architecturally hard, you are
  probably porting a desktop layout instead of designing a mobile one — go back to the Phase 4
  governing principle.
- `src/screens-extra.tsx` (969 lines) bundles Materials, Profile, and the calendar theme panel.
  Profile shipped in Phase 2. Do not port the file; port the features.
- Every screen you build here should take a fraction of the time Phase 4's calendar took. If it
  does not, say so — it means an assumption in this plan was wrong, and that is worth surfacing
  rather than absorbing.
