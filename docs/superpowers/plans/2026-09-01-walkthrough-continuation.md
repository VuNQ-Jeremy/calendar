# Walkthrough Feature — Continuation Plan

> **For agentic workers:** Tasks 1–2 were EXECUTED and shipped as `3917872` (2026-09-01) — their checkboxes below are the record, not open work. Everything under "Gated work" waits on the user's first manual pass.

**Goal:** Everything a zero-context session needs to keep working on the `/walkthrough` feature: what shipped, where it lives, which behaviours are deliberate, and the concrete next tasks.

**Architecture:** Three units, all shipped. (1) `shared/walkthrough.ts` — a pure typed catalogue of 27 user stories in 7 journeys; the single source of truth both other units read. (2) `src/walkthrough/tour-driver.tsx` — an overlay mounted once in the app shell that, in a popup window carrying a per-tour `?tour=<token>`, spotlights the current step's target, pre-fills `WALKTHROUGH …` values into React's controlled inputs via the native-setter trick, and auto-ticks steps it can observe. (3) `src/walkthrough/walkthrough-screen.tsx` — the checklist at `/walkthrough` (`requireAdmin`); **Run** mints the token, opens the popup, and the two windows talk over `src/walkthrough/tour-channel.ts` (BroadcastChannel `'mochi-tour'`).

**Tech Stack:** React Router v8 SSR on Cloudflare Workers, Mochi DS (`src/ds/`), Playwright e2e, vitest, oxlint/tsc/check-i18n gates.

**Spec:** The approved interactive mockups — checklist https://claude.ai/code/artifact/5d9c5657-9c09-4ca8-82e3-b4da61b79259 · tour mode https://claude.ai/code/artifact/62f32524-4186-480a-b188-531890f2ac26. Overnight e2e report: https://claude.ai/code/artifact/c24cc98c-0292-4207-970e-6ca0d40ab2f8.

---

## Current state (2026-09-01)

