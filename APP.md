# Mochi — application build

This is the runnable implementation of the Mochi learning-management calendar
described in [`README.md`](./README.md). It is a **Vite + React** single-page app
that recreates the design prototype under `design/` against the binding
**Mochi Design System**.

## Run it

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run build      # production build → dist/
npm run preview    # serve the production build
```

**Demo login:** any seeded email (e.g. `sam@school.edu`) with any non-empty
password. You can also create an account, reset a password (mocked), or redeem
the demo invite code shown on the "I have an invite code" screen.

## How it's wired

```
index.html                # loads fonts, the DS stylesheet, React UMD + the DS
                          # component bundle (as globals), then the app module
public/_ds/…              # the Mochi Design System bundle (tokens + components)
src/
  lib/globals.js          # bridges window.React / DS bundle into the module graph
  lib/core.js             # category palette, date helpers, invite codes, icon tint
  store.js                # data layer: React context + localStorage, seed data
  icons.js                # Lucide-style icon set (MIcon)
  ui.js                   # Modal, Select, ColorPicker, PageHeader, Empty, useConfirm
  auth.js                 # login / signup / forgot / invite-code redemption
  shell.js                # sidebar nav + screen routing (AppShell)
  calendar.js             # Calendar: month / week / day / agenda, drag-to-reschedule
  screens-core.js         # Dashboard (Today) + Homework
  screens-manage.js       # Classes + People (students / staff / parents / invites)
  screens-extra.js        # Materials + Profile + reusable calendar theme panel
  main.js                 # root: auth gate, session persistence
```

### Design system as a shared global

React and `react-dom` are loaded as **UMD globals** in `index.html`, and the
Mochi Design System bundle (`public/_ds/…/_ds_bundle.js`) attaches its components
to `window.MochiDesignSystem_472b36`. The app reads both through
`src/lib/globals.js`, so the app and the DS components share a **single React
instance** (required for hooks/elements to work across the boundary). The
`react` / `react-dom` packages in `devDependencies` pin that UMD version and back
the render smoke test.

## Onboarding & language

A welcome guide (`src/instructions.js`), organized by feature, shows on a user's
first visit and reopens from the **?** in the sidebar. The app is fully bilingual
— **English and Tiếng Việt** — via a small i18n layer (`src/lib/i18n.js`):
`t(key, vars)` translates with `{placeholder}` interpolation, and `getCal(lang)`
localizes calendar month/weekday names. Every screen (auth, dashboard, calendar,
classes, people, materials, homework, feedback, profile) reads from the `STRINGS`
dictionary. Switch languages from the toggle in the sidebar (above "Give
feedback"), on the login screen, or on the Profile page; the choice persists.

## What's implemented

All first-build screens from the handoff: Auth, Dashboard, Calendar
(month/week/day/agenda, event CRUD, drag-to-reschedule, weekly recurrence, theme
panel + background image), Classes (cards, detail popup, schedule + roster),
People (students / staff / parents / one-time invite codes, type-ahead linking),
Materials (upload/link + download), Homework (checklist with points/notes), and
Profile.

## Next steps (per the handoff)

The data layer (`store.js`) and mock auth (`auth.js`) are intentionally
client-side for this build. Replace `localStorage` with a real API/DB and wire
`auth.js` to real email+password auth with sessions, "remember me", password
reset, and invite-code redemption. The store API (`add` / `update` / `remove` /
`setTheme` / `reset`) is shaped to map onto real queries/mutations. The
parent-facing portal remains in the backlog.
