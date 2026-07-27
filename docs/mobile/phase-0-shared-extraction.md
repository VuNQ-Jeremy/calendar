# Phase 0 — Versioning and shared extraction

**Depends on:** nothing
**Touches:** `shared/`, `scripts/`, `CHANGELOG.md`, `version.json`, `src/lib/i18n.tsx`,
`app/routes/_app.tsx`, `src/flashcards/game-flip.tsx`, `src/calendar/utils.ts`,
`migrations/0013_app_version.sql`
**Risk:** low
**Bar:** zero behavior change, **except** the new version stamp in the sidebar.

## Why

Two jobs, both prerequisites for everything after.

**Versioning.** From here the project ships to two clients, one of which updates over the air.
When a user says "the flip card feels wrong", you need to know which bundle they are running —
and with OTA updates you cannot tell by looking. A single counter, bumped on every push to
`main`, carried into both apps and into every feedback submission, makes that answerable.

**Shared extraction.** The mobile app needs three things the web app already has, buried in
web-specific files:

1. The 1186-line bilingual dictionary in `src/lib/i18n.tsx`, which sits in the same file as a
   React context, a `<LanguageToggle/>`, and `localStorage` access — none of which work in
   React Native.
2. The palette in `src/ds/styles/tokens/colors.css`, which is CSS custom properties that React
   Native cannot read.
3. Pure game and calendar logic — the flip-card constants, `expandEvents` — interleaved with
   DOM code.

Extracting now means Phases 2–5 never choose between duplicating strings (which drift) and
importing web modules into Metro (which fails). `shared/` already exists and already holds
`schemas.ts`, imported by both server and client — the pattern is proven.

---

## Task 0.1 — Versioning (do this first)

Every subsequent push in the project uses this, including the rest of Phase 0.

### The scheme

**One shared counter for the whole repo.** Both apps ship from the same commit, so one number
always identifies exactly what a user is running.

Format: `v{major}.{build padded to 4}` → **`v0.0001`**, `v0.0002`, …

- **`build` is derived from git**: `git rev-list --count HEAD`. Nothing stores it.
- **`major` is stored and bumped by hand**, at real milestones only (e.g. `v1.0000` when the
  mobile app ships to students).

> **Why derived, not stored.** This repo is worked on from more than one machine. A stored
> counter means both machines edit the same line of the same file, so every parallel push
> conflicts — in `version.json` *and* at the top of `CHANGELOG.md`. A derived build number has
> nothing to merge: any clone, on any OS, computes the same number for the same commit.

**Caveat, stated honestly:** the build number counts *commits*, not pushes. A push carrying
three commits advances it by three. It also shifts if history is ever rewritten (rebase,
squash). Neither matters for identifying a build — the git SHA shipped alongside is the exact
identifier — but do not treat the number as a stable count of releases.

### `shared/version.json` — only what can't be derived

```json
{
  "major": 0,
  "runtimeVersion": 1
}
```

Both fields change roughly twice a year, so they effectively never conflict.

> **It lives in `shared/`, not the repo root.** Metro's `watchFolders` (Phase 2) covers
> `shared/` but not the repo root — a `version.json` at the root would resolve on web and fail
> on mobile.

### `runtimeVersion` is a separate number — this matters

`runtimeVersion` is the **native compatibility** version. An OTA update only reaches an
installed APK whose `runtimeVersion` matches.

**Do not set Expo's `runtimeVersion` policy to `appVersion`.** If it tracked the push counter,
every push would orphan every installed APK and force a full reinstall — destroying the entire
OTA benefit. Bump `runtimeVersion` **by hand, only when native dependencies change** (a new
native module, a new permission, an `app.json` plugin change). Expect it to change roughly
twice in the whole project.

### `shared/version.ts` — pure formatting

`shared/version.ts` runs in the browser and in React Native, so it **cannot call git**. It
formats; the build number is injected.

```ts
import v from './version.json';

export const MAJOR = v.major;
export const RUNTIME_VERSION = v.runtimeVersion;

/** Display form: formatVersion(42) → "v0.0042". */
export function formatVersion(build: number): string {
  return `v${MAJOR}.${String(build).padStart(4, '0')}`;
}

/**
 * Android versionCode must be a monotonically increasing integer.
 * major*10000 + build stays monotonic across major bumps: v0.9999 → 9999, v1.0000 → 10000.
 */
export function versionCode(build: number): number {
  return MAJOR * 10_000 + build;
}
```

