# Phase 0 — Safety net (lint, format, tests, CI)

**Goal:** every later phase is a large mechanical rewrite; this phase builds the net that catches
regressions. No app code changes except where explicitly listed (one export, test-only shims).

---

## Task 1 — oxlint

1. `npm i -D oxlint`
2. Create `.oxlintrc.json` at repo root:
   ```json
   {
     "$schema": "./node_modules/oxlint/configuration_schema.json",
     "categories": { "correctness": "error", "suspicious": "warn" },
     "ignorePatterns": ["design/**", "public/**", "dist/**", "node_modules/**"]
   }
   ```
3. Add script: `"lint": "oxlint src worker"`.
4. Run it. Fix only *actual* findings (unused vars, shadowing). Do not restyle code. If a rule
   fights the codebase's established `React.createElement` style, disable that single rule in the
   config rather than editing many files.

## Task 2 — Prettier

1. `npm i -D prettier`
2. `.prettierrc`: `{ "singleQuote": true, "printWidth": 100 }`
3. `.prettierignore`: `design/`, `public/`, `dist/`, `package-lock.json`, `*.md`
4. Add scripts: `"format": "prettier --write ."` and `"format:check": "prettier --check ."`.
5. Run `npm run format` once, commit the result **as its own commit** ("Apply prettier") so later
   diffs stay readable.

## Task 3 — Client-side tests (Vitest + Testing Library)

The app currently reads React and the DS from `window` (see `src/lib/globals.js`), and the store
fetches `/api/state` on mount. Tests must shim both.

1. `npm i -D vitest jsdom @testing-library/react @testing-library/jest-dom`
2. `vitest.config.js` at root:
   ```js
   import { defineConfig } from 'vitest/config';
   export default defineConfig({
     test: {
       environment: 'jsdom',
       setupFiles: ['./test/setup.js'],
       include: ['test/**/*.test.js'],
     },
   });
   ```
3. `test/setup.js` — install the globals **before** any app module loads, then stub fetch:
   ```js
   import React from 'react';
   import ReactDOM from 'react-dom';
   import '@testing-library/jest-dom/vitest';
   import { vi, beforeEach } from 'vitest';

   window.React = React;
   window.ReactDOM = ReactDOM;
   // Load the DS bundle (an IIFE that reads window.React and attaches
   // window.MochiDesignSystem_472b36). Must come after the globals above.
   await import('../public/_ds/mochi-design-system-472b365a-31b5-44c2-8b48-4d5ab7945e52/_ds_bundle.js');

   export const EMPTY_STATE = {
     classes: [], students: [], users: [], parents: [], events: [],
     homework: [], materials: [], invites: [], feedback: [],
     theme: { bg: '#FFFCF8', gridLine: '#ECE0CF', today: '#FFE7D1', header: '#FDF6EC', bgImage: '', bgOpacity: 0.12 },
   };

   beforeEach(() => {
     vi.stubGlobal('fetch', vi.fn(async (url) => ({
       ok: true,
       json: async () => (String(url).endsWith('/state') ? EMPTY_STATE : {}),
     })));
   });
   ```
   Note: `_ds_bundle.js` populates `window.MochiDesignSystem_472b36` even for errors it swallows —
   after the import, assert in setup that `window.MochiDesignSystem_472b36.Button` exists and
   throw otherwise (fail fast, clearly).
4. **Unit tests** — `test/core.test.js` against `src/lib/core.js`:
   - `iso(new Date(2026, 0, 5))` → `'2026-01-05'` (zero-padding).
   - `addDays` crosses month/year boundaries correctly.
   - `makeCode()` matches `/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/` (no `I`, `O`, `0`, `1`)
     across 200 iterations.
   - `colorOf('nonexistent')` falls back to the first palette entry.
5. **Recurrence test** — `src/calendar.js` contains the weekly-recurrence expansion (a function
   that turns recurring events into concrete instances within a visible range; find it — the
   handoff calls it `expandEvents`). **Export it** (this is the one permitted app-code change) and
   test: a weekly event dated Monday expands to every Monday inside a 4-week window and none
   outside; `recurrence: 'none'` yields exactly one instance; instances keep title/color/times.
