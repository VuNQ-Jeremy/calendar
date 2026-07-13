# Phase 2 — React Router v7 framework mode: SSR on the Worker

**Goal:** the app stops being a SPA. RR7's server handler becomes the Worker entry; every screen
gets a real URL and server-renders; the legacy `/api/*` handler keeps working during migration.
TypeScript starts here: **all new files in this phase are `.ts`/`.tsx`.**

**Do not invent the config.** Generate the official Cloudflare template into a scratch directory
and copy its wiring:

```bash
npm create cloudflare@latest mochi-rr7-scratch -- --framework=react-router --no-deploy --no-git
```

(or the equivalent `react-router-templates/cloudflare` template). Diff its `vite.config.ts`,
`react-router.config.ts`, `workers/app.ts`, `wrangler` config, `tsconfig`, and `package.json`
scripts against this repo and port them. Where this spec and the template disagree, the template
wins (README rule 8).

---

## Task 1 — Install and wire the framework

1. `npm i react-router` and `npm i -D @react-router/dev @cloudflare/vite-plugin typescript vite-tsconfig-paths` (match template versions).
2. `react-router.config.ts`:
   ```ts
   import type { Config } from '@react-router/dev/config';
   export default { ssr: true } satisfies Config;
   ```
3. `vite.config.ts` (replaces `vite.config.js`): plugins `[cloudflare({ viteEnvironment: { name: 'ssr' } }), reactRouter(), tsconfigPaths()]`
   per the template. Delete the old `/api` proxy — with the Cloudflare Vite plugin, `npm run dev`
   runs the *actual Worker* with local D1 bindings; no proxy needed.
4. `wrangler.jsonc` changes (keep the D1 binding and `migrations_dir` exactly as-is):
   - `"main": "./workers/app.ts"`
   - assets: per template (client build output, no `single-page-application` fallback — RR7 owns
     routing/404s).
5. `workers/app.ts` — Worker entry: legacy API first, then RR7:
   ```ts
   import { createRequestHandler } from 'react-router';
   import { handleApi } from '../worker/api'; // see Task 2

   const requestHandler = createRequestHandler(
     () => import('virtual:react-router/server-build'),
     import.meta.env.MODE,
   );

   export default {
     async fetch(request, env, ctx) {
       const url = new URL(request.url);
       if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
       return requestHandler(request, { cloudflare: { env, ctx } });
     },
   } satisfies ExportedHandler<Env>;
   ```
6. Refactor `worker/index.js` → `worker/api.ts`: export the existing `handleApi(request, env,
   url)` (it already exists as an inner function); delete the old default export. Rename the file
   and add minimal types (`env: Env`); logic unchanged. Run `wrangler types` to generate `Env`
   (script: `"cf-typegen": "wrangler types"`).
7. `tsconfig.json` from the template, plus `"allowJs": true` (the screens are still `.jsx`) and
   include for `app/`, `workers/`, `worker/`, `src/`.
8. Scripts: `"dev": "react-router dev"` (or `vite dev` per template), `"build": "react-router
   build"`, `"preview": "vite preview"`, `"deploy": "npm run build && wrangler deploy"`,
   `"typecheck": "react-router typegen && tsc --noEmit"`. Delete `cf:dev` (plain `dev` now serves
   Worker + D1 + SSR together). Update `.github/workflows/deploy.yml` and `ci.yml`
   (add `npm run typecheck`).

## Task 2 — Root, routes, and screen mapping

1. `app/root.tsx` — the document shell. Imports (order matters for cascade parity):
   DS styles, fontsource weights, `src/styles/app.css`. Renders `<Layout>` with `<Meta/>`,
   `<Links/>`, `<ScrollRestoration/>`, `<Scripts/>`, and wraps `<Outlet/>` in `LanguageProvider`
   and (for now) `StoreProvider`. Move the `<title>` and viewport/charset meta here; delete
   `index.html` and `src/main.jsx` once everything renders.