Needs `resolveJsonModule: true` in `tsconfig.json` — verify it is set.

### `scripts/git-version.mjs` — the build-time source

Runs in Node, at build time only. Used by both `vite.config.ts` and `mobile/app.config.ts`.

```js
import { execSync } from 'node:child_process';

const git = (cmd, fallback) => {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return fallback; }
};

/** Commit count on the current branch. 0 outside a git checkout. */
export const gitBuild = () => Number(git('git rev-list --count HEAD', '0'));
/** Short commit SHA, or 'dev' outside a git checkout. */
export const gitSha = () => git('git rev-parse --short HEAD', 'dev');
```

**Both must degrade gracefully.** A build from a tarball, a CI checkout with no history, or a
machine without git on `PATH` must still succeed — falling back to `0` / `'dev'`, never
throwing. Use `git` from `PATH`; do not hardcode a path or assume a shell.

**Web wiring** — in `vite.config.ts`:

```ts
define: {
  __APP_VERSION__: JSON.stringify(formatVersion(gitBuild())),
  __GIT_SHA__: JSON.stringify(gitSha()),
}
```

Declare both in a `globals.d.ts` so TypeScript knows them.

**Mobile wiring** — Phase 2, in `app.config.ts`.

### `scripts/changelog.mjs`

With the number derived, the script's only job is the changelog entry (and the occasional major
bump). **Write it anyway** — a manual edit will get skipped; a script gets run.

```bash
node scripts/changelog.mjs "Extract i18n strings and color tokens into shared/"
node scripts/changelog.mjs --major "Mobile app ships to students"
```

It must:
1. Compute `build = gitBuild() + 1` — the count *after* the commit you are about to make.
2. With `--major`: increment `major` in `shared/version.json` and stage it.
3. Prepend an entry to `CHANGELOG.md` with the version, today's date (generated, not
   hardcoded), and the message.
4. **Refuse to run with an empty message.**
5. `git add CHANGELOG.md` (+ `shared/version.json` if `--major`).

> **Run it as part of your final commit before pushing.** The `+1` assumes the changelog entry
> and the work land in the same commit. If a push carries several commits, the recorded number
> will trail the real one — harmless, since the SHA is authoritative, but worth knowing.

### `CHANGELOG.md` (repo root)

Authoritative, committed alongside the code it describes, newest first:

```markdown
# Changelog

One entry per push to `main`. Newest first. Add one with:
`node scripts/changelog.mjs "what changed"`

Version = `v{major}.{commit count}`. `major` lives in `shared/version.json`;
the build number is derived from git and is never stored.

## v0.0002 — 2026-07-28
Extract the i18n dictionary, color tokens, and pure game/calendar logic into `shared/`
so the mobile app can import them. No behavior change.

## v0.0001 — 2026-07-27
Introduce shared versioning: `shared/version.json`, the bump script, and the sidebar
version stamp.
```

**1–2 lines per entry.** Write what changed and why, for a human — not the commit subject.

### Add the standing rule to `CLAUDE.md`

Under the existing Git section, which already mandates push-to-`main`-only and
commit-when-finished:

```markdown
- **Add a changelog entry on every push to `main`.** Run
  `node scripts/changelog.mjs "1–2 line summary"` as part of your final commit. The build
  number is derived from the git commit count — never store or hand-edit it. Bump the major
  only at real milestones (`--major`).
```

### Web version stamp

New `src/components/version-stamp.tsx`, rendering `v0.0042 · a1b2c3d`.

Place it in the `Sidebar` in `app/routes/_app.tsx`, **between the `.sb__langbar` div (currently
lines 160–162) and the staff Feedback CTA (currently line 163)**:

```tsx
      <div className="sb__langbar">
        <LanguageToggle />
      </div>
      <VersionStamp />                             {/* ← new */}
      {user.kind === 'staff' && (
        <button className="sb__cta" onClick={onFeedback} …>
```

It renders for staff and students alike. Style as `.sb__version` in `src/styles/app.css`:
small, muted (`var(--taupe-400)`), DM Mono for tabular figures.

> **Hide it below 720px.** At that width the sidebar collapses to a 64px icon rail
> (`app.css:423`) and a version string would be clipped. Add it to that existing media query
> rather than writing a new one.

