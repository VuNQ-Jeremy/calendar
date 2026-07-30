# Android hardware back button — audit

Walkthrough of every mobile screen on an Android emulator, pressing the hardware back button and
recording where it actually went. Pre-fix results are from the **preview APK** (release build,
`versionCode 5`, channel `preview`); post-fix results are from a **local debug build**
(`npx expo run:android`) serving the same commit off Metro. Both on the same AVD, **Android 16,
1080x2400**, driven by `adb shell input keyevent 4` with a screenshot before and after every press.

**The rule being tested** (the product decision), in two halves:

1. **A tab is a root.** Back on one of the tab bar's own screens leaves the app. It does **not** hop
   to whichever tab you were on before — Dashboard → Calendar → back exits, it does not return to
   Dashboard. Five such screens for staff (Dashboard, Calendar, Classes, Flashcards, More), two for a
   student (Flashcards, Your profile).
2. **Everything else retraces.** `A → B → C`, back in `C` goes to `B`. More → People → back → More;
   Calendar → event → back → Calendar; and inside a nested stack, one step per press.

Note that `/profile` sits on both sides of that line: a root for a student, whose tab it is, and a
pushed screen for staff, who reach it through More. It is tested both ways.

Accounts: staff `dev@mochi.edu`, student `vunq@mochi.edu`.

---

## Verdict

**21 of 31 checks failed before the fix; all 31 pass after it.** Every one of those failures was the
same bug: back went to **Dashboard** from everywhere, because the tab navigator was rewriting its
history on every navigation instead of appending to it. Nested stacks (Classes, People, Homework,
Materials, Flashcards) were always correct, which is why the bug reads as "only some screens are
broken".

One failure was worse than a wrong back target: **a student pressing back on their home screen
landed on the staff Dashboard.**

Fixed by three things in two files: `backBehavior="fullHistory"` on the `(app)` Tabs navigator so
detail screens can find the screen that opened them, `useTabRootsEndTheBackStack` so a press on a
tab's own screen goes to Android instead of that history, and a role guard on the Dashboard screen.
`npm run typecheck` and `npm run bundle` both clean.

Two further cases (C4, C6) were **not testable** on this dataset and remain unverified on a device —
see the cross-tab table. They are excluded from the 31.

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

A tab is a root, so every one of these should **exit the app**. Verified with
`dumpsys activity activities | grep topResumedActivity` rather than by screenshot.

| # | Steps | Back should | Pre-fix actual | Pre | Post |
|---|-------|-------------|----------------|-----|------|
| T1 | launch → Dashboard | exit | exit (launcher resumed) | PASS | PASS |
| T2 | Dashboard → Calendar | exit | **Dashboard** | FAIL | PASS (exits) |
| T3 | Dashboard → Calendar → Classes | exit | **Dashboard** | FAIL | PASS (exits) |
| T4 | Dashboard → Classes → Flashcards → More | exit | **Dashboard** | FAIL | PASS (exits) |

Pre-fix, T2 looked like a pass under an earlier reading of the rule — but only by coincidence, since
Dashboard *is* `routes[0]`, so "wrong target" and "the screen before" were the same screen. Under the
rule as settled it is a failure: back on a tab should not have gone anywhere.

An intermediate version of this fix used `fullHistory` alone, which made back retrace tab switches
(Classes → Calendar → Dashboard → exit). That was the literal reading of "A → B → C" but wrong for
the tab bar, and it is what `useTabRootsEndTheBackStack` now suppresses.

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
| M8 | Your profile | `/profile` | Dashboard | FAIL | PASS (→ More, because `/profile` is not a *staff* tab) |
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
| C3 | Dashboard → "Calendar ›" inline link | exit (lands on a tab) | Dashboard | FAIL | PASS (exits) |
| C5 | More → Materials → "Open" (viewer, `/material/:id`) | Materials list | Dashboard | FAIL | PASS |
| C7 | Calendar → event → Homework tab → grade | **event detail** | Dashboard | FAIL | PASS |

C7 was the most destructive: you lost the whole event you were working in, not just one step. After
the fix it returns to the event **with its Homework sub-tab still selected** — the in-page segmented
tabs in `ui/Tabs.tsx` hold local state and are untouched by navigation, so the screen comes back as
you left it.

C3 is not really a cross-tab jump: the Dashboard's "Calendar ›" link lands you on the Calendar
**tab**, so under the settled rule back exits rather than returning to Dashboard.

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
M1, not a nested-stack failure. Post-fix the whole chain was walked in one go and each press lands
one step back: student editor → People list → More → exit. That is the clearest single demonstration
of both halves of the rule at once — two retracing steps, then the root ends it.

