# Mochi Mobile — execution guide

This directory turns "I want a mobile app" into executable, per-phase task files. Each phase
is designed to be run by an engineer or AI agent **in a fresh session with no other context**:
read this file first, then the phase file, then execute top-to-bottom.

Modelled on the existing `docs/refactor/` convention in the repo.

---

## The goal

A **native Android app** for Mochi at **full feature parity** with the web app, installed from
a **download link** (no Play Store), with **offline flashcard study** and **push
notifications**. The existing web app keeps working, unchanged.

## Decided architecture (do not relitigate)

These were settled with the operator before planning. Do not re-open them.

| Decision | Choice | Why |
|---|---|---|
| Technology | **Expo / React Native** (not PWA, not Capacitor) | Real native feel, real push, full native capability |
| Platforms | **Android only** | The user base is Vietnam, Android-heavy. iOS would force a $99/yr Apple account and TestFlight, which breaks the "just a link" requirement |
| Distribution | **EAS Build → APK download URL**, plus **EAS Update** for OTA JS updates | No store, no fees, no review. Install once, update over the air |
| Repo | **One repo, two npm projects, one `shared/` dir.** *Not* npm workspaces | Metro fights hoisted workspace `node_modules`; the web toolchain here is already fragile |
| API | **New `/api/*` JSON resource routes alongside the existing loaders. Web is untouched** | Zero regression risk on a working app |
| Scope | Full parity, all 13 screens | Operator's explicit call |
| Build order | Auth + shell + navigation first | Operator's explicit call |

**Versioning** (established in Phase 0): one shared version for the whole repo,
`v{major}.{build}` — e.g. `v0.0042`. **`build` is derived from `git rev-list --count HEAD`**, so
every clone on every machine computes the same number for the same commit and nothing ever
conflicts. **`major` is stored** in `shared/version.json` and bumped by hand at milestones only.
Every push to `main` adds a 1–2 line entry to `CHANGELOG.md` via
`node scripts/changelog.mjs "…"`. `runtimeVersion` is a **separate** manually-bumped number —
never tie it to the build, or every OTA update orphans every installed APK.

**Non-negotiables carried over from the web app:**

- **i18n is mandatory.** Every user-facing string goes through `t(key)` with entries in **both**
  `en` and `vi`. Never hardcode UI copy. The app is used by Vietnamese speakers; **default to
  `vi` on mobile.**
- **The Mochi Design System is a binding contract.** Same color tokens, same type scale, same
  spacing. Mobile may use different *components* (a bottom tab bar has no web equivalent) but
  never different *tokens*. No new colors, ever.
- **Domain logic lives in `server/services/*.ts`**, never in route files and never duplicated
  into the mobile client. The API is glue only.
- **`shared/schemas.ts` is the single source of truth** for request validation on both clients.

---

## Phase order and dependencies

| # | File | Depends on | Summary |
|---|---|---|---|
| 0 | [phase-0-shared-extraction.md](./phase-0-shared-extraction.md) | — | **Versioning + changelog**, then extract i18n strings, color tokens, and pure logic into `shared/` |
| 1 | [phase-1-json-api.md](./phase-1-json-api.md) | 0 | Bearer-token auth, migration `0014`, `server/api/` helpers, ~30 `/api/*` resource routes, Workers tests |
| 2 | [phase-2-expo-shell.md](./phase-2-expo-shell.md) | 1 | The `mobile/` Expo project: API client, secure token storage, theming, i18n, role-aware navigation, Login + Profile. **First APK.** |
| 3 | [phase-3-flashcards-offline.md](./phase-3-flashcards-offline.md) | 2 | All flashcard screens, the three games, the Reanimated swipe port, offline study + sync outbox |
| 4 | [phase-4-staff-core.md](./phase-4-staff-core.md) | 2 | Dashboard, Calendar (agenda-first), Event detail, Classes, Homework, Attendance |
| 5 | [phase-5-staff-remaining.md](./phase-5-staff-remaining.md) | 4 | People, Materials, Assessments, Config, Feedback |
| 6 | [phase-6-push-notifications.md](./phase-6-push-notifications.md) | 2 (3 & 4 for content) | Expo push registration, Cron Triggers, notification preferences |

**[TESTING.md](./TESTING.md)** — the operator's hands-on verification guide for each phase: exact commands,
what to click, and what a failure looks like. Read it alongside each phase's acceptance criteria.

Run phases **in order**. Do not start a phase until the previous phase's acceptance criteria
all pass on `main`.

**Natural stopping point:** Phases 0–3 produce a complete, shippable *student* app. Phases 4–5
are the bulk of the work (roughly 13k LOC of UI rebuilt). Reassess after Phase 3 before
committing to full parity.

---

## Repo orientation (state before Phase 0)