### Feedback carries the version

Add a nullable column so every report identifies its build:

`migrations/0013_app_version.sql`
```sql
ALTER TABLE feedback ADD COLUMN app_version TEXT;
```

- Mirror it in `server/db/schema.ts` on the `feedback` table.
- Add `appVersion: z.string().max(50).nullish()` to `FeedbackInput` in `shared/schemas.ts:137`.
  **Nullish, so existing rows and any caller that omits it stay valid.**
- The web feedback modal sends `__APP_VERSION__` + `__GIT_SHA__`. Phase 2 does the same from mobile,
  additionally including the `expo-updates` update ID.
- Surface it in the feedback inbox (`app/routes/feedback.tsx`) next to each message.

Apply with `npm run db:migrate:local` if local D1 works, otherwise `npm run db:migrate` (remote).

> **Phase 1's migration is therefore `0014_mobile.sql`, not `0013`.** Its doc has been updated;
> confirm before writing it.

### Mobile (forward reference — Phase 2 implements)

- `app.config.ts` calls `gitBuild()` and feeds it through `formatVersion` / `versionCode`, and
  sets `runtimeVersion` from `RUNTIME_VERSION` — **not** the `appVersion` policy.
- The More/Profile footer shows `v0.0042 · rt1 · a1b2c3d` plus the `expo-updates` update ID.
  This is the only reliable way to tell which OTA bundle a phone is running.

---

## Task 0.2 — Extract the i18n dictionary

**Current state:** `src/lib/i18n.tsx` (1186 lines) exports `LangCtx`, `LanguageProvider`,
`useLang()` → `{ t, lang, setLang }`, `getCal(lang)`, `LanguageToggle`, and holds `STRINGS`.
`LanguageProvider` wraps `<Outlet/>` in `app/root.tsx:41`. The choice persists to
`localStorage` under `LANG_KEY`, wrapped in try/catch.

**Create `shared/i18n/strings.ts`:**

```ts
export type Lang = 'en' | 'vi';

// Moved verbatim. Every key MUST have both an `en` and a `vi` entry.
export const STRINGS = { /* … the entire existing object, unchanged … */ } as const;

/** Localized month names, weekday names, first-day-of-week. Moved verbatim. */
export function getCal(lang: Lang) { /* … unchanged … */ }

/**
 * Pure lookup with {placeholder} interpolation, falling back to `en` then the key itself.
 * This is exactly the body of `t` at src/lib/i18n.tsx:1150-1159 — move it, do not rewrite it.
 */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const dict = STRINGS[lang] as Record<string, string>;
  const en = STRINGS.en as Record<string, string>;
  let s = dict[key] ?? en[key] ?? key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}
```

**Reduce `src/lib/i18n.tsx` to the React layer:**

```tsx
import { STRINGS, getCal, translate, type Lang } from '../../shared/i18n/strings';
export { STRINGS, getCal, type Lang };   // keep the existing public surface intact
// LangCtx, LanguageProvider, useLang, LanguageToggle, LANG_KEY, LANGUAGES stay here.
// `t` becomes a useCallback wrapper over translate(lang, key, vars).
```

**Rules:**

- **Do not change a single string value.** This is a move, not an edit.
- Keep every export name available from `src/lib/i18n.tsx`. Around 30 files import from it —
  **none should need editing.** If a call site breaks, you changed the surface; fix the
  surface.
- `LANG_KEY`, `LANGUAGES`, and `localStorage` access stay in `src/lib/i18n.tsx`. Mobile gets
  its own provider over AsyncStorage.
- `app/root.tsx` hardcodes `<html lang="en">` despite the app being bilingual. **Leave it** —
  fixing it is a behavior change and out of scope.

**Verify:** print the `en` and `vi` key counts before and after; all four numbers must match.
Put them in the commit message.

---

## Task 0.3 — Mirror the color tokens into TypeScript

**Source:** `src/ds/styles/tokens/colors.css` (115 lines) — raw ramps (`--orange-50` …
`--orange-700`, plus violet / green / blue / cocoa / cream / sand / taupe / ink) and semantic
aliases (`--bg-page`, `--surface-card`, `--text-strong`, `--brand`, `--border-subtle`,
`--cat-violet-soft`, …).

**Create `shared/tokens.ts`:**

