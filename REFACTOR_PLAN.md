# Mochi — Tech-Stack Review & Site Refactor Plan

_Reviewed: 2026-07-13. Scope: the whole runnable app (`src/`, `worker/`, build + deploy). The
`design/` prototype is reference material and stays untouched._

_Updated 2026-07-13: decision to **move off the pure-SPA model** to server-side rendering, driven
by the product direction (an IELTS-prep-style platform à la theieltsdictionary.com: public
content/dictionary/test pages that must be crawlable and fast for SEO, plus an interactive
logged-in app). Phases 2–3 now adopt **React Router v7 framework mode (SSR) on Cloudflare
Workers** instead of client-side routing + TanStack Query._

_Also decided: **backend logic lives in the Worker, written in TypeScript from Phase 2 onward**
(not the optional Phase 6 it was). DB access via **Drizzle ORM**; the web app talks to the server
**exclusively through RR7 loaders/actions** — the hand-rolled JSON `/api/*` surface retires. See
"Server architecture" below._

## Server architecture (decided)

```
app/routes/**            RR7 routes — thin: parse request, call service, return
server/services/*.ts     domain logic: auth, invites, events, homework, (later) scoring
server/db/               Drizzle schema (TS = single typed source of truth) + queries
shared/schemas.ts        zod schemas — actions validate with them, client forms and
                         types infer from them (kills client/server shape drift)
```

Logic that must move **out of the frontend** and into `server/`: invite-code generation and
validation (currently mintable in the browser), login/session checks, all write validation,
derived data (badge counts, dashboard aggregation — today computed by shipping the whole DB to the
client). Logic that stays client-side: presentation only — calendar grid layout, drag
interactions, recurrence expansion *for display*, theme. Rule of thumb: trust/scores/persistence →
server; pixels → client.

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

The **core platform choices are good and should stay**: React + Cloudflare Worker + D1. But the
product direction (public, SEO-dependent content pages alongside the interactive app) rules out
staying a pure client-rendered SPA — the rendering model changes (see Phase 2), while the runtime,
database, and design system carry over. Beyond that, the problems are all in *how* the stack is
wired:

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

### Phase 1 — Own the module graph (mechanical, high value — **hard prerequisite for SSR**)

> SSR cannot work with the current wiring: React as a `window` global from unpkg and the DS bundle
> attached to `window.MochiDesignSystem_472b36` only exist in a browser. This phase must land
> before Phase 2.
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

### Phase 2 — React Router v7 framework mode: SSR on the Worker

**Why RR7 over the alternatives:** it server-renders inside the existing Cloudflare Worker with
first-class official CF + D1 support; all current React code and the Mochi DS (a binding React
component contract) carry over unchanged; and route loaders run in the Worker with direct D1
access. Astro would put the interactive app inside one giant React island (a SPA again, plus a
second mental model); Next.js on Cloudflare (OpenNext) is heavier with more Workers friction and
buys nothing here.

- Adopt **React Router v7 framework mode** with `@react-router/cloudflare`; the RR7 server handler
  becomes the Worker entry, with the existing `/api/*` handler mounted alongside during migration.
- The scaffold is **TypeScript** — all new server code (loaders, actions, `server/services`,
  `shared/schemas`) is TS from here on; existing screens stay `.jsx` via `allowJs` and convert
  opportunistically (Phase 6). Run `wrangler types` to type the D1/R2/ASSETS bindings.
- Routes: `/login`, and an authed layout route wrapping `/dashboard`, `/calendar`, `/classes`,
  `/people`, `/materials`, `/homework`, `/feedback`, `/profile`. Sidebar nav becomes `<NavLink>`s.
- **Public/SEO routes** (dictionary entries, articles, test/landing pages as the product grows)
  are server-rendered, or **prerendered at build time** where fully static.
- Authed app routes stay as interactive as today — SSR the shell, hydrate, and keep client-side
  navigation between screens.

