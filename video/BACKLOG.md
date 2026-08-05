# Video catalog backlog

Guide #1 (`guide-calendar-basics`) is built and proves the pipeline end to end. Everything
below is planned but not started. Ordered roughly by value.

Each guide is: a walkthrough script → `npm run record` → `npm run sync` → captions in
`src/catalog.ts`. The brand kit, templates and render pipeline already exist, so a new
guide is mostly storyboarding and selectors.

## Guides (Vietnamese, 16:9)

### 2. Điểm danh — attendance
Open today's session from the calendar → the roster inside the event dialog → mark
Có mặt / Muộn / Vắng / Có phép → note that another teacher's open tab updates live
(the `LiveHub` Durable Object broadcast) → attendance summary.

*Needs:* the dialog's tabs only render for a **saved** event that has a class
(`showTabs = !isNew && !!f.classId`, `src/calendar/event-modal.tsx:336`), so the
walkthrough must open an existing class session, not create one. Attendance
**autosaves** — every chip click is a real write, so pick a demo class and restore the
original marks afterwards, or accept the change.

### 3. Tạo đề & chấm điểm — build and grade a test
Question bank with filters → build a test → assign → a student takes it with the timer →
auto-graded MCQ + teacher-graded essay → score appears on Đánh giá.

*Needs:* two accounts (staff + student) to show taking and grading, so the recorder needs
a second context. Longest guide; probably split into "tạo đề" and "chấm điểm".

### 4. Học phí — tuition and the fee slip
Per-session class prices → monthly fees computed from attendance → payments and
adjustments → the pastel phiếu thu rendered to an image and copied for Zalo.

*Needs:* admin-only. **Never let the walkthrough close a month** — that freezes amounts.
The most distinctive workflow in the product and the best marketing material.

### 5. Từ vựng — vocabulary, AI generation and the games
Topic from a name + count + CEFR level via Claude → review the generated cards → fill
blanks with IPA and Vietnamese gloss → play Flip / Quiz / Matching.

*Needs:* generation calls the app's own Anthropic-backed endpoint, so it costs the
account, not this project. Keep counts small.

### 6. Tùy chỉnh lịch — the calendar theme drawer
Presets → per-element colour pickers → background image with opacity.

*Needs:* **the drawer writes on every interaction** and "Xong" only closes it
(`src/screens-extra.tsx:523-533`). Capture the account's original `theme` values first
and post them back afterwards, or this permanently restyles the demo account.

### 7. Mọi người & mã mời — people and invite codes
Students / Staff / Parents tabs → type-ahead enrolment chips → generate a one-time
`XXX-XXX` invite code per role.

## Shorts (9:16 + square + 16:9, 20–30s)

These are **rebuilt UI**, not footage — motion graphics using the real design system
(`src/ds/index.js` plus the token CSS in `src/ds/styles/tokens/`), so they can move
faster and read on a phone. A `FeatureShort` template and the portrait/square format
entries in `src/formats.ts` exist; the template itself does not.

- **Tạo từ vựng bằng AI** — "Soạn flashcard trong 10 giây?" → topic typed → cards
  cascade in → one flips → CTA.
- **Phiếu thu học phí** — attendance dots tally into a total → the pastel slip slides in
  → copy → a mock Zalo bubble.
- **Trailer (~45s)** — stitched from short scenes plus the strongest guide moments.

*First task when starting these:* verify `src/ds/bundle.js` renders under Remotion's
webpack (it is precompiled, and its runtime deps and font paths are unverified). If it
fights back, hand-roll the few fragments each short needs using `@shared/tokens`.

## Changelog videos

`CHANGELOG.md` has ~90 plain-English entries and `shared/changelog.ts` already parses it
(`parseChangelog`, pure and fs-free — import it via the `@shared` alias). A
`ChangelogVideo` template would render version pill + date + body as staggered cards.

*Blocker:* changelog bodies are **English by contract** ("release notes are not
translated"), which conflicts with Vietnamese-only videos. Plan: a `sync-changelog`
script writes `public/changelog.vi.json`, translations authored in Claude Code and
committed, with untranslated entries flagged rather than silently shipped in English.

## Pipeline improvements worth doing

- **Portrait and square guides.** `DeviceFrame` exists for exactly this — stacked
  layouts inset the footage and put the caption below it — but no guide uses a stacked
  format yet, so the layout is untested.
- **A per-step click timestamp.** The manifest records only step start and end, so the
  cursor pulse fires at the step start and is approximately, not exactly, when the click
  happened. Recording the click time would tighten every pulse.
- **Music.** Pick one warm, unobtrusive loop and use it across the whole catalog so the
  series sounds like a series.