```ts
/**
 * MIRROR of src/ds/styles/tokens/colors.css.
 * That CSS file is the source of truth for WEB; this file is the source of truth for MOBILE.
 * Kept in sync by hand — change one, change the other.
 */
export const ramp = {
  orange: { 50: '#…', /* … through 700 */ },
  violet: {/*…*/}, green: {/*…*/}, blue: {/*…*/},
  cocoa: {/*…*/}, cream: {/*…*/}, sand: {/*…*/}, taupe: {/*…*/}, ink: {/*…*/},
} as const;

export const semantic = {
  bgPage: ramp.cream[50], surfaceCard: '#ffffff', textStrong: ramp.ink[700],
  brand: ramp.orange[500], borderSubtle: ramp.taupe[100],
  // … one entry per semantic custom property, camelCased
} as const;

/** The six ColorId values from shared/schemas.ts:21, with their soft/solid pairs. */
export const categoryColor = {
  violet: { soft: '#…', solid: '#…' }, green: { soft: '#…', solid: '#…' },
  blue:   { soft: '#…', solid: '#…' }, orange:{ soft: '#…', solid: '#…' },
  cocoa:  { soft: '#…', solid: '#…' }, rose:  { soft: '#…', solid: '#…' },
} as const;

export const typography = { display: 'Fredoka', body: 'NunitoSans', mono: 'DMMono' } as const;
export const radius  = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
```

**Rules:**

- Read the actual hex values out of `colors.css`. **Do not invent or approximate colors** — the
  design system is a binding contract.
- `categoryColor` keys must be exactly the six `ColorId` values (`shared/schemas.ts:21`):
  `violet | green | blue | orange | cocoa | rose`. These strings are stored in the database
  (`staff.color`, `students.color`, `classes.color`, `events.color`, `flashcard_topics.color`),
  so they are a **data contract**, not a styling choice.
- Pull `radius` and `spacing` from `spacing.css` and `effects.css` rather than guessing.
- Add a comment at the top of `colors.css` pointing back here.
- **The web app does not import this file.** Written now, used in Phase 2. Nothing to regress.

---

## Task 0.4 — Extract the flip-gesture constants

**Source:** `src/flashcards/game-flip.tsx:11-19`.

**Create `shared/logic/flip-gesture.ts`:**

```ts
/** Movement (px) before a press becomes a drag. Below this it is a tap, which flips the card. */
export const DRAG_SLOP_PX = 8;
/** Degrees of tilt per horizontal pixel dragged. */
export const ROT_PER_PX = 0.07;
export const MAX_ROT_DEG = 15;
/** Pendulum arc curvature: dy = -(dx^2) * ARC_K — the card rises as it swings sideways. */
export const ARC_K = 1 / 1600;
/** Cap on the rise, so the exit toss doesn't fly off the top. */
export const MAX_LIFT_PX = 140;
/** Fraction of card width the drag must cover to commit. */
export const COMMIT_RATIO = 0.35;
/** px/ms — a fast flick commits even below the distance threshold. */
export const FLICK_VX = 0.5;
/** Fly-out duration, ms. */
export const EXIT_MS = 280;

/** Vertical offset of the pendulum arc. Always <= 0 (upward). */
export function arcLift(dx: number): number {
  return -Math.min(MAX_LIFT_PX, dx * dx * ARC_K);
}

/** Tilt in degrees, clamped to +/- MAX_ROT_DEG. */
export function arcRotation(dx: number): number {
  return Math.max(-MAX_ROT_DEG, Math.min(MAX_ROT_DEG, dx * ROT_PER_PX));
}

/** Commit if the drag travelled far enough, OR was a fast flick in a consistent direction. */
export function shouldCommit(dx: number, vx: number, cardWidth: number): boolean {
  const farEnough = Math.abs(dx) > cardWidth * COMMIT_RATIO;
  const flicked = Math.abs(vx) > FLICK_VX && Math.sign(vx) === Math.sign(dx) && Math.abs(dx) > 24;
  return farEnough || flicked;
}
```

**Update `src/flashcards/game-flip.tsx`** to import these, keeping `arcTransform` as a thin
composition, and replace the inline commit heuristic (currently ~lines 187–189) with
`shouldCommit`:

```ts
import { arcLift, arcRotation, shouldCommit } from '../../shared/logic/flip-gesture';

function arcTransform(dx: number): string {
  return `translate(${dx}px, ${arcLift(dx)}px) rotate(${arcRotation(dx)}deg)`;
}
```

