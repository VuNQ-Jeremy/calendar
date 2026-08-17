# How to test each phase yourself

Hands-on verification for each phase: exact commands, what to click, what failure looks like.

> **Looking for the automated suites?** They are the section immediately below. Everything after
> it is manual, by-hand verification, and stays that way — a person swiping a flashcard is still
> the only way to check that a gesture feels right.

---

## Automated tests (added 2026-08-17)

Three layers, fastest first. Run from `mobile/`.

| Layer | Command | Speed | In CI |
| --- | --- | --- | --- |
| Logic | `npm test` | ~1s | yes |
| Packaging | `npm run test:bundle` | ~1 min | yes |
| Device | `npm run test:device` | minutes | **no — manual only** |

### Logic — `npm test`

Vitest in plain Node, covering `lib/`: the HTTP client, the offline outbox, the local topic cache
and the calendar helpers.

It deliberately does **not** render components. That needs `jest-expo` +
`@testing-library/react-native`, and that stack cannot currently be installed here: react-native
0.86 pins `@react-native/jest-preset` to exactly `0.86.0` while `jest-expo` requires `^0.86.2`,
and `--legacy-peer-deps` "resolves" it by removing `@react-native/babel-preset` and
`@react-native/metro-babel-transformer` — the packages Metro needs to bundle the app. The games'
logic lives in `@mochi/shared/logic/flashcards`, which the repo-root suite covers. Revisit when
the peer ranges line up.

**Needs Node 24.** The `expo-sqlite` stub is backed by `node:sqlite`, which requires a flag on
Node 22 — hence the separate Node version for the mobile steps in CI while the root stays on 22.

Native modules are replaced by `test/stubs/`, wired in `vitest.config.mts`. Stubbing at the
*native* boundary rather than mocking `lib/db.ts` is deliberate: it means `lib/db.ts` runs for
real, so the outbox tests execute the actual schema and the actual `WHERE` clauses instead of a
fake that could never disagree with them.

### Packaging — `npm run test:bundle`

Exports an Android bundle and asserts the API base URL was inlined into it. This is the check
that would have caught 2026-07-29, when a bundle published without `EXPO_PUBLIC_API_URL` threw
before the first frame and expo-updates silently rolled back.

`--clear` is **not** optional. Metro caches the transformed module the `EXPO_PUBLIC_*` value was
inlined into, so re-exporting with a different variable reuses the old bundle — verified on
2026-08-17, when two exports with deliberately different URLs produced byte-identical output. A
cached bundle would pass the check on a URL the current environment never supplied.

Locally the URL comes from `.env.local` (gitignored); CI passes it explicitly.

### Device — `npm run test:device`