- **Shipped** as `f9c4c1e` (feature, one commit) and `7976464` (overnight e2e fix loop, one commit). Both on `main`, deployed to prod by Workers Builds.
- **Verified in a real browser**: `e2e/crud-walkthrough.spec.ts` ran for the first time during the overnight loop and passed all 4 tests — role gating, catalogue render, localStorage persistence, and the full popup tour round-trip (the popup's `Class name` input held `WALKTHROUGH 7A` before submit, proving the native-setter prefill reaches React state; the submit step auto-ticked on the real save).
- Tasks 1–2 below shipped as `3917872`: the driver + catalogue are lazy-loaded behind the `?tour=` param (measured ~11.9KB gz off every authed page — _app chunk 8,052→4,436 B gz and the 8,250 B gz tour chunk out of the eager graph), and CLAUDE.md now carries the catalogue maintenance rule.
- **NOT yet done: the user's own manual pass on prod.** This is the stated gate for the mobile-journey and automated-tour backlog items — running it is what validates whether the 27-story catalogue matches how the product is actually used.

## Where everything lives

| File | Responsibility |
|---|---|
| `shared/walkthrough.ts` | `TourTarget`/`TourStep`/`TourStory`/`TourJourney` types, `JOURNEYS` (7), `STORIES` (27), `WT_PREFIX = 'WALKTHROUGH'`. PURE — no React/DOM/`server/` imports (rule stated in its header; `mobile/` consumes `shared/` as a `file:` dep). Story text is deliberately English-only. |
| `src/walkthrough/tour-channel.ts` | `TourMsg` union (`run`/`stop`/`hello`/`tick`/`ready`; `run`/`tick`/`ready` carry `token`), `openTourChannel(onMsg)`, and the `isTourMsg` runtime narrowing predicate (moved here from the driver — both endpoints import it). SSR-safe no-op when `BroadcastChannel` is undefined. |
| `src/walkthrough/tour-driver.tsx` | The overlay (`export function TourDriver`, line ~352). Reads `?tour=` from its own URL ONCE on mount; without it, it never opens the channel and can never tick. Spotlight = dev-inspector-style fixed overlay, z-index 10000, `pointer-events: none` except the coach. Submit auto-tick captures `fetcher.data` **while the fetcher is still busy** (react-router deletes idle fetchers from `state.fetchers` synchronously before any render sees them — the long comment on `submitFetcherDataRef` explains; do not "simplify" back to a by-key lookup) and refuses the tick only on a *recognised* error shape (`{error}` / `{errors}`) — unrecognised results still tick, so the worst case is a missing auto-tick, never a false one. |
| `src/walkthrough/walkthrough-screen.tsx` | The checklist. Run mints `crypto.randomUUID()`, opens `window.open(story.route + '?tour=' + token)`, posts `run`; accepts inbound `tick`/`ready` only on token+storyId match; handles inbound `stop`. Progress in localStorage `mochi_walkthrough_v1` — read in a mount effect, persisted via `progressRef` + plain statements (a `useEffect([progress])` persist is a REAL StrictMode data-loss bug here; the in-file comment explains). Reset uses `useConfirm()` (`wt_reset_q`/`wt_reset_confirm`/`wt_reset`). |
| `app/routes/walkthrough.tsx` | Loader `requireAdmin`, NO action (progress is client-side). Registered top-level in `app/routes.ts` next to logo-library — deliberately not `/platform/walkthrough` (NavLink prefix-active trap). |
| `app/routes/_app.tsx:30,491` | Driver import + mount: `{user.kind === 'staff' && <TourDriver />}` — visibility gate only; the route guard is the permission. |
| `src/lib/sidebar-nav.tsx` | Nav row `walkthrough`, icon `mapPin`, `staffOnly+adminOnly` (admin section; `test/sidebar-sections.test.tsx` enforces icon uniqueness). |
| `src/styles/app.css` | ONE `/* ==== WALKTHROUGH ==== */` banner holding both `.tourd-*` (driver) and `.wt-*` (screen). Keep it one banner. |
| `test/walkthrough.test.ts` | Data invariants: unique ids, journeys resolve, every story starts with a `goto` whose route matches `story.route`, every story containing a `fill` ends on a /cleanup/i step, every fill value starts `WALKTHROUGH`, `caution` stories carry no `fill`/`submit`. |
| `e2e/crud-walkthrough.spec.ts` | The four tests above; `crudGuard()`-gated to calendar-test. |
| i18n | Chrome keys `nav_walkthrough`, `wt_*` in `shared/i18n/strings.ts` (en+vi pairs enforced by `satisfies` + `npm run check:i18n`). Story content is NOT translated by design. |

## Deliberate behaviours — do not "fix" these

Each was ruled with reasons during the build (ledger: `C:\Users\ADMIN\.claude\plans\walkthrough-sdd-ledger.md`):

1. **Coach "Next" ticks a skipped step.** Next is a deliberate human action; checkboxes are hand-editable; Pass/Fail is the real verdict.
2. **A hard reload of the tour window ends the tour** (the `?tour=` param is gone). Safe failure — a silently resuming window is how false ticks happen. Run stays rendered on the card, so recovery is one click.
3. **`Delete`/`Save` targets with no dialog open show the "ambiguous target" coach message instead of a spotlight.** That is the honest degrade — never silently pick one of several matches. If a specific story deserves assistance there, give it a `{ css }` target in the catalogue, don't loosen the resolver.
4. **`fill` requires a `dialog`** — page-level inputs stay `check` steps (widening it buys one story and a second resolution path in the driver).
5. **The driver refuses to run when the UI language ≠ English** — targets are English label text, the same contract `e2e/crud-helpers.ts` uses.
6. **`stop` is untokened** — any same-origin tab can cancel a tour, never verify one; `tour-channel.ts`'s comment argues the trade.
7. **CAUTION-pill contrast (~3.4:1)** matches `.mochi-btn.is-danger` — a DS-wide property; fixing it here would fork the design system.

## Global Constraints

- Push to `main` only; commit+push when a task is finished; every push runs `node scripts/changelog.mjs "…"` (it stages CHANGELOG.md itself). Never `git add -A`.
- Test suites are manual-trigger only — write specs, run only `npm run typecheck` / `npm run lint` / `npm run check:i18n` / `npm run format` freely. `test:e2e:staging` costs ~22 min and resets calendar-test.
- Never call the paid APIs (`/enrich-vocab`, `/generate-vocab`, `/vocab-image-generate`, `/speech-assess`).
- Exclude `.worktrees/**` from every search — full repo mirror.
- e2e baseline is **4 KNOWN failures** (see memory `preexisting-e2e-failures` and commit `7976464`'s body) — pvp room-battle, feedback changelog-hide, sidebar hairline-scrollbar, curriculum grade-filter. None are walkthrough-related; do not treat them as regressions.

---

### Task 1: Lazy-load the tour driver out of the shell chunk

The driver + the 27-story catalogue are statically imported by `app/routes/_app.tsx`, so ~8KB gzipped rides the layout chunk **every** authenticated user loads — students and parents included, for whom it is entirely dead weight (measured with esbuild during the final review of `f9c4c1e`). The fix ships it only to windows that can actually use it: those opened with `?tour=`.

**Files:**
- Modify: `app/routes/_app.tsx:30` (the import) and `app/routes/_app.tsx:491` (the mount)
- Test: existing `e2e/crud-walkthrough.spec.ts` test 4 covers the behaviour end to end (write nothing new; do not run it — note it for the user)

**Interfaces:**
- Consumes: `TourDriver` (named export, `src/walkthrough/tour-driver.tsx:352`). `React.lazy` needs a default, so map it: `.then((m) => ({ default: m.TourDriver }))`.
- Produces: nothing new — the mount just becomes conditional + lazy.

- [x] **Step 1: Replace the static import with a lazy one** at `app/routes/_app.tsx:30`:

```tsx
// Lazy on purpose: the driver plus the 27-story catalogue it imports are ~8KB gzipped, and a
// window can only ever BE a tour window when it was opened with `?tour=<token>` (see
// src/walkthrough/walkthrough-screen.tsx's Run). Everyone else — every student, every parent,
// every ordinary staff tab — should not download it at all.
const TourDriver = React.lazy(() =>
  import('../../src/walkthrough/tour-driver.jsx').then((m) => ({ default: m.TourDriver })),
);
```

- [x] **Step 2: Gate the mount on the initial URL, post-hydration.** SSR has no `window` and the server must render the same nothing the client's first paint renders (the house localStorage-in-an-effect pattern, e.g. `src/lib/i18n.tsx:33-40`, exists for exactly this hydration reason). Inside `AppLayout`, near its other state:

```tsx
// True only in a window that was OPENED as a tour window. Read once, post-hydration: the token
// is in the opening URL, client-side navigation during a tour keeps the component mounted, and
// a hard reload dropping the param ends the tour by design (see tour-driver.tsx).
const [isTourWindow, setIsTourWindow] = React.useState(false);
React.useEffect(() => {
  if (new URLSearchParams(window.location.search).has('tour')) setIsTourWindow(true);
}, []);
```

- [x] **Step 3: Update the mount** at `app/routes/_app.tsx:491`:

```tsx
{user.kind === 'staff' && isTourWindow && (
  <React.Suspense fallback={null}>
    <TourDriver />
  </React.Suspense>
)}
```

Keep the existing one-line comment about the route guard being the real permission.

- [x] **Step 4: Verify** — `npm run typecheck && npm run lint`, both clean. Then state in the report (do not run): `npm run test:e2e:staging` exercises the popup round-trip; test 4 of `crud-walkthrough.spec.ts` fails loudly if the lazy driver never mounts.
- [x] **Step 5: Optional but cheap proof of the win:** `CLOUDFLARE_ENV=test npm run build` before and after, diff the `_app`/layout chunk sizes in `build/client/assets/`, put the numbers in the commit body.
- [x] **Step 6: Commit + push** — `node scripts/changelog.mjs "walkthrough: tour driver + catalogue lazy-load out of the shell chunk"`, stage `app/routes/_app.tsx` + `CHANGELOG.md` explicitly, commit (`Co-Authored-By:` line per CLAUDE.md), push. Then delete the matching bullet from `BACKLOG.md` item 3 in the same commit (BACKLOG rule: shipped items are deleted).

### Task 2: The maintenance contract — CLAUDE.md line + BACKLOG cleanup

The catalogue is only worth having while it reflects the product; the user approved a same-commit maintenance rule during design and it never landed.

**Files:**
- Modify: `CLAUDE.md` (End-to-end tests section) and, if Task 1 didn't already, `BACKLOG.md` item 3.

- [x] **Step 1: Add one bullet** to CLAUDE.md's "End-to-end tests" section, matching its voice:

```markdown
- **A user-visible feature also updates the walkthrough catalogue in the same commit.** New
  screen, new dialog, renamed button — if a person would meet it on a manual pass, the story in
  `shared/walkthrough.ts` that covers it changes too (or a new story is added: goto-first, fill
  values prefixed `WALKTHROUGH`, cleanup last — `test/walkthrough.test.ts` enforces the shape).
  The tour targets literal English UI strings, so a copy change silently breaks a spotlight.
```

- [x] **Step 2: Commit + push** with `node scripts/changelog.mjs "docs: walkthrough maintenance rule in CLAUDE.md"` (fold into Task 1's commit if executing together).

---

## Gated work — wait for the user's manual pass

**The gate:** the user opens https://calendar.ngqv0712.workers.dev/walkthrough as `dev@mochi.edu` / `mochi123` and runs the stories (~30–45 min all 27; stories tagged `caution` are look-don't-touch on real data; write stories create `WALKTHROUGH …` rows and end with cleanup). Expect catalogue drift findings — wrong labels, steps that don't match reality; fix those in `shared/walkthrough.ts` (labels come from the story's listed spec file or the screen source, never guessed).

Then, from `BACKLOG.md` item 3:

1. **Mobile walkthrough journeys** (~1 day) — flashcards/offline queue, garden, PvP on the phone. Maestro (`cd mobile && npm run test:device`, manual-trigger only), NOT Playwright. Read `docs/mobile/TESTING.md` and memory `mobile-test-suite` first.
2. **Automated prod tour, `e2e/tour-*.spec.ts`** (~half day) — walks the catalogue read-mostly against PROD (deliberately outside `crudGuard()`'s calendar-test gate, so it needs its own prod-safety rules: `WALKTHROUGH`-named rows only, cleanup in `finally`, no `caution`-story writes ever). The typed `STORIES` steps are designed to translate mechanically.

## If a walkthrough e2e failure appears

- Re-read commit `7976464`'s body and memory `preexisting-e2e-failures` before diagnosing — the 4 known-left failures are NOT walkthrough's, and the big spec traps (Zalo-default login tab → use `gotoEmailLogin()`; `.data` bodies are turbo-stream, never `.json()` them) are documented there.
- The tour's one unproven-by-suite surface is visual: the coach bubble near the viewport edge and `.wt-*` layout were never eyeballed. Memory `verify-css-without-deploying` has the file:// harness technique.
- Live checks without a browser: memory `live-verify-authed-pages` (`/login` POST needs `intent=login`; session cookie `__mochi_session`; the sidebar stamp `v{build} · {sha}` is server-rendered on authed pages — grep it to confirm what a deployment is serving).