**Verify the output is numerically identical before and after.** This is the most tuned code in
the app (commits `24c4b28`, `e9f3d43`, `1a44469`) and it is easy to silently change the feel.

---

## Task 0.5 — Extract calendar recurrence logic

Move `expandEvents` from `src/calendar/utils.ts` into `shared/logic/recurrence.ts`, and any
pure date helpers it needs into `shared/logic/dates.ts`. Re-export from `src/calendar/utils.ts`
so no calendar component changes.

`expandEvents` handles `events.recurrence` (`'none' | 'daily' | 'weekly'`, per `EventInput` at
`shared/schemas.ts:37`). The mobile agenda (Phase 4) and the class-reminder cron (Phase 6) both
need exactly this. Three implementations disagreeing about when a weekly class falls is a bug
users will not forgive.

**Rule:** the extracted modules must have **zero DOM imports**. If something drags in `window`
or a DOM type, it does not belong in `shared/logic/`.

---

## Task 0.6 — Housekeeping

- Add `mobile/node_modules/`, `mobile/.expo/`, `mobile/android/`, `mobile/ios/` to `.gitignore`
  now, so Phase 2 cannot accidentally commit them.
- `npm run lint` is currently `oxlint src worker workers app` and **excludes `shared`**. Change
  it to `oxlint src worker workers app shared scripts`.
- Confirm `tsconfig.json` type-checks `shared/` and has `resolveJsonModule: true`.

---

## Acceptance criteria

**Versioning**
- [ ] `shared/version.json` is `{ "major": 0, "runtimeVersion": 1 }` — **no `build` field.**
- [ ] `formatVersion(42) === 'v0.0042'` and `versionCode(42) === 42`; with `major: 1`,
      `versionCode(0) === 10000` (monotonic across the bump).
- [ ] `gitBuild()` returns the commit count; **rename `.git` temporarily** (or run from a
      tarball) and confirm the build still succeeds with `0` / `'dev'` rather than throwing.
- [ ] **Clone the repo to a second location and confirm both clones report the same version
      for the same commit.** This is the whole point of deriving it.
- [ ] `node scripts/changelog.mjs "test"` prepends an entry with the correct next number and a
      generated date, and stages `CHANGELOG.md`. With no message it **refuses**.
- [ ] `--major` increments `major` in `shared/version.json` and stages it.
- [ ] `CHANGELOG.md` exists with an entry per push made during this phase.
- [ ] `CLAUDE.md` carries the standing changelog rule.
- [ ] The sidebar shows `v0.00NN · <sha>` between the language toggle and the Feedback button,
      for **both** a staff and a student account.
- [ ] Narrow the browser below 720px — the stamp is hidden, and the icon rail is undamaged.
- [ ] Migration `0013_app_version.sql` applied; submitting feedback records `app_version`, and
      the inbox shows it.

**Extraction**
- [ ] `shared/i18n/strings.ts`, `shared/tokens.ts`, `shared/logic/{flip-gesture,recurrence,dates}.ts`
      all exist.
- [ ] No file under `shared/` imports React, `react-dom`, `react-router`, or anything DOM.
      (`schemas.ts` importing `zod` is expected.)
- [ ] `src/lib/i18n.tsx` exports every name it did before. **No call site changed.**
- [ ] EN and VI key counts match each other and the pre-refactor count. Numbers in the commit
      message.

**Regression**
- [ ] `npm run lint && npm run typecheck && npm run test` green.
- [ ] `npm run build && npm run deploy` succeeds.
- [ ] On the deployed app, after a **hard refresh**: toggle EN ↔ VI across five screens with no
      untranslated strings; play the flip game and confirm the swipe feels **identical**; open
      the calendar and confirm a weekly recurring event still appears on every expected day.
- [ ] Committed and pushed to `main`.

## Notes for the executor

- Land Task 0.1 as its own push (`v0.0001`) before starting the extraction, so the rest of the
  phase already uses the bump script.
- Apart from the version stamp, this phase produces no visible feature. That is the point.
  Resist improving anything you touch — every change here is a change you debug through five
  later phases.
- If `src/lib/i18n.tsx` contains pluralization or fallback logic beyond what is shown above,
  move it into `translate()` **unchanged**. Do not redesign it.
