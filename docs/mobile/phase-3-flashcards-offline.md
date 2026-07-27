# Phase 3 — Flashcards, gestures, and offline study

**Depends on:** Phase 2
**Touches:** `mobile/` only (plus `shared/logic/` if a helper is missing)
**Risk:** medium — the offline sync path is the only genuinely subtle logic in the project
**Deliverable:** a **complete, shippable student app.** After this phase you could hand the APK
to every student in the school and stop.

## Why this before the staff screens

Three reasons, in order:

1. **It is the entire student experience.** `requireStaff` bounces students to `/flashcards`,
   and `getUser` returns `null` for parents. Students can reach exactly two routes:
   `/flashcards` and `/profile`. Profile shipped in Phase 2. This phase completes them.
2. **It is already touch-native.** `src/flashcards/game-flip.tsx` uses pointer events, ref-held
   gesture state, rAF-coalesced painting, pointer capture, and scroll-direction arbitration.
   That is Reanimated's model, written in DOM. The port is close to a transliteration.
3. **It is the only surface where offline genuinely matters.** A student on a bus with patchy
   signal should be able to study. A teacher taking attendance is standing in their own
   classroom on wifi.

---

## Task 3.1 — Screens

Port from `src/flashcards/`. Note `topic.tsx` is 856 lines and bundles four concerns — **split
it** rather than reproducing the monolith.

| Mobile route | Source | Notes |
|---|---|---|
| `/(tabs)/flashcards` | `src/flashcards/index.tsx` (227) | Topic cards grid. Topic create/edit **staff only** |
| `/flashcards/[slug]` | `topic.tsx` → Words/Results tabs | Top tabs, not the web's inline tabs |
| `/flashcards/[slug]/word/[id]` | `topic.tsx` → `WordModal` | Full screen, not a modal |
| `/flashcards/[slug]/import` | `topic.tsx` → `ImportModal` | Bulk paste. **Staff only** |
| `/flashcards/[slug]/play/[mode]` | `game-flip/quiz/match.tsx` | Full-screen, tab bar hidden |

The web's `GameOverlay` is a `position: fixed; inset: 0; z-index: 200` wrapper — the one place
the web app already behaves like an app. On mobile this is just a route with the tab bar
hidden and the status bar dimmed.

**Lists:** use `@shopify/FlashList`, not `ScrollView`. A topic can hold 200 words.

**Role gating:** hide word/topic/import mutation UI when `user.kind !== 'staff'`. The API
returns 403 regardless — the client gate is cosmetic, the server is the enforcement.

---

## Task 3.2 — The flip-card gesture

The centrepiece. Rebuild `src/flashcards/game-flip.tsx` (418 lines) with
`react-native-gesture-handler` + `react-native-reanimated`, reusing the constants and
predicates extracted into `@shared/logic/flip-gesture` in Phase 0.

### Mapping the web implementation

| Web | React Native |
|---|---|
| `onPointerDown/Move/Up/Cancel` | `Gesture.Pan()` |
| `gesture = useRef<Gesture>(…)` (state off the render path) | `useSharedValue` (state on the UI thread) |
| `requestAnimationFrame(paint)` mutating `el.style.transform` | `useAnimatedStyle` — no manual rAF needed |
| `setPointerCapture(e.pointerId)` | automatic once the pan activates |
| `touchAction: 'pan-y'` + manual `if (|dyRaw| > |dx|) bail` | `.activeOffsetX([-8,8]).failOffsetY([-8,8])` |
| `suppressClick` ref to stop a drag also flipping the card | `Gesture.Exclusive(pan, tap)` |
| `userSelect: 'none'` (commit `e9f3d43`) | not needed — no text selection in RN |
| `overflowX: 'clip'` on `playWrap` (commit `1a44469`) | not needed — RN clips by default |

Three web workarounds simply disappear. **Do not port them.**

### The animation

