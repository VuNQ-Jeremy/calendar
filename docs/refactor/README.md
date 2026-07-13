# Mochi refactor — execution guide

This directory turns [`REFACTOR_PLAN.md`](../../REFACTOR_PLAN.md) (the *why*) into executable,
per-phase task files (the *how*). Each phase is designed to be run by an engineer or AI agent in a
fresh session with no other context: **read this file first, then the phase file, then execute
top-to-bottom.**

## Decided architecture (do not relitigate)

- **Rendering:** React Router v7 framework mode (SSR) running in the Cloudflare Worker. No pure
  SPA. Public/SEO pages server-rendered or prerendered; authed app hydrates and stays interactive.
- **Backend:** TypeScript from Phase 2 onward. Domain logic in `server/services/*.ts`, never in
  components. DB access via **Drizzle ORM**. Request validation via **zod** schemas in
  `shared/schemas.ts` (single source of truth for client + server types).
- **Server surface:** RR7 loaders/actions only. The hand-rolled JSON `/api/*` retires as screens
  migrate. No long-term public API.
- **Platform:** Cloudflare Workers + D1 (binding `DB`, database `mochi-class`) + R2 (Phase 5).
- **Visuals:** the Mochi Design System is a **binding contract** — same component names, same
  props, same tokens. No new colors, fonts, spacing, or component variants. Ever.

## Phase order and dependencies

| # | File | Depends on | Summary |
|---|---|---|---|
| 0 | `phase-0-safety-net.md` | — | oxlint, Prettier, Vitest (client + Workers), CI |
| 1 | `phase-1-module-graph.md` | 0 | React from npm, DS as ES modules, self-hosted fonts, JSX conversion, file splits |
| 2 | `phase-2-react-router-ssr.md` | 1 | RR7 framework mode on the Worker, real routes, SSR |
| 3 | `phase-3-data-layer.md` | 2 | Drizzle schema, services, loaders/actions per screen, retire `/api/*` and the client store |
| 4 | `phase-4-auth.md` | 3 (partial ok) | Real accounts/sessions, PBKDF2, cookie sessions, invite redemption, reset flow |
| 5 | `phase-5-hardening-r2.md` | 4 | `db.batch`, FK verification, R2 file storage for materials |
| 6 | `phase-6-typescript-frontend.md` | 2 | Convert remaining `.jsx` screens to TS, strict mode, CI typecheck |

Run phases **in order**. Do not start a phase until the previous phase's acceptance criteria all
pass on the target branch.

## Ground rules for the executor

1. **Never touch `design/`.** It is a frozen reference prototype. Also never edit files under
   `public/_ds/` except to delete the directory when Phase 1 says so.
2. **Zero visual change** is the bar for Phases 0–3. After each phase, the app must look and
   behave pixel-identically (Phase 2 adds URLs; Phase 4 changes the auth screens' behavior but
   not their look).
3. **Verify constantly.** After every task group, run: `npm run lint && npm test && npm run build`.
   Before finishing a phase, launch the app (`npm run cf:dev` before Phase 2, `npm run dev` after)
   and click through: login → dashboard → calendar (create/drag an event) → classes → people →
   materials → homework (check one off) → profile.
4. **i18n is mandatory.** Every user-facing string goes through `t(key)` from `src/lib/i18n.js`
   with entries in **both** `en` and `vi` in the `STRINGS` dictionary. New screens (login rewrite,
   errors) included. Never hardcode UI copy.
5. **The remount lesson** (from `CLAUDE.md`): never create a component function inside a render
   path. Pass elements, not freshly-created component types.
6. **Commits:** small, one logical step each, imperative subject. One branch/PR per phase unless
   the operator instructs otherwise.
7. **Don't reintroduce features removed by design review:** global top search bar, notifications,
   topbar avatar, separate system-settings page.
8. **When a doc's exact library API doesn't match reality** (versions move), prefer the library's
   current official docs/template over this spec's snippet — but keep the spec's *intent* and
   acceptance criteria. Note the deviation in the PR description.

## Repo orientation (state before Phase 0)

- `index.html` — loads React 18.3.1 + ReactDOM as **UMD globals from unpkg**, the DS bundle
  (attaches to `window.MochiDesignSystem_472b36`), Google Fonts, then `/src/main.js`.
- `src/*.js` — React app written **without JSX** (raw `React.createElement`), importing React and
  the DS from `src/lib/globals.js` (which re-exports the `window` globals).
- `src/store.js` — one React context; loads `GET /api/state` (whole DB) on mount; optimistic
  mutations against `/api/*`.
- `worker/index.js` — hand-rolled router + string-built SQL over D1. **No auth anywhere.**
- `migrations/000{1,2,3}_*.sql` — D1 schema incl. unused `accounts`/`sessions` tables.
- `wrangler.jsonc` — Worker `calendar`, D1 binding `DB`, serves `dist/` as static assets.
- `.github/workflows/deploy.yml` — deploy to Cloudflare on push to `main`.
- No tests, no linter, no TypeScript.

## Definition of done (every phase)

- All acceptance criteria in the phase file pass.
- `npm run lint`, `npm test`, `npm run build` all green.
- Manual click-through (rule 3) shows no regression.
- CI green on the phase branch.
- PR description lists: what changed, any deviations from the spec (rule 8), and the verification
  evidence (test output, screenshots if visuals were at risk).
