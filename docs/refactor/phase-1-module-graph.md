# Phase 1 — Own the module graph (npm React, DS as ES modules, fonts, JSX)

**Goal:** eliminate every `window` global and CDN script. After this phase, React comes from npm,
the design system is imported ES modules, fonts are self-hosted, and all components are JSX. This
is a **hard prerequisite for SSR** (Phase 2): `window` does not exist on the server.

**Bar: zero visual or behavioral change.** Run the Phase 0 suite after every task.

---

## Task 1 — React from npm

1. In `package.json`, move `react` and `react-dom` from `devDependencies` to `dependencies`,
   pinned `^18.3.1` (do **not** jump to React 19 in this phase). `npm i`.

## Task 2 — Vendor the design system as ES modules

Current state: `public/_ds/mochi-design-system-472b365a-31b5-44c2-8b48-4d5ab7945e52/_ds_bundle.js`
is an IIFE with this structure (verify before editing):

```
/* @ds-bundle: {"format":3,"namespace":"MochiDesignSystem_472b36","components":[…11 components…]} */
(() => {
  const __ds_ns = window.MochiDesignSystem_472b36 = { __errors: [] };
  const __ds_scope = {};
  try { (function(){ /* component source, reads window.React */ })(); } catch (e) { … }
  …one try-block per source file, including ui_kits/* demo screens and an icons file that sets window.Icon…
  __ds_ns.Avatar = __ds_scope.Avatar;
  … (Badge, Button, Card, IconButton, Tag, ProgressBar, Checkbox, Input, Switch, Tabs)
})();
```

Steps:

1. Create `src/ds/`. Copy `_ds_bundle.js` → `src/ds/bundle.js` and convert it to an ES module:
   - Add `import React from 'react';` at the top.
   - Replace every read of `window.React` with `React` (inspect first — components may
     destructure like `const { useState } = window.React` or call `window.React.createElement`).
   - Delete the try-blocks originating from `ui_kits/*` source paths (demo screens — the app has
     its own) and the icons block that assigns `window.Icon` (the app has its own `MIcon`).
     Keep **only** the 11 component blocks listed in the `@ds-bundle` header.
   - Remove the outer IIFE + `window.MochiDesignSystem_472b36` assignment; end the file with
     named exports: `export const Avatar = __ds_scope.Avatar;` … for all 11.
   - Do **not** reformat or "improve" the component implementations. Their rendered output is the
     binding visual contract.
2. Create `src/ds/index.js`:
   ```js
   export * from './bundle.js';
   import * as components from './bundle.js';
   export const DS = components; // compat namespace for the existing `const { Button } = DS` style
   ```
3. Move the DS **stylesheets** out of `public/`: copy
   `public/_ds/<hash>/styles.css` and its `tokens/` directory to `src/ds/styles/` **preserving
   relative layout** (`styles.css` uses relative `@import`s of the token files — check and keep
   them resolving). Add `import './ds/styles/styles.css';` as the **first** import of
   `src/main.js` (before `app.css`, so the cascade order matches the old `<link>`-then-Vite-CSS
   order).
4. Update `index.html`: remove the two unpkg `<script>` tags, the `_ds_bundle.js` script tag, and
   the DS stylesheet `<link>`.
5. Update every consumer: replace `import { React, DS } from './lib/globals.js'` with
   `import React from 'react';` and `import { DS } from './ds/index.js';` (path-adjusted). Then
   delete `src/lib/globals.js`. `src/main.js` also needs
   `import ReactDOM from 'react-dom/client';` (it calls `ReactDOM.createRoot`).
6. Update `test/setup.js`: delete the `window.React`/`window.ReactDOM` shims and the bundle
   import (the app no longer reads globals). Keep the fetch stub.
7. Delete `public/_ds/` entirely after confirming nothing references `/_ds/`
   (`grep -rn "_ds" index.html src/ test/` → only `src/ds/` hits).

## Task 3 — Self-host fonts