6. **Smoke render tests** — `test/screens.test.js`: for each of `DashboardScreen`,
   `CalendarScreen`, `ClassesScreen`, `StudentsScreen`, `MaterialsScreen`, `HomeworkScreen`,
   `FeedbackScreen`, `ProfileScreen` and `AuthScreen`, render inside the required providers and
   assert something screen-specific is on screen (not just "did not throw"):
   ```js
   import { render, screen } from '@testing-library/react';
   import { LanguageProvider } from '../src/lib/i18n.js';
   import { StoreProvider } from '../src/store.js';
   // render(<providers><Screen …/></providers>) — use React.createElement, matching the codebase.
   ```
   `DashboardScreen` and `ProfileScreen` need a `user` prop: use
   `{ id: 'u1', name: 'Test', email: 't@t.t', role: 'Teacher', color: 'orange' }`. `ProfileScreen`
   also takes `onSave`/`onLogout` (pass `vi.fn()`); `DashboardScreen` takes `onNav`.
7. Add script: `"test": "vitest run"` and `"test:watch": "vitest"`.

## Task 4 — Worker/API tests

Use the official Workers Vitest integration so tests run inside the workerd runtime with a real
local D1.

1. `npm i -D @cloudflare/vitest-pool-workers`
2. `vitest.workers.config.js`:
   ```js
   import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
   import path from 'node:path';

   export default defineWorkersConfig(async () => {
     const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
     return {
       test: {
         include: ['test-worker/**/*.test.js'],
         setupFiles: ['./test-worker/apply-migrations.js'],
         poolOptions: {
           workers: {
             wrangler: { configPath: './wrangler.jsonc' },
             miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
           },
         },
       },
     };
   });
   ```
   `test-worker/apply-migrations.js`:
   ```js
   import { applyD1Migrations, env } from 'cloudflare:test';
   await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
   ```
   (If the API surface has drifted, follow the current guide:
   developers.cloudflare.com/workers/testing/vitest-integration/ — especially its D1 recipe. The
   ASSETS binding is irrelevant to these tests; if the pool complains about the assets directory,
   create an empty `dist/` first or point a test-only wrangler config at a stub.)
3. `test-worker/api.test.js` — import the Worker directly and call `worker.fetch` with
   `createExecutionContext` from `cloudflare:test`. Cover:
   - `GET /api/state` → 200; body has all 9 collection keys + `theme`; empty DB → empty arrays.
   - `POST /api/classes` with `{ name, subject, color, room, schedule: [{day: 1, start: '09:00',
     end: '10:00'}], studentIds: [] }` → 201, server-assigned `id`, schedule echoed back.
   - `PATCH /api/classes/:id` replacing `schedule` and `studentIds` → arrays fully replaced (not
     appended).
   - Create a student, link it to the class via `PATCH /api/students/:id {classIds:[classId]}`,
     then `GET /api/state` → both sides of the relation present.
   - `DELETE /api/classes/:id` → class gone, student's `classIds` no longer contains it, and an
     event that referenced the class now has `classId: null`.
   - `GET /api/theme` returns defaults; `PUT /api/theme {bg:'#000000'}` merges (other keys keep
     defaults).
   - `POST /api/nonsense` → 404. `PATCH /api/classes` without id → 400.
4. Script: `"test:worker": "vitest run --config vitest.workers.config.js"`. Make `"test"` run
   both: `"test": "vitest run && vitest run --config vitest.workers.config.js"`.

## Task 5 — CI

Create `.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches-ignore: [main]
  pull_request:
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check
      - run: npm test
      - run: npm run build
```
Leave `deploy.yml` untouched.

---

## Acceptance criteria

- [ ] `npm run lint` exits 0.
- [ ] `npm run format:check` exits 0.
- [ ] `npm test` runs **both** suites; ≥ 9 screen smoke tests, core unit tests, recurrence tests,
      and ≥ 8 worker API tests all pass.
- [ ] CI workflow passes on the phase branch.
- [ ] `git diff` against the phase start shows **no app behavior change** — only the recurrence
      export, configs, tests, and formatting.
- [ ] `npm run cf:dev` still serves a working app (manual click-through per README rule 3).
