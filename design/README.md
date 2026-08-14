# Handoff: Mochi — Learning Management Calendar

> **Historical document — the original design handoff, not current state.** It describes
> the intent the app was built from and the prototype in this folder, both of which the
> shipped app has since grown well past. For what Mochi is today see the
> [root README](../README.md). Paths below are relative to the repo root.

## Overview
Mochi is a warm, family-friendly **learning management web app** for a teacher/admin
audience. It combines **authentication**, **calendar** (Google-Calendar-style, fully
customizable), **class management**, **people management** (students, staff, parents),
**materials/resources**, and **homework tracking** — all under one cosy, cream-colored
shell. A read-only **parent-facing portal** now ships alongside it, switched on per school
from System Config → Parent access.

The product voice is "a kind, organized friend who happens to love your kids" — calm,
encouraging, sentence-case, never enterprise-clinical.

---

## About the Design Files
The files under `design/` are **design references created in HTML/React-via-Babel** —
prototypes that demonstrate the intended look, layout, and behavior. **They are not
production code to ship directly.** They run entirely in the browser with in-memory
sample data persisted to `localStorage`; there is no backend, router, build step, or
real auth.

Your task is to **recreate these designs in the target codebase's environment** using
its established framework, component library, routing, data layer, and auth — or, if no
codebase exists yet, to choose an appropriate stack (e.g. React + Vite + a real router +
a backend/API) and implement the designs there. Treat the HTML as the source of truth
for *visual + interaction intent*, and the in-file logic as a *reference implementation*
of the behavior, not the architecture.

To preview the reference: open `design/index.html` in a browser (it loads React, Babel,
and the Mochi design-system bundle from local paths + Google Fonts from CDN). **Demo
login:** `sam@school.edu` / any non-empty password (auth is mocked — any seeded user
email logs in; see `app/auth.jsx`).

---

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, component shapes, and
interactions are all intended as shown. Recreate the UI pixel-faithfully using the
**Mochi Design System** (bundled under `design/_ds/`) — its tokens and React components
are the binding visual contract. Do not invent new colors/type/spacing; consume the
design-system tokens and components.

---

## Design System (binding)
All visuals derive from the **Mochi Design System**, bundled at
`design/_ds/mochi-design-system-472b365a-31b5-44c2-8b48-4d5ab7945e52/`.

- **Stylesheet entry:** `…/_ds/.../styles.css` (imports all token layers: fonts, colors,
  typography, spacing, effects, base, components).
- **Component bundle:** `…/_ds/.../_ds_bundle.js` → exposes components on
  `window.MochiDesignSystem_472b36`: `Button`, `IconButton`, `Card`, `Badge`, `Tag`,
  `Avatar`, `Input`, `Checkbox`, `Switch`, `ProgressBar`, `Tabs`.
- In a real codebase, install/port these as proper components (the design-system source
  tree has per-component `*.prompt.md` usage notes). Keep the **same names and props**.
- **Icons:** Lucide (2px rounded stroke). The prototype inlines the glyphs it uses in
  `app/icons.jsx` as `<MIcon name="…" />`; in production use `lucide-react` with the same
  names.
- **Fonts:** **Fredoka** (headings, numbers), **Nunito Sans** (UI/body), **DM Mono**
  (times, dates, grades, codes).

---

## Information Architecture / Navigation
Fixed left **sidebar** (260px, cream) + scrollable main content. No top search bar
(removed per review). Nav groups:

- **Overview** — Dashboard (Today), Calendar
- **Manage** — Classes, People, Materials, Homework
- **Sidebar footer** — current user avatar → **Profile** (personal management page:
  name, avatar color, contacts, sign out, reset demo).

Badges on nav items: **Homework** shows count of items due today/overdue; **People**
shows count of unused invite codes.

---

## Screens / Views

### 1. Auth (`app/auth.jsx`)
- **Modes:** `login`, `signup`, `forgot`, `code` (redeem one-time onboarding code).
- **Login:** email + password, **"Remember me"** toggle (persists session to
  `localStorage`), links to Sign up / Forgot password / "I have an invite code".
- **Sign up:** name, email, password → creates a staff user and logs in.
- **Forgot password:** email → confirmation message (mocked).
- **Invite code redemption:** 6-char code in `XXX-XXX` format (mono) → onboarding.
- **Layout:** centered card on cream; Mochi paw mark + wordmark; sentence-case copy.

### 2. Dashboard / Today (`app/screens-core.jsx` → `DashboardScreen`)
- Greeting header, "today" summary. Cards: today's events, homework due today (with
  inline check-off + completion `ProgressBar`), quick links. Pulls from the store.