```ts
const dx = useSharedValue(0);
const cardStyle = useAnimatedStyle(() => ({
  transform: [
    { translateX: dx.value },
    { translateY: -Math.min(MAX_LIFT_PX, dx.value * dx.value * ARC_K) },  // pendulum arc
    { rotate: `${clamp(dx.value * ROT_PER_PX, -MAX_ROT_DEG, MAX_ROT_DEG)}deg` },
  ],
}));
```

`arcLift` and `arcRotation` from `@shared/logic/flip-gesture` must be marked `'worklet'` to run
on the UI thread — either add the directive in the shared file (harmless on web) or inline the
two expressions here and keep the shared file as the numeric source of truth. **Prefer
inlining**; do not add React Native concepts to `shared/`.

### Commit heuristic

On pan end, call `shouldCommit(dx, vx, cardWidth)` — same distance-or-flick rule as the web
(`|dx| > width * 0.35`, or `|vx| > 0.5 px/ms` in a consistent direction with `|dx| > 24`).
Reanimated's `onEnd` gives `velocityX` in **px/s**; the shared constant is **px/ms**. Divide by
1000. Getting this wrong makes every flick commit, or none — it is the most likely bug in the
phase.

On commit: `withTiming` the card off-screen over `EXIT_MS` (280ms), then `runOnJS(mark)`.
On abort: `withSpring` back to zero.

### The rest

- **Tinder badges** — "known" / "unknown" opacity driven from `dx` in a `useAnimatedStyle`,
  proportional to drag progress. Same as the web's imperative `paint()`.
- **Card entry** — the web injects an `fc-card-in` CSS keyframe and remounts via `key={w.id}`.
  On mobile use Reanimated's `entering={FadeInDown}` on a keyed card.
- **Haptics** — `expo-haptics` `impactAsync(Light)` on commit. Free polish the web cannot have.

### Quiz and match

`game-quiz.tsx` (160) and `game-match.tsx` (195) use plain `onClick` and port to `Pressable`
with essentially no thought. Do them first as a warm-up; do flip last.

---

## Task 3.3 — Audio

Port `src/flashcards/audio.ts`: play `audioUrl` if present, else fall back to speech synthesis.

| Web | Mobile |
|---|---|
| `new Audio(url).play()` | `expo-av` `Audio.Sound.createAsync({ uri })` |
| `speechSynthesis` + `SpeechSynthesisUtterance({ lang:'en-US', rate:0.9 })` | `expo-speech` `Speech.speak(word, { language:'en-US', rate: 0.9 })` |

- Set the audio mode so playback works with the **ringer switch on silent** and ducks other
  audio: `Audio.setAudioModeAsync({ playsInSilentModeIOS: true, shouldDuckAndroid: true })`.
- **Unload sounds on unmount.** `expo-av` leaks native players otherwise, and a 200-word session
  will exhaust them.
- Cache fetched audio files to the local filesystem so offline study keeps pronunciation.
  `expo-speech` needs no network and is the fallback when the cached file is missing.

---

## Task 3.4 — Offline study

The one genuinely subtle piece. Two independent mechanisms: a **content store** (read path) and
an **outbox** (write path). Do not conflate them.

### Content store — read path

Topics are small: `FlashcardImportInput` caps a bulk import at 200 words
(`shared/schemas.ts:233`), and a topic is a handful of KB. **Do not build a sync engine.** Use
`expo-sqlite` with a single blob-per-topic table:

```sql
CREATE TABLE offline_topics (
  topic_id   TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  payload    TEXT NOT NULL,   -- JSON: the exact /api/flashcards/topics/:slug response
  synced_at  TEXT NOT NULL
);
```

- **Explicit control, not magic.** A download toggle on each topic card. Users on metered
  Vietnamese mobile data should decide what to download.
- Auto-refresh a downloaded topic when the app is foregrounded and online, silently.
- Show `synced_at` as "Updated 2 hours ago" on the topic card so stale content is never a
  mystery.
- On topic open: if offline, read from `offline_topics`; if not downloaded, show a clear
  "Not available offline" state — never an empty screen or a spinner that never resolves.

### Outbox — write path

```sql
CREATE TABLE outbox (
  client_id  TEXT PRIMARY KEY,   -- UUID generated on the device
  payload    TEXT NOT NULL,      -- JSON FlashcardResultInput, including clientId
  created_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);
```

