# Android hardware back button — audit

Walkthrough of every mobile screen on an Android emulator, pressing the hardware back button and
recording where it actually went. Pre-fix results are from the **preview APK** (release build,
`versionCode 5`, channel `preview`); post-fix results are from a **local debug build**
(`npx expo run:android`) serving the same commit off Metro. Both on the same AVD, **Android 16,
1080x2400**, driven by `adb shell input keyevent 4` with a screenshot before and after every press.

**The rule being tested** (the product decision): back retraces the screens you actually visited,
in order — `A → B → C`, back in `C` goes to `B`. This applies to tab switches too, not just detail
screens. When history runs out, back exits the app.

Accounts: staff `dev@mochi.edu`, student `vunq@mochi.edu`.

---

## Verdict

**20 of 32 checks failed before the fix; all 32 pass after it.** Every failure was one bug: back
went to **Dashboard** from everywhere, because the tab navigator was rewriting its history on every
navigation instead of appending to it. Nested stacks (Classes, People, Homework, Materials,
Flashcards) were always correct, which is why the bug reads as "only some screens are broken".

One failure was worse than a wrong back target: **a student pressing back on their home screen
landed on the staff Dashboard.**

Fixed by `backBehavior="fullHistory"` on the `(app)` Tabs navigator, plus a role guard on the
Dashboard screen. `npm run typecheck` and `npm run bundle` both clean.

Two further cases (C4, C6) were **not testable** on this dataset and remain unverified on a device —
see the cross-tab table.

---

## Root cause

Three things compose. None is obvious on its own.

**1. Eleven detail screens are sibling tabs, not stack screens.** `mobile/app/(app)/_layout.tsx`
registers `people`, `attendance`, `event`, `material`, `homework`, `materials`, `assessments`,
`feedback`, `config`, `language`, `notifications` as `<Tabs.Screen options={{ href: null }} />`.
`href: null` only hides the tab *button* — the route stays a sibling tab of Dashboard.

**2. `router.push` to a sibling tab is silently downgraded to a tab jump.**
`expo-router/build/global-state/getNavigationAction.js:51-53`:

```js
if (type === 'PUSH' && navigationState.type !== 'stack') {
    type = 'NAVIGATE';
}
```

So `router.push('/people')` from More never pushed anything. Nothing was on a stack for back to
pop. Confirmed on screen: while any of those eleven screens is open, **no tab is highlighted** in
the bottom bar — they are hidden tabs, not pushed screens.

**3. The tab router's default `backBehavior: 'firstRoute'` *rewrites* history rather than
accumulating it.** `expo-router/build/react-navigation/routers/TabRouter.js:34-41` and `:86` —
on every navigation, `changeIndex` discards the accumulated history and rebuilds it as
`[routes[0], current]`. `GO_BACK` then pops to `routes[0]`.

`routes[0]` is `dashboard`, because it is the first `<Tabs.Screen>` declared. Hence: back always
went to Dashboard, and the screen you actually came from was unreachable.

### Why students got the staff Dashboard

`getRouteHistory` under `firstRoute` unshifts `routes[0]` into history *for students too* —
`dashboard` is hidden for a student (`href: null`), not removed from the navigator. So a student's
history was `[dashboard, flashcards]` from launch, and one back press focused the staff Dashboard:
staff-only queries from `~/lib/staff-data`, a stuck spinner, `0 Students / 0 Active classes`, and
no active tab. No staff data leaked (the server 403s a student token, as `app/index.tsx` notes),
but it is a broken screen a student should never reach.

---

## Results

`PASS`/`FAIL` is against the rule above. "Pre-fix actual" is what the release APK did.

### Tab switching

| # | Steps | Back should go to | Pre-fix actual | Pre | Post |
|---|-------|-------------------|----------------|-----|------|
| T1 | launch → Dashboard | exit app | exit (launcher resumed) | PASS | PASS |
| T2 | Dashboard → Calendar | Dashboard | Dashboard | PASS | PASS |
| T3 | Dashboard → Calendar → Classes | **Calendar** | **Dashboard** | FAIL | PASS |
| T4 | Dashboard → Classes → Flashcards → More | **Flashcards** | **Dashboard** | FAIL | PASS |
| T5 | T3, then keep pressing back | Calendar → Dashboard → exit | Dashboard → exit (2 presses) | FAIL | PASS (3 presses, in order) |

T2 passed only by coincidence: Dashboard *is* `routes[0]`, so the wrong answer and the right answer
were the same screen.