### 3. Calendar (`app/calendar.jsx` → `CalendarScreen`) — the centerpiece
- **Views:** Month, Week, Day, Agenda (list) — switched via `Tabs` segmented control.
- **Navigation:** prev/next + "Today"; title reflects the range (e.g. "Sep 1 – Sep 7",
  "Mon, September 4", "Next 2 weeks").
- **Events:** create/edit via `EventModal` (title, date, start/end time, class link,
  location, color, recurrence none/weekly). Click empty slot to create; click event to
  edit/delete.
- **Drag to reschedule:** events in the week/day time-grid can be dragged to a new
  day/time (`onMove`).
- **Color-coding:** every event carries a category hue (violet/green/blue/orange/cocoa/
  rose) — usually inherited from its class.
- **Recurring events:** weekly recurrence is expanded into concrete instances within the
  visible range (`expandEvents`).
- **Customization (lives ON the calendar page, per review — not in global settings):**
  a **theme panel** (`CalendarThemePanel`) with full color pickers for canvas
  background, grid lines, today tint, day-header strip, plus an optional **background
  image** URL with opacity control. Theme persists in the store (`data.theme`).
- **Legend** of category colors at the bottom.
- **Time grid:** hour rows, "now" line, mono time labels; week shows 7 day columns, day
  shows 1. Today's column is tinted.

### 4. Classes (`app/screens-manage.jsx` → `ClassesScreen`)
- Card grid; each card has a colored top bar, name, subject `Tag`, edit/delete icon
  buttons. **Clicking the card body opens a detail popup** (`ClassDetailModal`) showing
  subject/room, a stat strip (students / open work / materials), the weekly schedule,
  the full roster (avatars), and linked materials.
- **Create/edit** (`ClassModal`): name, subject/tag, room, color, weekly schedule
  (day + start/end time slots), and student assignment.

### 5. People (`app/screens-manage.jsx` → `StudentsScreen`)
Segmented `Tabs`: **Students · Staff · Parents · Invites** (counts in labels).
- **Students:** list rows (avatar, grade, linked parent, email, class tags); add/edit via
  `StudentModal` — name and email, then a **Grade & classes** section (grade sits with
  the **"Enrolled classes" type-ahead search**: the `TokenSearch` component — search by
  name, pick to add a removable colored chip), then a **Parent** section when adding.
  Filling the parent in creates a real linked `parents` row, not a free-text label —
  or tick **"Link an existing parent"** and pick one from the dropdown, which is the
  sibling case (a second row for the same mother would be wrong).
- **Staff:** list of staff users; add/edit via `StaffModal` (name, email, role, color,
  phone — phone inputs have **no placeholder**, blank by design).
- **Parents:** list rows (avatar, contact, linked children as tags, relation badge);
  add/edit via `ParentModal` (name, relation, email, phone, color, and **children linked
  via the same `TokenSearch`**).
- **Invites (one-time onboarding codes):** there is no "generate" button — **adding
  anyone mints their code**, and the modal ends on it (`XXX-XXX`, mono, copy button; two
  codes when a student was added with a parent). Each code is tied to the person it was
  made for, so redeeming attaches a login to that row instead of creating a second one.
  `InvitesPanel` lists them by the person's name with used/unused state; copy + revoke.

### 6. Materials (`app/screens-extra.jsx` → `MaterialsScreen`)
- List/grid of resources filtered by class. Each item: type icon
  (notes/worksheet/video/link), title, class, favorite/pin star, and a
  **download action** for uploaded files. Add material: upload a file *or* link an
  external URL; choose type; assign to a class; mark favorite.

### 7. Homework (`app/screens-core.jsx` → `HomeworkScreen`)
- A **manually-created checklist** of assigned homework. Each item: `Checkbox` to mark
  done, title, class tag, due date (relative — "Due today", "Tomorrow", "Yesterday"),
  **points**, and **notes**. Filter by class/status; completion `ProgressBar`. Add/edit
  homework manually (title, class, due date, points, notes).

### 8. Profile (`app/screens-extra.jsx` → `ProfileScreen`)
- **Personal management page** (not system settings): edit your name, avatar color, and
  contacts (email, phone). Sign out. "Reset demo data" action. Two-column on wide
  viewports, **collapses to one column below 960px**.

> **Removed per review (do not reintroduce):** global top search bar, notifications,
> topbar avatar, a separate "System settings" page (its calendar theme + background-image
> controls were moved onto the Calendar page).

---

## Interactions & Behavior
- **Routing:** single-page state (`active` screen in `AppShell`). In production, map each
  screen to a real route.
- **Modals:** centered dialog surfaces (`Modal`, `useConfirm` for destructive confirms).
  Open on create/edit/detail; ESC/backdrop to close.