### Phase 3 — State & data layer: loaders + actions + Drizzle
- Introduce **Drizzle ORM**: define the existing schema in `server/db/schema.ts` (matching the
  current migrations as baseline), adopt **drizzle-kit** for migrations going forward, and build
  `server/services/*` on typed Drizzle queries — replacing the Worker's string-concatenated SQL.
- Replace the single-snapshot store context with **per-route RR7 loaders** (server-side reads,
  straight from D1 — no client fetch waterfall) and **actions** for mutations with automatic
  revalidation, validated against the `shared/schemas.ts` zod schemas.
- Optimistic UI where it matters (homework check-off, calendar drag-to-reschedule) via
  `useFetcher` — the same semantics `store.js` hand-rolls today, without the whole-app re-render.
- Keep a thin `useStore()`-compatible facade during migration so screens can move one at a time.
- This structurally eliminates the remount-bug class from `CLAUDE.md`: each screen gets only the
  data its route loads.
- As screens migrate, their `/api/*` endpoints retire. **Decided: no long-term JSON API** — the
  web app talks to the server exclusively through loaders/actions. A versioned public API can be
  added later (thin routes over the same `server/services` layer) if a mobile app or integration
  materializes.

### Phase 4 — Real auth (the security fix; backend + frontend)
- Implement against the existing `accounts`/`sessions` tables: signup/login with **PBKDF2 via
  WebCrypto** (built into Workers), HttpOnly secure session cookie (RR7's cookie-session
  utilities), "remember me" = session TTL, invite-code redemption marks the invite used and
  creates the account, password reset flow.
- **Session check in every loader/action** (via the authed layout route) **and on the legacy
  `/api/*` routes until they finish retiring** — closes the open-API hole. This is the one item
  I'd promote to "do immediately after Phase 0" if the app has real users today. Request payloads
  validate against the `shared/schemas.ts` zod schemas in actions.
- Frontend `auth.js`: replace the mock `doLogin` with a login action; unauthenticated users get a
  server-side redirect to `/login` — no client-side auth gate, no user JSON in `localStorage`.

### Phase 5 — Backend hardening (small)
- Use `env.DB.batch()` for join-table rewrites and multi-statement deletes (currently sequential
  awaited runs — non-atomic).
- Turn on `PRAGMA foreign_keys` / defined FK behavior instead of manual cleanup where possible.
- Store material files in **R2** (presigned or Worker-proxied upload/download) instead of
  discarding bytes; keep D1 row = metadata + R2 key. Fixes the broken re-download.

### Phase 6 — TypeScript on the frontend (incremental)
- The backend is TS from Phase 2; this phase is only the remaining `.jsx` screens. Convert
  opportunistically as screens are touched, in dependency order: `lib/` → shared UI → screens.
  Types come from `shared/schemas.ts` (zod inference) — no hand-maintained duplicates.

### Explicitly out of scope / don't do
- No move to Next.js or Astro — React Router v7 covers SSR/prerendering while keeping the existing
  React code and design system (see Phase 2 rationale).
- No CSS overhaul — the DS tokens are the binding contract; keep the BEM layer.
- No redesign of `design/` reference files; optionally exclude them from any tooling globs.
- Parent portal stays in the backlog.

### Sequencing & risk summary

| Phase | Risk | Depends on | Ship independently? |
|---|---|---|---|
| 0 Safety net | none | — | yes |
| 1 Module graph + JSX | low (mechanical, test-guarded) | 0 | yes |
| 2 RR7 framework mode (SSR), TS server | medium (new server entry, hydration) | 1 | yes |
| 3 Loaders/actions + Drizzle data layer | medium | 2 | yes, screen-by-screen |
| 4 Real auth | medium (touches every request) | 0; ideally 2–3 | yes |
| 5 Backend hardening | low | 4 | yes |
| 6 TypeScript frontend | low, incremental | 2 | yes, file-by-file |