1. `npm i @fontsource/fredoka @fontsource/nunito-sans @fontsource/dm-mono`
2. In `src/main.js`, before the CSS imports, import the weights the app uses (check
   `src/ds/styles/tokens/fonts.css` and `typography.css` for the exact families/weights; the
   handoff specifies Fredoka 400–700, Nunito Sans 400–800 + italic 400, DM Mono 400/500):
   ```js
   import '@fontsource/fredoka/400.css'; // …500/600/700
   import '@fontsource/nunito-sans/400.css'; // …500/600/700/800 + '@fontsource/nunito-sans/400-italic.css'
   import '@fontsource/dm-mono/400.css'; // …500
   ```
3. Remove the three Google Fonts `<link>` tags (preconnects too) from `index.html`.
4. Visually verify headings (Fredoka), body (Nunito Sans), and calendar time labels (DM Mono)
   still render with the correct faces (compare against a pre-change screenshot; a fallback serif
   anywhere = a missed weight import).

## Task 4 — Convert to JSX

Vite compiles JSX in `.jsx` files with zero config. Convert **one file per commit**, running
`npm test` after each. Order (leaves first):

1. `src/icons.js` → `icons.jsx`
2. `src/ui.js` → `ui.jsx`
3. `src/auth.js` → `auth.jsx`
4. `src/instructions.js`, `src/feedback.js`
5. `src/screens-core.js`, `src/screens-extra.js`, `src/screens-manage.js`, `src/calendar.js`
6. `src/shell.js` → `shell.jsx`
7. `src/store.js` (only the provider return), `src/lib/i18n.js` (contains a provider/toggle —
   rename to `i18n.jsx` only if it holds JSX after conversion)
8. `src/main.js` → `main.jsx`; update `index.html`: `<script type="module" src="/src/main.jsx">`.

Conversion rules:
- `React.createElement('div', { className: 'x' }, kids)` → `<div className="x">{kids}</div>`.
- `cond && React.createElement(...)` → `{cond && <... />}`; array `.map` children need their
  existing `key` props preserved.
- Aliased DS imports (`const { Button: AButton } = DS`) can stay as-is; JSX accepts `<AButton>`.
- Spread props (`{ ...props }`) and `style` objects carry over unchanged.
- Do not rename variables, reorder logic, or "clean up" while converting. Mechanical only.

## Task 5 — Split the two oversized files

Only after everything is JSX and green:

1. `src/calendar.jsx` (~400 lines) → `src/calendar/` package: `index.jsx` (exports
   `CalendarScreen` and the recurrence function), plus internal modules along its natural seams —
   month grid, week/day time grid (incl. drag logic), agenda list, event modal. Inspect the file
   and cut at component boundaries; keep every import path working via `index.jsx` re-exports.
2. `src/screens-manage.jsx` (~450 lines) → `src/screens-manage/` package: `classes.jsx`
   (ClassesScreen + ClassModal + ClassDetailModal), `people.jsx` (StudentsScreen + the
   Student/Staff/Parent modals + InvitesPanel + TokenSearch), `index.jsx` re-exporting
   `ClassesScreen` and `StudentsScreen`.
3. `grep -rn "screens-manage\|from './calendar" src test` and fix all import sites.

---

## Acceptance criteria

- [ ] `grep -rn "window.React\|window.ReactDOM\|MochiDesignSystem" src/ index.html test/` → no hits
      (except inside `src/ds/bundle.js` comments, if any).
- [ ] `grep -n "unpkg\|googleapis\|gstatic" index.html` → no hits. **The app makes zero
      third-party network requests at runtime** (verify in devtools network tab).
- [ ] `public/_ds/` and `src/lib/globals.js` are deleted.
- [ ] All source files with markup are `.jsx`; no `React.createElement` remains outside
      `src/ds/bundle.js` (`grep -rn "createElement" src --include="*.jsx" -l` → empty or
      bundle-only).
- [ ] Full test suite + lint + build green; `vite build` output contains React (bundle size jumps
      ~140KB — expected).
- [ ] Manual click-through: pixel-identical, fonts correct, calendar drag works, theme panel works.