Flow:

1. Game ends → generate a UUID → write one `outbox` row → **update the local UI immediately**
   (the student sees their score regardless of connectivity).
2. Flush on: app foreground (`AppState` → `'active'`), `NetInfo` reconnect, and immediately
   after a game if online.
3. Flush = `POST /api/flashcards/results` with `{ results: [...] }`, batched (max 50, per
   `FlashcardResultBatch`).
4. **Delete rows only on a confirmed 2xx.** On failure, increment `attempts` and back off
   exponentially. Never delete on a network error.
5. **Idempotency is server-side.** The unique partial index on `flashcard_results.client_id`
   from Phase 1 means a duplicate POST is a no-op. The outbox can therefore retry blindly —
   this is why the client never needs to reason about whether a result "already went through."

> **This is the design's load-bearing decision.** Without `client_id`, a flush that succeeds on
> the server but fails to return (dropped connection — common on mobile) would be retried and
> double-count the student's score. With it, retrying is always safe. Verify the index exists
> before writing any outbox code.

### UI

- A persistent offline banner when `NetInfo` reports no connection.
- A pending-sync count ("3 results waiting to sync") visible on the flashcards tab.
- Never block gameplay on connectivity. Ever.

---

## Task 3.5 — Results and mastery

The Results tab reads `flashcard_results` and `flashcard_mastery`. Two details from
`server/db/schema.ts` that are easy to get wrong:

- `flashcard_results` has **both** `student_id` and `staff_id`, each nullable. Staff plays are
  recorded (commit `cdaee23`). Exactly one is set per row.
- `flashcard_mastery` is keyed `(student_id, word_id)` — **staff plays produce no mastery row.**
  A teacher testing a topic must not pollute mastery stats.

Charts: `src/components/charts.tsx` hand-rolls `ProgressLineChart` and `StackedBarChart` in
SVG. They port to `react-native-svg` with near-identical code — same path math, different
element names.

---

## Acceptance criteria

**Gesture fidelity** — test on a physical device, side by side with the web app:
- [ ] Drag slop matches: a small movement flips the card, a larger one starts a drag.
- [ ] The pendulum arc and tilt look identical.
- [ ] A slow short drag springs back; a fast flick commits. **Verify the px/s → px/ms
      conversion** by flicking at the threshold.
- [ ] Vertical drags scroll the page and do **not** move the card.
- [ ] A drag never also flips the card on release.

**Offline:**
- [ ] Download a topic, enable airplane mode, open it, complete a flip game.
- [ ] Reconnect → the result appears in the web Results tab **exactly once**.
- [ ] Kill the app mid-flush, relaunch, reconnect → still exactly one row.
- [ ] Force a flush failure (bad token), confirm the outbox row survives and retries.
- [ ] An undownloaded topic opened offline shows a clear message, not a spinner.

**Correctness:**
- [ ] A **student** completing a game creates a result with `student_id` set, `staff_id` null,
      and mastery rows updated.
- [ ] A **staff** member completing a game creates `staff_id` set, `student_id` null, and
      **no** mastery rows.
- [ ] Students see no create/edit/delete/import UI anywhere in flashcards.
- [ ] Audio plays; with the ringer on silent it still plays; with no `audioUrl` speech fires.
- [ ] All three games playable; scores match the web for the same answers.
- [ ] Every string is translated in both EN and VI.
- [ ] Committed and pushed to `main`; `eas update --branch preview` shipped.

## Notes for the executor

- Port **quiz → match → flip**, in that order. The first two are trivial and get the screen
  scaffolding, navigation, and results plumbing right before you touch the hard gesture.
- Do not "improve" the gesture tuning. Those eight constants are the result of real iteration
  (commits `24c4b28`, `e9f3d43`, `1a44469`). If the mobile version feels different, the port is
  wrong — do not compensate by changing the numbers.
- `expo-sqlite`'s modern API is async (`openDatabaseAsync`, `runAsync`, `getAllAsync`). Older
  tutorials show a deprecated callback API. Use the async one.