### More menu (every row)

Each row: Dashboard → More → tap row → back. Should return to **More** every time.

| # | Row | Route | Pre-fix actual | Pre | Post |
|---|-----|-------|----------------|-----|------|
| M1 | People | `/people` | Dashboard | FAIL | PASS |
| M2 | Homework | `/homework` | Dashboard | FAIL | PASS |
| M3 | Materials | `/materials` | Dashboard | FAIL | PASS |
| M4 | Assessment | `/assessments` | Dashboard | FAIL | PASS |
| M5 | Feedback | `/feedback` | Dashboard | FAIL | PASS |
| M6 | Share feedback | `/feedback?compose=1` | Dashboard | FAIL | PASS |
| M7 | System Config | `/config` | Dashboard | FAIL | PASS |
| M8 | Your profile | `/profile` | Dashboard | FAIL | PASS |
| M9 | Notifications | `/notifications` | Dashboard | FAIL | PASS |
| M10 | Language | `/language` | Dashboard | FAIL | PASS |

M6 opens a compose sheet that **sometimes** focuses its input and raises the keyboard and sometimes
does not, depending on whether the screen was already mounted. The first back press is then consumed
by the keyboard rather than by navigation — correct Android behaviour, but it makes a fixed
"press back twice" script measure the wrong press. Check `dumpsys input_method | grep mInputShown`
and only dismiss when it is actually up; the verdict is the first press after that.

### Cross-tab detail jumps

| # | Steps | Back should go to | Pre-fix actual | Pre | Post |
|---|-------|-------------------|----------------|-----|------|
| C1 | Calendar → tap event (Biology 9A) | Calendar | Dashboard | FAIL | PASS |
| C2 | Calendar → `+` new event | Calendar | Dashboard | FAIL | PASS |
| C3 | Dashboard → "Calendar ›" inline link | Dashboard | Dashboard | PASS | PASS |
| C5 | More → Materials → "Open" (viewer, `/material/:id`) | Materials list | Dashboard | FAIL | PASS |
| C7 | Calendar → event → Homework tab → grade | **event detail** | Dashboard | FAIL | PASS |

C7 was the most destructive: you lost the whole event you were working in, not just one step. After
the fix it returns to the event **with its Homework sub-tab still selected** — the in-page segmented
tabs in `ui/Tabs.tsx` hold local state and are untouched by navigation, so the screen comes back as
you left it.

C3 passed for the same coincidental reason as T2.

**C4** (Dashboard → Take attendance) and **C6** (event → attached material) were **not testable**
on this dataset — nothing is scheduled today, and the Biology 9A event has no materials attached.
Both are the same mechanism as C1/C5 and are fixed by the same change, but neither was exercised on
a device. Worth a manual pass once there is an event today with a material on it.

### Nested stacks — control group

These have their own `<Stack>` layout, so `GO_BACK` is consumed before it reaches the tab router.
Expected to pass before *and* after; they are the regression check on the fix.

| # | Steps | Pre | Post |
|---|-------|-----|------|
| N1 | Classes → class detail → back → Classes list | PASS | PASS |
| N2 | Classes → class → Edit roster → back → class → back → Classes list (3 deep) | PASS | PASS |
| N3 | More → People → student editor → back → People list | PASS | PASS |
| N8 | More → Materials → pencil (`/materials/:id` editor) → back → Materials list | PASS | PASS |
| N10 | Flashcards → topic → back → Flashcards list | PASS | PASS |
| N11 | Topic → Add word → back → topic (first press dismisses keyboard) | PASS | PASS |
| G1 | Flashcards → topic → Flip cards game → back → topic | PASS | PASS |

N3 at depth 2 (back again from the People list) went to Dashboard instead of More pre-fix — that is
M1, not a nested-stack failure.

G1 always worked because `/play/:slug/:mode` lives in the **root** Stack
(`mobile/app/_layout.tsx`), so its push is a real push.

### Auth edges

| # | Steps | Expected | Pre-fix actual | Pre | Post |
|---|-------|----------|----------------|-----|------|
| D2 | back on `/login` while signed out | exit | exit | PASS | PASS |
| D3 | Log out (`dismissAll` + `replace('/login')`) → back | exit, never back into the app | exit | PASS | PASS |

### Student role