[Maestro](https://maestro.mobile.dev) flows in `mobile/.maestro/`. **Manual-trigger only**, the
same rule the web e2e suite follows in `CLAUDE.md` — never part of a commit routine.

- `boot.yaml` — a cold launch reaches a real frame. The on-device half of the packaging check:
  the bundle guard proves the URL was inlined, this proves the app built with it renders.
- `login.yaml` — sign in as the staff test account and leave `/login`.

**Not yet runnable on this machine, so these two flows are written but unverified.** Maestro is a
JVM tool: it needs a JDK, and on Windows it runs under WSL (native Windows support is not
official). As of 2026-08-17 neither Java nor Maestro is installed here.

```bash
winget install --id EclipseAdoptium.Temurin.21.JDK   # 1. a JVM
curl -Ls "https://get.maestro.mobile.dev" | bash      # 2. Maestro (under WSL on Windows)
"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -avd mochi_dev   # 3. the emulator
cd mobile && npm run test:device                      # 4. after installing a build on it
```

The flows target `appId: com.mochi.lms` and drive real screens, so they need a development or
preview build installed on the emulator — not Expo Go.

Commands are given for a POSIX shell (Git Bash / macOS / Linux). On Windows PowerShell, `curl`
is an alias for `Invoke-WebRequest` — use `curl.exe` explicitly, which ships with Windows 10
1803+.

**Two setups exist for this project.** Run `npm run dev` once to find out which you have:

- **It works** → you have local dev and local D1 (`npm run db:migrate:local`,
  `npm run db:seed:local`). Test against `http://localhost:5173`; substitute that for `$BASE`
  below and skip the deploy step.
- **It crashes** → known workerd breakage on at least one Windows machine here. There is no
  local D1; every check below runs against a deployed Worker after `npm run deploy`.
  See [README.md](./README.md) → Environment.

Throughout, `$BASE` is whichever you are using.

---

## One-time setup

**Before Phase 1** — nothing new; you already have the web toolchain.

**Before Phase 2** — the mobile prerequisites:

```bash
npm install -g eas-cli
eas login                # free Expo account, create at expo.dev if needed
```

On your Android phone:
- Install **Expo Go** from the Play Store (for fast iteration).
- Settings → Apps → your browser → **Allow installing unknown apps** (for the APK).
- Put the phone on the **same wifi** as your PC.

On your PC, the first time you run `npx expo start`, Windows Firewall will prompt for
`node.exe` — **allow it on Private networks**. If your phone can't reach Metro, this is why.

**Test accounts you will need.** Role gating is tested constantly from Phase 2 onward, and you
cannot fake it — the server enforces it. Create these now via `/people` → Invites on the
deployed app:

| Account | Why |
|---|---|
| Your Admin account | Sees everything, including Config |
| A **Teacher** account | Must see 5 tabs but **no** Config row |
| A **Student** account | Must see exactly 2 tabs |

Write the credentials down somewhere. You will use them in every phase.

---

## Day-one check: does `npm run test:worker` actually run here?

**Answered on the original machine (2026-07-27): no.** The Workers suite runs on
`@cloudflare/vitest-pool-workers`, which uses workerd internally, and it fails the same way
the dev server does:

```
MiniflareCoreError [ERR_RUNTIME_FAILURE]: The Workers runtime failed to start.
```

**Consequence: Phase 1 has no local feedback loop there.** Every API check is deploy-and-curl.
Budget accordingly — write endpoints in batches and verify a batch per deploy, rather than
one-at-a-time.

`npx vitest run` (the jsdom suite, 59 tests) works fine and stays your fast loop for anything
client-side.

On a machine where `npm run dev` works, re-run `npm run test:worker` — it should work there,
and Phase 1 gets much quicker.

---

## Phase 0 — Shared extraction

**What you're checking:** that nothing changed. This phase has no visible output; the entire
test is "prove the refactor was inert."

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run deploy
```

Then in the browser — **hard-refresh first** (`Ctrl+Shift+R`). An open tab keeps running the
pre-deploy bundle, and "it's broken" right after a deploy is usually just a stale tab.

| Check | Look for |
|---|---|
| Language toggle | Switch EN ↔ VI, visit 5 different screens. **Any English string appearing in VI mode means a key got dropped in the move** |
| Flip game | Flashcards → a topic → Play → Flip. Swipe a few cards. The drag threshold, tilt, arc, and flick-to-commit must feel **exactly** as before. This is the highest-risk part of Phase 0 |
| Recurrence | Calendar → month view → find a weekly recurring class → confirm it still appears on every expected day |

**A quick objective check on the strings**, since "did any key get lost" is hard to eyeball:
ask for the EN and VI key counts to be printed in the commit message, and check they're equal
to each other and to the pre-refactor count.

### Versioning (Phase 0's other half)

```bash
git rev-list --count HEAD          # the build number, e.g. 42
```

That number must match what the sidebar stamp shows (`v0.0042`). Then:

| Check | How | Expect |
|---|---|---|
| Multi-machine agreement | Clone the repo to a second directory, check out the same commit, build both | **Identical version string.** This is the whole reason the number is derived rather than stored |
| Degrades without git | Temporarily rename `.git`, then `npm run build` | Succeeds, reporting `v0.0000 · dev` — never throws |
| Changelog script | `node scripts/changelog.mjs "test entry"` | Prepends an entry with the *next* number and today's date, stages `CHANGELOG.md`. With no message it refuses |
| Major bump | `node scripts/changelog.mjs --major "test"` | `major` increments in `shared/version.json`; `versionCode` jumps past 10000 |
| Feedback carries it | Submit feedback on the web, open the inbox | `app_version` recorded and displayed |

---

## Phase 1 — JSON API

**This is the phase you can test hardest without a phone.** Everything is curl-able.

After `npm run deploy`:

```bash
BASE=https://calendar.ngqv0712.workers.dev    # or http://localhost:5173 if `npm run dev` works

# 1. Log in, grab a token
curl -s -X POST $BASE/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"YOUR_EMAIL","password":"YOUR_PASSWORD"}'
# → {"data":{"token":"…","user":{…},"expiresAt":"…"}}

TOKEN=<paste the token>

# 2. Authenticated read
curl -s $BASE/api/bootstrap -H "Authorization: Bearer $TOKEN"