G1 always worked because `/play/:slug/:mode` lives in the **root** Stack
(`mobile/app/_layout.tsx`), so its push is a real push.

### Auth edges

| # | Steps | Expected | Pre-fix actual | Pre | Post |
|---|-------|----------|----------------|-----|------|
| D2 | back on `/login` while signed out | exit | exit | PASS | PASS |
| D3 | Log out (`dismissAll` + `replace('/login')`) → back | exit, never back into the app | exit | PASS | PASS |

### Student role

A student's two tabs are Flashcards and Your profile, so both are roots.

| # | Steps | Expected | Pre-fix actual | Pre | Post |
|---|-------|----------|----------------|-----|------|
| S1 | launch as student → Flashcards → back | exit | **staff Dashboard** | **FAIL** | PASS (exits) |
| S2 | Flashcards → Your profile → back | exit (Profile is their tab) | **staff Dashboard** | **FAIL** | PASS (exits) |
| S3 | Flashcards → topic → back, then back | list, then exit | list, then staff Dashboard | FAIL | PASS |

S1/S2 pre-fix rendered "Good morning, Vu" over the staff dashboard layout — Today's schedule, Due
today, and `Active classes 0 / Students 0 / Open homework 0 / Materials 0` — with a stuck spinner
and no active tab.

Contrast S2 with **M8**: the same `/profile` screen, and back exits for a student but returns to More
for staff, because the role decides whether it is a tab. Those two rows together are the check that
the role-dependent list actually works.

---

## The fix

**`mobile/app/(app)/_layout.tsx`, part 1** — `backBehavior="fullHistory"` on the `<Tabs>`.

This is for the **detail screens**, not the tab bar. Since they are hidden tabs, the tab history is
the only place a record of "what opened this" can live.

`fullHistory`, not `history`: `history` de-duplicates, keeping each route at most once
(`TabRouter.js:63-66`), so revisiting a screen drops the earlier visit and back stops retracing what
actually happened. `fullHistory` appends every visit (`:67-83`).

This also removes the student leak on its own — `fullHistory` never unshifts `routes[0]`
(`getRouteHistory`, `:52-55`), so a student's history starts at the screen they landed on and
`GO_BACK` with a single entry returns `null` and exits the app (`:258-261`).

**`mobile/app/(app)/_layout.tsx`, part 2** — `useTabRootsEndTheBackStack`.

`fullHistory` also records plain tab switches, which would make Dashboard → Calendar → back return to
Dashboard. A tab is a root, so that is wrong. The hook subscribes to `hardwareBackPress` only while a
tab's own URL is focused (matched exactly against a role-dependent list, so `/classes` is a root but
`/classes/:id` is not) and hands the press to Android.

`backBehavior="none"` would say this declaratively — it is a real option, and with no matching `case`
in `getRouteHistory` the history stays at one entry forever — but it would apply to the eleven detail
screens too and strand them, so it cannot be used here.

Two things make the hook safe rather than a hack:

- **`BackHandler.exitApp()` is misnamed.** It calls `invokeDefaultBackPressHandler`, i.e.
  MainActivity's `invokeDefaultOnBackPressed` → `moveTaskToBack` — the same backgrounding back on
  Dashboard already did. It is **not** `finish()`, so the task stays warm in recents.
- **Registration order gives it priority.** RN calls `hardwareBackPress` subscribers in reverse order
  of registration, and this mounts after the NavigationContainer. On every other screen the hook is
  not subscribed at all, so react-navigation handles the press exactly as before — which is what
  keeps the nested stacks popping.

**`mobile/app/(app)/dashboard.tsx`** — role guard. `dashboard` is hidden for a student, not
removed, so the route stays focusable by anything that names it (a `mochi:///dashboard` deep link).
The default export is now a guard that redirects a student to `/flashcards`; the staff screen moved
into a separate module-scope `StaffDashboard`, so a student never mounts the staff-data hooks at
all. Same role split as `app/index.tsx`.

### Consequences worth knowing

- **Exiting is always one press from a tab, however you got there.** No matter how many tab switches
  or how deep a detail screen you came back through, once a tab's own screen is showing, back leaves.
  That is the point of the second half of the rule.
- **The two lists in `_layout.tsx` must track the `href` values, not the file tree.** They name the
  screens that *appear in the tab bar* for each role. If a screen is added to or removed from the bar
  — or its `href: staff ? … : null` flips, as `profile` does — the corresponding list has to change
  with it, or that screen will either wrongly exit the app or wrongly retrace. This is the one
  maintenance cost of the approach.
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