| # | Steps | Expected | Pre-fix actual | Pre | Post |
|---|-------|----------|----------------|-----|------|
| S1 | launch as student → Flashcards → back | exit app | **staff Dashboard** | **FAIL** | PASS (exits) |
| S2 | Flashcards → Your profile → back | Flashcards | **staff Dashboard** | **FAIL** | PASS |
| S3 | Flashcards → topic → back → list | Flashcards list | Flashcards list | PASS | PASS |

S1/S2 pre-fix rendered "Good morning, Vu" over the staff dashboard layout — Today's schedule, Due
today, and `Active classes 0 / Students 0 / Open homework 0 / Materials 0` — with a stuck spinner
and no active tab.

---

## The fix

**`mobile/app/(app)/_layout.tsx`** — `backBehavior="fullHistory"` on the `<Tabs>`.

`fullHistory`, not `history`: `history` de-duplicates, keeping each route at most once
(`TabRouter.js:63-66`), so revisiting a tab drops the earlier visit and back stops retracing what
actually happened. `fullHistory` appends every visit (`:67-83`), which is the literal rule.

This also removes the student leak on its own — `fullHistory` never unshifts `routes[0]`
(`getRouteHistory`, `:52-55`), so a student's history starts at the screen they landed on and
`GO_BACK` with a single entry returns `null` and exits the app (`:258-261`).

**`mobile/app/(app)/dashboard.tsx`** — role guard. `dashboard` is hidden for a student, not
removed, so the route stays focusable by anything that names it (a `mochi:///dashboard` deep link).
The default export is now a guard that redirects a student to `/flashcards`; the staff screen moved
into a separate module-scope `StaffDashboard`, so a student never mounts the staff-data hooks at
all. Same role split as `app/index.tsx`.

### Consequences worth knowing

- **Back now retraces tab switches literally, and that is measurable.** Measured as a student:
  5 tab switches (Flashcards → Profile → Flashcards → Profile → Flashcards → Profile) then back
  repeatedly — it stepped through Flashcards, Profile, Flashcards, Profile, Flashcards, and the
  **6th** press exited. So exiting costs one press per switch made. That is the rule as
  specified — strict previous screen, tabs included. If exiting from a tab root should instead
  always be one press, `backBehavior` is the single knob to revisit (`'history'` de-duplicates,
  `'firstRoute'` is the old behaviour).
- **Tab-scoped stacks still keep their own state, unchanged by this fix.** Jumping Event → grade
  homework leaves the grade screen on the `homework` tab's stack; opening More → Homework later
  resumes on that grade screen rather than the list. Pre-existing, orthogonal, not addressed here.
- **The four `router.replace('/flashcards')` calls** in the flashcards editors (`new.tsx:37`,
  `[slug]/edit.tsx:39`, `[slug]/import.tsx:67`, `[slug]/word/[id].tsx:82`) are deliberate
  post-save resets and were left alone. They drop the editor from history, which is what you want
  after saving.

## Reproducing this audit

```sh
# emulator
$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe -avd mochi_dev
adb wait-for-device

# app (local dev build, connects to Metro)
cd mobile && npx expo run:android

# drive it
adb shell input tap <x> <y>
adb shell input keyevent 4                      # hardware back
adb shell screencap -p /sdcard/s.png; adb pull /sdcard/s.png .

# is the app still foregrounded, or did back exit it?
adb shell dumpsys activity activities | grep topResumedActivity
```

That last command is the only reliable way to tell "back exited the app" from "back navigated
somewhere" — a screenshot of the launcher and a screenshot of a blank screen look similar enough to
mislead.

Three things that will waste your time:

- **The dev-client floating bubble sits on top of the Calendar `+` FAB.** Tapping the FAB opens the
  dev menu instead of the new-event form. Drag the bubble to the left edge first
  (`adb shell input swipe 971 299 90 1250 900`); it resets on every cold start.
- **A dev build launched from the launcher icon opens the dev-launcher menu**, not the app. Cold-start
  into the bundle with
  `adb shell am start -a android.intent.action.VIEW -d "mochi://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"`.
- **`adb shell input text` needs the field to actually be focused.** On the post-logout login screen
  the "Your session has ended" banner pushes the inputs ~90px down, so coordinates captured on the
  clean login screen land both the email and the password in the email field. Re-screenshot after
  any banner appears.

**Note on `npm run typecheck`:** it reports impossible route-type errors in `materials/index.tsx`
and `people/index.tsx` on a warm cache. That is the stale `.expo/types/router.d.ts` trap documented
in `mobile/README.md` — unrelated to navigation. Cold-regenerate before trusting it:
`rm -rf .expo/types && npx expo start --clear`.