Read this before touching anything. Several checked-in docs are **stale and actively
misleading**.

**Stack:** React Router **v8** framework mode (SSR) + React 19.2 on **Cloudflare Workers**.
Vite 7. Tailwind v4 is present but essentially vestigial. TypeScript throughout.

**Key paths:**

- `app/routes.ts` — explicit route config (not file-based). 13 app routes inside
  `layout('routes/_app.tsx', …)`, plus `login`, `logout`, and 5 resource routes outside it.
- `app/routes/*.tsx` — thin: a loader, an action, and a re-export of a screen from `src/`.
- `app/root.tsx` — 45 lines. The whole document head. **There is no `index.html`.**
- `src/` — all UI. ~13k LOC. Biggest: `src/lib/i18n.tsx` (1186),
  `src/screens-manage/people.tsx` (1049), `src/screens-extra.tsx` (969),
  `src/flashcards/topic.tsx` (856).
- `src/ds/` — a **generated, pre-compiled** design-system bundle (`bundle.js`, 365 lines)
  exporting 11 primitives, plus 7 CSS token layers. Do not hand-edit `bundle.js`.
- `server/services/*.ts` — 20 modules, all plain `(db, …)` functions. **This is the seam the
  API plugs into.**
- `server/db/schema.ts` — 371 lines, Drizzle, the single schema source of truth.
- `shared/schemas.ts` — 295 lines of Zod v4 contracts + a custom `parsePatch()`.
- `migrations/0001…0012_*.sql` — hand-written SQL, applied with `wrangler d1 migrations apply`.
- `workers/app.ts` — the SSR entry. `workers/translate-proxy.ts` — the `TranslateProxy`
  Durable Object.
- `worker/index.js` (singular) — a **dead 7-line stub**, kept only for `wrangler.test.jsonc`.

**Bindings** (`wrangler.jsonc`): `DB` = D1 `mochi-class`, `FILES` = R2 `mochi-files`,
`TRANSLATE_DO` = Durable Object, secret `ANTHROPIC_API_KEY`.

**Stale docs — do not trust:**
- `APP.md` describes a Vite SPA with `index.html`, UMD React globals, and `src/store.js` +
  localStorage. **None of that exists anymore.**