# 3. THE critical test — no token must give JSON 401, NOT a 302 to /login
curl -s -i $BASE/api/bootstrap | head -20
```

**On test 3, look at the status line.** If you see `HTTP/2 302` and a `location: /login…`
header, Phase 1's central requirement is not met — the API is still throwing web redirects and
the mobile app will not work. It must be `HTTP/2 401` with a JSON body.

Run the same check on a few more endpoints — `/api/events`, `/api/classes`, `/api/profile`.

**Role enforcement** — log in as each of your three test accounts and try:

| Token | Endpoint | Expect |
|---|---|---|
| Student | `/api/students` | **403** (not a 302 to `/flashcards`) |
| Student | `/api/flashcards/topics` | **200** — students play games |
| Teacher | `/api/assessment-types` | **403** (admin only) |
| Admin | `/api/assessment-types` | 200 |

**Idempotency** — the offline-sync foundation. Post the same result twice:

```bash
curl -s -X POST $BASE/api/flashcards/results -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"results":[{"clientId":"11111111-1111-1111-1111-111111111111","topicId":"<real-id>","mode":"flip","score":3,"total":5}]}'
# Run it again, verbatim. Both must return 200.
```

Then open the web app's Results tab for that topic. **There must be exactly one new row.** If
there are two, the unique index on `client_id` is missing or wrong, and Phase 3's offline sync
will double-count every student's score.

**Then prove the web is unchanged.** Log in through the browser and do the full click-through:
login → dashboard → calendar (create and drag an event) → classes → people → materials →
homework (check one off) → flashcards (play a game) → profile.

---

## Phase 2 — Expo shell

Two loops. Use the fast one for iteration, the slow one for gates.

### Fast loop — Expo Go (seconds)

```bash
cd mobile
npx expo start
```

Scan the QR with Expo Go. Edits hot-reload. Use this for all UI work.

**What Expo Go cannot test:** push notifications (Phase 6), and `expo-secure-store` behaves
differently. Don't sign off a phase on Expo Go alone.

### Slow loop — a real APK (~10–20 min per build)

```bash
cd mobile
eas build -p android --profile preview
```

EAS builds in the cloud and returns a download URL. Open it on your phone, download, install.

**After the first APK, you rarely rebuild.** JS changes ship over the air:

```bash
eas update --branch preview --message "phase 2 nav fix"
```

Force-close and reopen the app to pick it up. You only need a *new APK* when native config
changes — a new native module, a new permission, or an `app.json` plugin change.

### Phase 2 test matrix

| Test | How | Expect |
|---|---|---|
| Login | Your admin account | Lands on Dashboard |
| Session persists | Force-close, reopen | Still signed in, **no login screen flash** |
| Token storage | — | Ask the executor to confirm it's `expo-secure-store`, not AsyncStorage |
| Student role | Log in as your student account | Exactly **2 tabs**: Flashcards, Profile |
| Teacher role | Log in as your teacher account | **5 tabs**, and **no Config row** in More |
| Admin role | Your account | 5 tabs, Config row present |
| Language | Fresh install | Defaults to **Vietnamese**. Toggle to EN, restart, stays EN |
| Round trip | Edit your name on the phone → refresh the web app | New name appears |
| Session expiry | Change your password **on the web** → use the phone | Clean "please sign in again", not a crash |
| Offline | Airplane mode → try any action | Readable error within ~15s, not a permanent spinner |

---

## Phase 3 — Flashcards and offline

### Gesture fidelity

Put your phone and your laptop side by side, same topic, flip mode. Compare directly:

- A tiny movement **flips** the card; a larger one **drags** it.
- The arc and tilt look the same.
- A slow short drag **springs back**; a fast short flick **commits**.
- Dragging **vertically** scrolls and does **not** move the card.
- A drag never *also* flips the card when you release.

The flick threshold is the likeliest bug — Reanimated reports velocity in px/s, the shared
constant is px/ms. If *every* flick commits, or none do, that conversion is wrong.

### The flagship offline test

This is the one test that proves the whole architecture:

1. On the phone, **download** a topic for offline.
2. **Airplane mode on.**
3. Open the topic and complete a full flip game. It must work with no network at all.
4. Check the flashcards tab shows a pending-sync count.
5. **Airplane mode off.**
6. Open the **web** app → that topic → Results tab.

**Exactly one new result row.** Not zero, not two.

Then the harder variants:

- Complete a game offline, **force-close the app**, reopen, reconnect → still exactly one row.
- Complete a game offline, reconnect, and **kill the app mid-sync** → reopen → still exactly one.
- Open an *undownloaded* topic while offline → a clear "not available offline" message, not a
  spinner that never resolves.

### Role correctness

- Play a game as a **student** → web Results shows the student; their mastery stats update.
- Play the same game as **staff** → the result is recorded, but **no mastery row** is created.
  (Staff testing a topic must not pollute student stats.)
- As a student, confirm there is **no** add/edit/delete/import UI anywhere in flashcards.

---

## Phase 4 — Staff core

| Test | Expect |
|---|---|
| **Attendance in two taps** | App launch → today's class → attendance screen. Time it |
| Mark all present | One tap sets everyone; then correct 2–3 exceptions |
| Attendance persists | Save, then check the same event on the web |
| Recurrence agreement | Find a **weekly** class. Its occurrences in the mobile agenda must match the web month view **exactly**. A disagreement here means the shared logic wasn't reused |
| Event CRUD | Create, edit, delete on the phone → verify each on the web |
| Reschedule | Long-press an event → "Move to…" → pick a new time → check the web |
| Event detail tabs | All four (Details, Homework, Materials, Attendance) load and save |
| Document preview | Open a `.docx` material from an event → it opens in a viewer |
| Grading | Grade a homework on the phone → grades appear on the web |
| Layout | **Set your phone display size to its smallest setting**, or test on a 360dp device. No horizontal scrolling, no clipped text, anywhere |

---

## Phase 5 — Remaining surfaces

Mostly a systematic walk. Open every screen, do one create, one edit, one delete, and verify
each on the web.

Specific things worth targeting:

- **Invite code share** — generate a code, share it via the native sheet to Zalo or SMS.
  Then actually redeem it on a second device. This is the real onboarding path.
- **Upload limits** — try a file over 20 MB. It must be refused **before** uploading, with a
  clear message, not after a two-minute wait.
- **Upload progress** — upload a ~10 MB file on mobile data (not wifi). You should see real
  progress, not a frozen spinner.
- **Config gating** — as a **Teacher**, confirm you cannot reach Config. Then try the endpoint
  directly with the teacher's token; it must 403.
- **Drag-reorder** — assessment types reorder by touch-drag (the web version uses HTML5 drag
  events, which don't work on touch at all — this had to be rebuilt).
- **Missing strings** — switch to English, walk every screen, then switch to Vietnamese and walk
  them again. Any untranslated string will jump out.

Ask for `docs/mobile-parity.md` at the end, listing every deliberate omission. Read it — that
document is where scope quietly shrinks if you don't look.

---

## Phase 6 — Push notifications

**You cannot test this in Expo Go.** You need the `preview` or `development` APK.

| Test | How |
|---|---|
| Permission timing | Fresh install → the prompt should appear **after** a meaningful action, not on first launch |
| Delivery with app closed | Trigger a send, **fully close the app**, wait. The notification must arrive on the lock screen |
| Deep links | Tap each notification type — it must open the specific event / homework / topic, not the home screen |
| Channels | Android Settings → Apps → Mochi → Notifications. Three separate channels, independently mutable |
| No duplicates | The class reminder cron runs every 15 min against a 30-min window. **Let it run through at least three ticks for one class and confirm you got exactly one notification** |
| Recurrence | A weekly class must trigger a reminder on each occurrence |
| Digest timing | The daily digest arrives at **08:00 Vietnam time** |
| Preferences | Turn a type off in Profile → confirm it stops |
| Dead tokens | Uninstall the app, trigger a send, then check `push_tokens` — the row should be gone |

**Watching the cron live:**

```bash
npx wrangler tail
```

This streams Worker logs, including scheduled invocations. Observability is already on in
`wrangler.jsonc`.

Ask for a temporary authenticated debug endpoint to trigger each cron job on demand during
development — waiting 15 minutes per iteration is miserable. Then confirm it's **deleted**
before the phase closes.

---

## The garden (student half, 2026-08)

**Sign in as the student** (`vunq@mochi.edu`). Staff see no garden on the phone at all — that is
correct, not a bug (`docs/mobile-parity.md`).

The fastest way to see every visual state is the web's admin dev tools: open `/garden/<classId>` on
the web as an Admin, use the settings icon on the student's card to dial a stage and an idle-day
count, then pull-to-refresh on the phone. That backdates the plant's real last-care day, so what the
phone draws is genuine decay rather than a fake.

| Test | Look for |
|---|---|
| All six stages | Dev-set stage 0→5. Pot, soil and stem must be pixel-identical between stages — only the plant on top changes |
| Wilt | Dial stage 4 + 4 idle days. The plant leans, the leaves droop, and **the whole drawing including the pot is desaturated**. It must NOT look grey-dead |
| Death | Stage 2 + 40 idle days. A snapped stalk, one hanging leaf, one fallen leaf, grey-brown palette |
| Reduced motion | Android Settings → Accessibility → Remove animations, then reopen. No sway, no pop, no confetti — but the wilt **colour** and the lean must still be there. They carry state |
| Round → note | Play a one-word topic through Flip for 1/1. The end panel must read "Your plant grew!" with a small plant above it |
| Capped | Play twice more the same day (the default cap is 2). The third round's note must say the day's growth is spent, not that it grew |
| Missed the bar | Play a longer topic and deliberately score under the threshold. The note must name the percentage it needed |
| Harvest | Dev-set stage 5 → the Harvest button appears → tap. Confetti falls, the plant drops out of frame, "Harvested!", back to Seed, "1 in total", and **the button is gone** |
| Double tap | Tap Harvest twice fast. The second must show "not ready yet", not a crash and not a second fruit |
| Rename | Pencil → a name and a pot colour → Save. The name shows on the widget, and on the student's card in the class garden |
| Offline round | Airplane mode → play a round → **no note appears** (correct: the server has not seen it). Turn the radio back on, wait for the sync, and the widget's stage must go up on its own |
| Day boundary | The one to actually do. Play a round, force-close, set the phone's clock forward past ICT midnight, reopen. The plant must be **re-fetched**, not restored from disk showing yesterday's health |
| Class garden | The cooperative tree with its level and progress bar, then the members **ordered by name** — never by stage or streak. Your own card has a brand border and the second-person wilt note; nobody else's does |
| Album | A saved month opens and shows the frozen garden. Streaks and fruit counts are the frozen ones, not today's |
| Garden push | With the app closed, trigger the 08:00 sweep (`POST /api/push/run?job=garden` as an admin) on a wilting plant. Tapping the notification must land on the vocabulary screen with the widget on top |
| Staff has none | Sign in as `dev@mochi.edu`: no widget, no garden link, and a round played as staff shows no note |

---

## Quick reference

## Confirming an update landed

Phase 0 adds a version stamp to both apps, so this is a two-second check rather than guesswork.

- **Web** — the sidebar, just under the language toggle: `v0.0042 · a1b2c3d`.
- **Mobile** — the More screen footer: `v0.0042 · rt1 · a1b2c3d · <updateId>`.

Compare against `git rev-list --count HEAD` and the top entry of `CHANGELOG.md`. The SHA is the
authoritative identifier — the counter can drift by a commit or two if a push carried several.

**Updates now apply on the first launch.** `lib/updates.ts` checks, downloads and reloads inside the
splash screen the root layout already holds, so: `eas update` → force-close → open → **new**. The
open-twice ritual is gone.

It is bounded — a 3s check budget and a 12s download budget. On a connection too slow for either, the
app launches from cache and the download continues in the background, which lands the update on the
next launch: the old behaviour, as a fallback rather than as the rule. So if a phone still seems a
version behind, suspect the network before suspecting the publish, and check the stamp on the More
screen.

**It does not reload a running app.** An update published while someone has the app open waits for
their next cold start. That is deliberate: `reloadAsync()` mid-round would discard a game the student
had not finished, because an unfinished round has not reached the outbox yet.

`eas update:list --branch preview` shows what's published server-side.

## Quick reference

| Situation | Do this |
|---|---|
| Which version am I on? | Web: sidebar under the language toggle. Mobile: More screen footer |
| Web change won't appear | Hard-refresh (`Ctrl+Shift+R`). Stale bundle in an open tab |
| Mobile change won't appear | Force-close the app **twice**. Stale OTA bundle |
| Phone can't reach Metro | Same wifi? Windows Firewall allowing `node.exe` on Private? |
| Need to know what's actually deployed | Fetch `/assets/manifest-*.js` from the deployed site — it lists the chunks |
| Need a real local server | `npm run dev` if workerd works. Otherwise the Node fallback harness (`node --import ./cf-shim.mjs node-host.mjs`) — ask the operator for its location. Bind either to your LAN IP for the phone |
| Worker logs | `npx wrangler tail` |
| Ship a mobile JS fix | `eas update --branch preview` |
| Ship a mobile native change | `eas build -p android --profile preview` (new APK, ~15 min) |