2. `app/routes.ts`:
   ```ts
   import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';
   export default [
     route('login', 'routes/login.tsx'),
     layout('routes/_app.tsx', [
       index('routes/home.tsx'),                    // redirect → /dashboard
       route('dashboard', 'routes/dashboard.tsx'),
       route('calendar', 'routes/calendar.tsx'),
       route('classes', 'routes/classes.tsx'),
       route('people', 'routes/people.tsx'),
       route('materials', 'routes/materials.tsx'),
       route('homework', 'routes/homework.tsx'),
       route('feedback', 'routes/feedback.tsx'),
       route('profile', 'routes/profile.tsx'),
     ]),
   ] satisfies RouteConfig;
   ```
   Note: the old internal id for People was `students`; the URL is `/people` — update the nav
   mapping accordingly.
3. `routes/_app.tsx` — the authed layout: renders the existing `Sidebar` + `<Outlet/>` (extract
   the shell chrome from `src/shell.jsx`; the per-screen switch in `AppShell` dies — routing
   replaces it). Port the shell pieces:
   - `active` state → `useLocation()`; nav buttons → `<NavLink to="/calendar">…` (keep the exact
     class names; add `is-active` via the NavLink `className` callback).
   - The feedback modal + intro modal state stays local to this layout.
   - The `TWEAKS` CSS-variable style object moves here unchanged.
4. Each `routes/*.tsx` is thin for now — it default-exports the existing screen:
   ```tsx
   import { CalendarScreen } from '../../src/calendar';
   export default function Calendar() { return <CalendarScreen />; }
   ```
   Loaders/actions arrive in Phase 3. Screens keep reading the client `StoreProvider`.
5. **Auth gate (still mocked this phase):** `_app.tsx` reproduces today's behavior — if no session
   in `localStorage`, render `AuthScreen` (client-only; see SSR guards below) instead of the
   outlet. `routes/login.tsx` can simply redirect to `/` for now; the real split happens in
   Phase 4. Behavior parity, not improvement, is the goal.

## Task 3 — SSR-proof the client code

The server render will crash on any module-scope or render-path browser API. Audit and fix:

1. `grep -rn "localStorage\|sessionStorage" src/ app/` — every hit must be inside `useEffect`, an
   event handler, or guarded `typeof window !== 'undefined'`. Known offenders: session read in
   the old `main.jsx` `useState` initializer (moves to `_app.tsx` — initialize `null`, hydrate in
   `useEffect`), `SEEN_INTRO_KEY` in `shell.jsx` (already in `useEffect` — verify),
   language persistence in `lib/i18n.js`.
2. `grep -rn "window\.\|document\." src/` — drag handlers and outside-click listeners are
   event/effect-scoped (fine); anything at module scope must be lazy.
3. `src/lib/core.js` `TODAY` is computed at module scope with `new Date()` — fine (no browser
   API), but note it's evaluated once per server isolate; screens already re-derive display dates
   from it. Leave as-is this phase.
4. Hydration check: run `npm run dev`, open each screen with devtools console — **zero hydration
   mismatch warnings allowed.** Common source: date formatting differing between server and
   client locale. If a mismatch appears in the "now" line of the calendar time grid, render that
   marker client-only (mount-gated `useEffect` state).

## Task 4 — Tests and cleanup

1. Screen smoke tests keep working at component level (they render screens directly under
   providers — unaffected by routing). Add route-level tests with `createRoutesStub` from
   `react-router` for `_app.tsx` (renders sidebar + outlet).
2. Delete: `index.html`, `src/main.jsx`, `src/shell.jsx` (superseded by `_app.tsx` — port, then
   delete), old `vite.config.js`.
3. `npm run build && npx wrangler deploy --dry-run` must succeed.

---

## Acceptance criteria

- [ ] `curl -s localhost:<port>/calendar | grep -c 'sb__item'` > 0 — the sidebar is in the **server
      HTML** (view-source, not devtools).
- [ ] Every screen has a URL; deep-refresh on each URL renders that screen; browser back/forward
      work; the sidebar marks the active route.
- [ ] `/api/state` still answers (legacy handler intact) and screens still show data.
- [ ] Zero hydration warnings in the console on all 9 routes.
- [ ] `npm run typecheck`, lint, both test suites, build, and `wrangler deploy --dry-run` green.
- [ ] Manual click-through incl. login-gate parity ("remember me" persists across reload; logout
      returns to the auth screen).
- [ ] CI + deploy workflows updated and green.