- `BACKEND.md` documents a `/api/state` Worker that was deleted in refactor phase 3, and
  quotes 210 000 PBKDF2 iterations (the real number is 100 000 — workerd's hard cap).
- `README.md` is the original design handoff, not current state.
- The comment at the top of `wrangler.jsonc` mentions "a legacy JSON API at `/api/*`" that no
  longer exists. Phase 1 makes it true again — update the comment then.

Only `CLAUDE.md`, the code itself, and `docs/refactor/phase-*.md` reflect reality.

---

## How the app actually works today

**Auth** is roll-your-own email + password with server-side session rows. No OAuth, no JWT.

- Cookie `__mochi_session` — `httpOnly`, `secure`, `sameSite: 'lax'` (`server/session.ts`).
- PBKDF2-SHA256, 100 000 iterations, format `pbkdf2$iters$salt$hash`
  (`server/services/crypto.ts`).
- `sessions.token` is the **PRIMARY KEY** and stores the **SHA-256 hash** of the raw token.
  The raw token only ever lives in the client cookie.
- Guards: `requireUser` / `requireStaff` / `requireAdmin` in `server/services/auth.ts`.
  The first two **throw `redirect(...)`** — this is the single most important thing Phase 1
  has to change for API callers.
- Signup is **invite-code only** (`invites` table, `XXX-XXX` codes).
- Three user kinds: **staff** (`Teacher`/`Admin`/`Assistant`), **student**, **parent**.
  `getUser` returns `null` for parents — *parent accounts remain unsupported*. Do not build
  for them.
- **Students only ever see `/flashcards` and `/profile`.** `requireStaff` redirects them to
  `/flashcards`. Mirror this exactly on mobile.

**Mutations** are all `FormData` + an `intent` discriminator. Every action starts with
`await request.formData()` and switches on `intent` (`create` / `update` / `delete` /
`save-grades` / `record-result` / `theme` / `ui-prefs` / …). The API replaces this with JSON
bodies and HTTP verbs, but calls the identical service functions underneath.

**Client cache** (`src/lib/cache.ts`, 41 lines) is a module-scoped `Map` + subscriber sets.
Page routes use cache-first `clientLoader`/`clientAction`; modals use
`useCachedLoad(key, url)`. Keys: `route:{name}`, `att:{eventId}:{date}`, `evmat:{eventId}`,
`hw:modal`. Invalidation is coarse — most `clientAction`s do `invalidate('route:')`.
**Mobile does not port this** — it uses React Query, mirroring the same key/invalidation map.

---

## Environment (read before debugging anything)

**First, find out which situation you are in:**

```bash
npm run dev
```

### If `npm run dev` works — the normal path

You have the standard loop: local dev server, and local D1 via
`npm run db:migrate:local` + `npm run db:seed:local`. Use it. Most of the deploy-oriented
advice below is then unnecessary — build and deploy only when you actually want to test on a
real device or share a build.

For mobile work you still need the phone to reach the API. Either point
`EXPO_PUBLIC_API_URL` at a deployed Worker, or bind the local dev server to your LAN IP and
use `http://<your-lan-ip>:5173`. `localhost` on the phone means the phone.

### If `npm run dev` crashes — the known-bad path

**workerd (the Cloudflare Workers runtime) crashes with an access violation on at least one
Windows machine used for this project** (observed 2026-07-23, wrangler 4.110; it is the binary,
not the repo path). Where that happens:

- `npm run dev`, `vite preview`, and `wrangler d1 … --local` all fail. There is **no local D1**.
- The working loop becomes **`npm run build && npm run deploy`**, testing against the deployed
  Worker. The remote DB holds the demo seed (`seed.sql`). Registration is invite-only.
- A **Node fallback harness** exists: a repo copy plus a `node-host.mjs` that runs the
  production server build under plain Node, with D1 shimmed onto `node:sqlite` and R2 shimmed
  to a local directory. Start it with `node --import ./cf-shim.mjs node-host.mjs` — the shim
  stubs `DurableObject`, which the build imports from `cloudflare:workers`. `better-sqlite3`
  does not compile there; `node:sqlite` does. Ask the operator for its location; it lives
  outside the repo.
- `npm run test:worker` uses workerd internally and therefore **also fails** — confirmed
  2026-07-27: `MiniflareCoreError [ERR_RUNTIME_FAILURE]`. **Phase 1 has no local feedback loop
  on such a machine**; API verification is deploy-and-curl only. `npx vitest run` (the jsdom
  suite) works fine.

### Regardless of machine

- **Deployment target:** the Cloudflare Worker named `calendar` (see `wrangler.jsonc`). Ask the
  operator for the deployed URL and account; it is not recorded here.
- **Stale-bundle gotcha:** after a deploy, an open web tab keeps running the pre-deploy JS until
  a hard refresh. "Bug still happening" right after a deploy is often just an old tab. The
  mobile equivalent is a stale OTA bundle — force-close the app.
- **Deployed client chunks are publicly fetchable** (`/assets/manifest-*.js` lists the chunks) —
  useful for confirming what is actually live.
- **Anthropic egress is region-pinned.** Cloudflare serves this Worker from Hong Kong for
  Vietnamese traffic, and Anthropic 403s HKG egress. That is the entire reason
  `workers/translate-proxy.ts` + the `TRANSLATE_DO` Durable Object exist. **Any feature calling
  Anthropic must route through that DO, never direct.**

---

## Ground rules for the executor

1. **Never touch `design/`.** It is a frozen reference prototype. Never hand-edit
   `src/ds/bundle.js` — it is generated output.
2. **Zero web regression is the bar for Phases 0 and 1.** After each, the web app must look and
   behave identically. Phase 1 adds routes; it changes nothing existing.
3. **Verify constantly.** After every task group: `npm run lint && npm run typecheck &&
   npm run test`. Before finishing a phase, deploy and click through the web app:
   login → dashboard → calendar (create + drag an event) → classes → people → materials →
   homework (check one off) → flashcards (play one game) → profile.
4. **The remount lesson** (from `CLAUDE.md`): never create a component function inside a render
   path. `React.createElement(() => <Child />, …)` with a fresh arrow each render unmounts and
   remounts the whole subtree, wiping local state. When a component remounts mysteriously,
   look **up** the tree first. This applies equally in React Native.
5. **Git:** commit and push to **`main` only**. No feature branches — this is a standing project
   instruction in `CLAUDE.md`. Small commits, one logical step each, imperative subject. Push
   automatically when a task is finished.
6. **New data features must read through the cache layer** — a `route:` key on web, a React
   Query key on mobile. Do not add a third caching mechanism.
7. **When a library's exact API doesn't match this spec** (versions move — Expo especially),
   prefer the library's current official docs over the snippet here, but keep the spec's
   *intent* and acceptance criteria. Note the deviation in the commit message.
8. **Don't build for parent accounts.** They are explicitly unsupported.

---

## Definition of done (every phase)

- All acceptance criteria in the phase file pass.
- `npm run lint`, `npm run typecheck`, `npm run test` all green.
- Deployed to `https://calendar.ngqv0712.workers.dev` and manually clicked through (rule 3)
  with no regression.
- From Phase 2 on: the change is verified **on a physical Android device**, not just a
  simulator.
- Committed and pushed to `main`.