- **Drag-to-reschedule** on the calendar time grid.
- **Type-ahead search** (`TokenSearch`): filters a list as you type, click a suggestion
  to add a removable chip, click chip (or its ×) to remove. Closes on outside click.
- **Inline check-off** for homework (optimistic toggle, persists to store).
- **Color pickers:** full per-element color choice for calendar theme.
- **Motion:** gentle, slightly springy (`--ease-soft`, 120/200/320ms). Buttons shrink on
  press (`scale(.96)`), cards lift on hover (`translateY(-2px)`). Respect
  `prefers-reduced-motion`.
- **Focus:** soft orange ring (`--ring`), never a hard outline.
- **Responsive:** profile grid collapses below 960px; sidebar is fixed-width. The shell
  targets desktop-first (teacher/admin tool); plan mobile/tablet refinements as needed.

---

## Data Model (reference — see `app/store.jsx`)
In-browser store persisted to `localStorage` under a single key. Collections:

- **users** (staff) — `{ id, name, email, role, color, phone }`
- **students** — `{ id, name, grade, guardian, email, color, classIds[] }`
- **parents** — `{ id, name, email, phone, color, relation, studentIds[] }`
- **classes** — `{ id, name, subject, color, room, schedule:[{ day, start, end }], studentIds[] }`
- **events** — `{ id, title, date, start, end, classId, location, color, recur }`
  (`recur`: `none` | `weekly`)
- **homework** — `{ id, title, classId, due, points, notes, done }`
- **materials** — `{ id, title, type, classId, url|file, favorite }`
  (`type`: `notes` | `worksheet` | `video` | `link`)
- **invites** — `{ id, code, role, name, classId, createdAt, used, studentId|staffId|parentId }`
  (`role`: `Student` | `Staff` | `Parent`; `code` = `XXX-XXX`; the id links the code to
  the person it was minted for — all three null on a legacy/mobile-made code)
- **theme** — calendar customization: background color/image + opacity, grid color,
  today tint, header strip color.

Store API (port to real queries/mutations): `add(key,item)`, `update(key,id,patch)`,
`remove(key,id)`, plus session + reset helpers. **Replace `localStorage` with a real
API/DB.** Auth in `app/auth.jsx` is mocked — wire to real email+password auth with
sessions, "remember me", password reset, and invite-code redemption.

---

## Color Tokens (Mochi)
Warm cream canvas, cocoa ink, six soft category hues. **Use the design-system CSS
variables — these hexes are for reference only:**

- Canvas / surfaces: cream `#FBF7F0`, raised `#FFFFFF`, sunken `#F4EDE2`
- Ink: strong `#3B2F2A`, body `#5C4F47`, muted `#9A8C80`
- Brand (warm orange): base `#E8895A`, soft tint for rings/hover
- Category hues: **violet, green, blue, orange, cocoa, rose** — each with
  base / soft / ink variants via `window.colorOf(name)` in the prototype (port to a
  token map). Calendar events + class color-coding draw from these.

---

## Recommended Build Order
1. **Foundation:** install/port the Mochi design system (tokens + components), fonts,
   icon set, app shell (sidebar nav + routing).
2. **Auth + data layer:** real auth (login/signup/forgot/invite-code) + backend models
   for every collection above.
3. **People:** Students / Staff / Parents / Invites, with `TokenSearch` linking.
4. **Classes:** cards, detail popup, create/edit with schedule + roster.
5. **Calendar:** Month/Week/Day/Agenda, event CRUD, drag-to-reschedule, recurrence,
   theme panel + background image.
6. **Materials & Homework:** uploads/links + download; manual homework checklist with
   points/notes.
7. **Dashboard:** compose today's events + due homework from the above.
8. **Parent portal:** a signed-in parent's children — schedule, attendance, monthly report and
   fee slip, read-only. Off by default; System Config → Parent access opens it.

---

## Files in this Package
- `design/index.html` — entry; loads React + Babel + design system + all `app/*.jsx`.
- `design/app/` — the prototype source:
  - `main.jsx` (root, auth gate, session, tweaks), `auth.jsx`, `shell.jsx`,
    `calendar.jsx`, `screens-core.jsx` (Dashboard, Homework),
    `screens-manage.jsx` (Classes, People), `screens-extra.jsx` (Materials, Profile),
    `store.jsx` (data + sample data), `ui.jsx` (Modal/confirm/helpers),
    `icons.jsx` (Lucide glyphs), `styles.css` (app-level CSS on top of the DS).
- `design/_ds/…` — the **Mochi Design System** bundle (tokens, components, usage notes).
- `design/ds-base.js`, `design/tweaks-panel.jsx` — runtime helpers for the prototype.

> Open `design/index.html` to see everything live. Build against the design system, keep
> component names/props stable, and swap the in-browser store + mock auth for real
> backend services.
