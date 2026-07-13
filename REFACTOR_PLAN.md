# Mochi — Tech-Stack Review & Site Refactor Plan

_Reviewed: 2026-07-13. Scope: the whole runnable app (`src/`, `worker/`, build + deploy). The
`design/` prototype is reference material and stays untouched._

---

## 1. Current stack (what's actually here)

| Layer | Today | Notes |
|---|---|---|
| UI framework | React 18.3.1 — loaded as **UMD globals from unpkg CDN** | Not bundled; `src/lib/globals.js` re-exports `window.React` |
| Language | Plain JS, **no JSX** — every component is hand-written `React.createElement(...)` | ~2,400 lines of it across `src/` |
| Build | Vite 6 | Bundles the app modules only; React + DS stay external globals |
| Design system | Mochi DS bundle attached to `window.MochiDesignSystem_472b36` | Duplicated in `public/_ds/` and `design/_ds/`; binding visual contract |
| Styling | DS token CSS + one hand-rolled BEM file (`src/styles/app.css`) | Fine at this size |
| Routing | None — `active` string state in `AppShell` | No URLs, no deep links, no back button |
| State/data | One React context (`store.js`): `GET /api/state` full snapshot on mount, optimistic writes | Every mutation re-renders the whole app (this already caused the remount bug in git history) |
| i18n | Hand-rolled EN/VI dictionary (`src/lib/i18n.js`) | Small and adequate |
| Auth | **Mocked, client-side only** — any password logs in; session = user JSON in `localStorage` | `accounts`/`sessions` tables exist in D1 but are unused |
| API | Cloudflare Worker, hand-rolled router, string-built SQL over D1 | **Zero auth on `/api/*`** — anyone with the URL can read/write everything |
| File uploads | Materials ≤4 MB read as data-URLs; **bytes are never persisted** (worker only stores `fileName`) | Download after reload produces a placeholder text file |
| Types / lint / tests / CI checks | None. CI = deploy-on-push-to-main only | No safety net at all |
| Fonts | Google Fonts CDN | External runtime dependency |

### Verdict on the stack itself

The **platform choices are good and should stay**: Vite + React SPA + Cloudflare Worker + D1 +
static assets is well-matched to a small teacher/admin tool. There is no case for migrating to
Next/Remix/etc. The problems are all in *how* the stack is wired:

1. **React from a third-party CDN at runtime** — production availability and security depend on
   unpkg; no version lockstep with `package.json`; defeats Vite's bundling, tree-shaking, and
   offline dev.
2. **No JSX** — `React.createElement` everywhere is the single biggest drag on readability and
   maintenance, and it directly enabled the remount bug class documented in `CLAUDE.md`.
3. **The API is completely unauthenticated** while the login screen accepts any password. This is
   the only item here that is a real security hole rather than tech debt.
4. **No URLs** — refresh always lands on Dashboard; nothing is linkable.
5. **Whole-app re-render on every store write** — known source of past bugs.
6. **No tests/lint/types** — every refactor below is risky until this exists.

---

## 2. Refactor plan

Ordered so each phase is independently shippable, and the risky mechanical rewrites happen only
after a safety net exists. Phases 1–3 are the core refactor; 4–6 are the functional upgrades the
docs already call "next steps".

### Phase 0 — Safety net (do first, ~small)
- Add **oxlint** (the DS already ships `_adherence.oxlintrc.json`) + Prettier.
- Add **Vitest + React Testing Library**: a render smoke test per screen, unit tests for
  `lib/core.js` date helpers and the calendar's `expandEvents` recurrence logic.
- Add worker API tests via `wrangler dev`/Miniflare against local D1 (CRUD round-trip per
  collection, relation cleanup on delete).
- New GitHub Actions job: lint + test + build on every push/PR (keep the existing deploy job).

### Phase 1 — Own the module graph (mechanical, high value)
- Move `react`/`react-dom` to real `dependencies`; **import them instead of UMD CDN scripts**.
- Vendor the DS components as an ES module: wrap or port `_ds_bundle.js` into
  `src/ds/` (component names and props stay identical — it remains the binding contract), so the
  app and DS share React via normal imports instead of `window`.
