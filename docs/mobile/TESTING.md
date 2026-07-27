# How to test each phase yourself

Hands-on verification for each phase: exact commands, what to click, what failure looks like.

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

## Quick reference

## Confirming an update landed

Phase 0 adds a version stamp to both apps, so this is a two-second check rather than guesswork.

- **Web** — the sidebar, just under the language toggle: `v0.0042 · a1b2c3d`.
- **Mobile** — the More screen footer: `v0.0042 · rt1 · a1b2c3d · <updateId>`.

Compare against `git rev-list --count HEAD` and the top entry of `CHANGELOG.md`. The SHA is the
authoritative identifier — the counter can drift by a commit or two if a push carried several.

**The OTA gotcha:** Expo's default is `checkAutomatically: ON_LOAD` — it downloads the new
bundle in the background and applies it on the **next** launch. So: `eas update` → force-close →
open (*still old*, downloading) → force-close → open (**now** new). Open-twice is normal.

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
