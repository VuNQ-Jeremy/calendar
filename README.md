# Mochi

A learning-management app for a small language school in Vietnam — calendar and
attendance, classes and people, tuition, assessments and report cards, vocabulary
study, and a read-only portal for parents. Two clients (a server-rendered web app
and a native Android app) share one backend, one set of domain services, and one
set of Zod contracts.

Fully bilingual, English and Tiếng Việt. Every user-facing string goes through
`t(key)` with entries in both languages — see [shared/i18n/strings.ts](shared/i18n/strings.ts).

---

## Stack

| Layer | What |
|---|---|
| Web | React Router **v8** framework mode (SSR), React 19, Vite 7 |
| Runtime | Cloudflare Workers — [workers/app.ts](workers/app.ts) is the SSR entry |
| Data | D1 (`mochi-class`) via Drizzle; hand-written SQL migrations |
| Files | R2 (`mochi-files`) — material uploads, share-card images, vocabulary pictures |
| Realtime | Durable Objects — `LIVE_HUB` (cache invalidation over WebSocket), `TRANSLATE_DO`, `ZALO_POLLER` |
| AI | Anthropic SDK (vocabulary generation, enrichment), Workers AI `flux-1-schnell` (word illustrations), Azure Speech (pronunciation scoring) |
| Mobile | Expo / React Native, Android only, distributed as an APK link + EAS OTA updates |
| Tests | Vitest (jsdom + Workers pool), Playwright e2e against an isolated staging env |

There is **no `index.html`** and no client-side store — data moves through React
Router loaders and actions on the web, and through the JSON API on mobile.

## Quick start

```bash
npm install
npm run db:migrate:local     # apply migrations to the local D1
npm run db:seed:local        # demo data (optional)
npm run dev                  # react-router dev
```

Static checks, all cheap and safe to run any time:

```bash
npm run typecheck     # react-router typegen && tsc --noEmit
npm run lint          # oxlint
npm run check:i18n    # every t() key exists in both en and vi
npm run format
```

Deploy: `npm run deploy` (build + `wrangler deploy`). One-time provisioning —
`npx wrangler d1 create mochi-class`, `npx wrangler r2 bucket create mochi-files`,
then `npm run db:migrate`.

## Repo layout

```
app/routes.ts          explicit route config (not file-based) — 118 route files
app/routes/*.tsx       thin: a loader, an action, a re-export of a screen from src/
app/root.tsx           the whole document head

src/                   all web UI — screens, the calendar, flashcards, garden,
                       assessments, tuition, kiosk, parent portal
src/ds/                the Mochi Design System: a generated bundle.js + CSS token
                       layers. Do not hand-edit bundle.js.
src/lib/               i18n, the client route cache, live updates, tracking

server/services/*.ts   43 modules of domain logic, all plain (db, …) functions.
                       Both clients go through here; nothing lives in route files.
server/db/schema.ts    Drizzle schema — the single source of truth
server/api/            bearer-token auth + the JSON API handler wrapper

shared/                code both clients import: schemas.ts (Zod contracts),
                       i18n/strings.ts, tokens.ts, logic/ (pure domain rules),
                       version.ts
workers/               app.ts (SSR + cron), live-hub.ts, translate-proxy.ts,
                       zalo-poller.ts
migrations/            hand-written SQL, applied with wrangler d1 migrations apply
mobile/                the Expo Android client (its own npm project)
e2e/                   37 Playwright specs, one per feature area
design/                the original design handoff + HTML prototype
```

`worker/index.js` (singular) is a dead stub kept only for `wrangler.test.jsonc`.

## The two clients

**Web** — server-rendered, cookie session (`__mochi_session`), loaders and actions.
Client-side caching and invalidation live in [src/lib/cache.ts](src/lib/cache.ts)
and [src/lib/route-cache.ts](src/lib/route-cache.ts).

**Mobile** — Expo/Android, talks to the JSON API at `/api/*` with
`Authorization: Bearer <token>`. Envelope, error codes, and every endpoint are in
[docs/api.md](docs/api.md); running and building it is in
[mobile/README.md](mobile/README.md).

The two never drift because both call the same `server/services/*.ts` functions and
validate with the same `shared/schemas.ts` schemas.

## Roles

`Staff` (Teacher / Admin / Assistant), `Student`, and `Parent`. People are onboarded
with one-time invite codes (`XXX-XXX`) minted when the person is added — redeeming a
code attaches a login to that existing row rather than creating a second one.

The **parent portal** (`/children`) is off by default and opens per school from
System Config → Parent access. It is gated twice: the nav item is hidden and the
path itself is refused in [app/routes/_app.tsx](app/routes/_app.tsx).

Parents are also reached over **Zalo** — a bot channel for attendance cards, session
previews and fee slips. See [docs/zalo.md](docs/zalo.md).

## Versioning and release

Version is `v{major}.{build}`. **The build number is derived from the git commit
count and is never stored** — that is what keeps parallel work from several machines
from conflicting on a counter. `shared/version.json` holds only `major`,
`buildOffset`, and `runtimeVersion`.

Every push to `main` adds a [CHANGELOG.md](CHANGELOG.md) entry:

```bash
node scripts/changelog.mjs "1-2 line summary"
```

`runtimeVersion` is **not** the app version — it gates Expo OTA updates and is
bumped by hand only when native dependencies change.

A git push alone does not reach phones. The EAS workflow
`mobile/.eas/workflows/publish-preview-update.yml` runs `eas update` on push;
verify it with `cd mobile && npx eas-cli workflow:runs`. Manual fallback:

```bash
cd mobile && npx eas-cli update --branch preview --platform android \
  --environment preview --message "…"
```

Never drop `--environment preview` — it supplies `EXPO_PUBLIC_API_URL`.

## Tests

```bash
npm test                  # vitest (jsdom) + vitest (Workers pool)
npm run test:e2e:staging  # reset calendar-test to seed data, run all 37 specs (~4 min)
```

The e2e suite runs against an isolated test environment, never production — CRUD
specs skip unless `E2E_BASE_URL` contains `calendar-test`. Every feature, mutation
intent, and data object ships with a spec in the same commit; the suite's contract
is that every write path is exercised end to end through the real dialogs. Shared
locators and the app's UI contract live in [e2e/crud-helpers.ts](e2e/crud-helpers.ts).

Test accounts: staff `dev@mochi.edu`, student `vunq@mochi.edu` (both `mochi123`).

## Docs

| For | Read |
|---|---|
| Project rules and conventions | [CLAUDE.md](CLAUDE.md) |
| The JSON API | [docs/api.md](docs/api.md) |
| The mobile app | [mobile/README.md](mobile/README.md), [docs/mobile/](docs/mobile/) |
| How the app got here | [docs/refactor/](docs/refactor/) |
| The Zalo parent channel | [docs/zalo.md](docs/zalo.md) |
| Original design intent | [design/README.md](design/README.md) |
| What's next | [BACKLOG.md](BACKLOG.md) |

**Stale — do not trust:** [APP.md](APP.md) and [BACKEND.md](BACKEND.md) describe
architectures that no longer exist (a Vite SPA with `localStorage`, and a deleted
`/api/state` Worker). Both carry banners saying so. The code, `CLAUDE.md`, and
`docs/` are what reflect reality.