- Delete `src/lib/globals.js` and the three `<script>` tags in `index.html`.
- Self-host the three font families (`@fontsource/*` or static woff2) to remove the last CDN
  runtime dependency.
- **Convert every file to JSX** (`.jsx`) — pure mechanical rewrite, no behavior change; the Phase 0
  smoke tests are the guard rail. Split the two oversized files while touching them:
  `screens-manage.js` (452 lines → `classes/`, `people/`), `calendar.js` (392 lines →
  `calendar/` with grid/modal/theme-panel modules).

### Phase 2 — Routing
- Add **react-router** (data router). Map screens to routes: `/dashboard`, `/calendar`,
  `/classes`, `/people`, `/materials`, `/homework`, `/feedback`, `/profile`, `/login`.
- Auth gate becomes a layout route; sidebar nav becomes `<NavLink>`s. The Worker's
  `single-page-application` fallback already supports this — no backend change.

### Phase 3 — State & data layer
- Replace the single-snapshot context with **TanStack Query**: one query per collection (the
  Worker API is already per-collection), mutations with optimistic updates + invalidation —
  exactly the semantics `store.js` hand-rolls today, minus the whole-app re-render and with
  retries/refetch for free.
- Keep a thin `useStore()`-compatible facade during migration so screens can move one at a time.
- This structurally eliminates the remount-bug class from `CLAUDE.md`: screens subscribe only to
  the collections they read.

### Phase 4 — Real auth (the security fix; backend + frontend)
- Worker: adopt **Hono** for routing/middleware and **zod** for request validation (both are the
  standard, Workers-native picks; the hand-rolled router is at its complexity limit).
- Implement against the existing `accounts`/`sessions` tables: signup/login with **PBKDF2 via
  WebCrypto** (built into Workers), HttpOnly secure session cookie, "remember me" = session TTL,
  invite-code redemption marks the invite used and creates the account, password reset flow.
- **Session middleware on all `/api/*` routes** — closes the open-API hole. This is the one item
  I'd promote to "do immediately after Phase 0" if the app has real users today.
- Frontend `auth.js`: replace the mock `doLogin` with real API calls; session comes from the
  cookie (`GET /api/me`), not `localStorage`.

### Phase 5 — Backend hardening (small, after Hono is in)
- Use `env.DB.batch()` for join-table rewrites and multi-statement deletes (currently sequential
  awaited runs — non-atomic).
- Turn on `PRAGMA foreign_keys` / defined FK behavior instead of manual cleanup where possible.
- Store material files in **R2** (presigned or Worker-proxied upload/download) instead of
  discarding bytes; keep D1 row = metadata + R2 key. Fixes the broken re-download.

### Phase 6 — TypeScript (optional but recommended, incremental)
- `tsconfig` with `allowJs`; convert in dependency order: `lib/` → `store`/queries → worker →
  screens. Put the collection shapes in a **`shared/types.ts` used by both the Worker and the
  client** — the two currently agree by convention only (e.g. `recur` vs `recurrence` already
  drifted between README and worker).

### Explicitly out of scope / don't do
- No framework migration (Next.js, Remix, Astro) — nothing here needs SSR.
- No CSS overhaul — the DS tokens are the binding contract; keep the BEM layer.
- No redesign of `design/` reference files; optionally exclude them from any tooling globs.
- Parent portal stays in the backlog.

### Sequencing & risk summary

| Phase | Risk | Depends on | Ship independently? |
|---|---|---|---|
| 0 Safety net | none | — | yes |
| 1 Module graph + JSX | low (mechanical, test-guarded) | 0 | yes |
| 2 Routing | low | 1 | yes |
| 3 TanStack Query | medium | 1 (2 helpful) | yes, screen-by-screen |
| 4 Real auth | medium (touches every request) | 0; ideally 3 | yes |
| 5 Backend hardening | low | 4 (Hono) | yes |
| 6 TypeScript | low, incremental | 1 | yes, file-by-file |
