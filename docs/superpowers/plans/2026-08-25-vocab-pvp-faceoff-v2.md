# PvP fix pass + face-off Race mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the defects the verification pass found in the shipped PvP commit (`0be6069`), then turn the tabletop face-off into two selectable games: the existing **Duel** (shared question, first to 5, a wrong tap sits out that question) and a new **Race** (preset question count, shared countdown, each player advancing independently — a wrong tap costs only the tapper).

**Task order is by severity, not by feature.** Tasks 1–5 fix code that is live in production right now; Tasks 6–9 are the new Race mode. Do not reorder: Task 1 is a user-visible break and Task 2 may be taking the main vocabulary page down.

**Architecture:** Game rules stay pure in `shared/logic/pvp.ts` — Race gets its own state type and reducer (`RaceState` / `raceAnswer` / `raceTimeUp`) rather than overloading `faceoffAnswer`, because the two games differ in the one thing that matters: Duel has ONE shared question index, Race has one per side. The face-off screen branches on mode and reuses the same rotated-half and divider components, which become mode-agnostic (they take a question, a fill fraction and a blocked flag).

**Tech Stack:** Cloudflare Durable Objects, React Router 7, Drizzle/D1, pure TS in `shared/logic/`, vitest, Playwright. Face-off is web-only by design (`docs/mobile-parity.md`).

**Spec:** `docs/superpowers/specs/2026-08-25-vocab-pvp-design.md` — the face-off decision section. **Two parts of it are WRONG and this plan corrects them** (Task 1: the rotation mapping; Task 8: it describes only one face-off game).

## Global Constraints

- **Never run test suites.** Forbidden: `npm test`, `npm run test:worker`, `npm run test:e2e`, `npm run test:e2e:staging`, `npm run test:env:setup`, `cd mobile && npm run test:bundle`, `cd mobile && npm run test:device`. Write the specs; the user runs the suites.
- **Free checks you MUST run**: `npm run typecheck`, `npm run lint`, `npm run check:i18n`, `npm run format` (only your own files' hunks — CRLF tree), and `cd mobile && npm test` if you touch anything under `mobile/`.
- **`cd` does not persist between tool calls in this environment.** Verify `pwd` before every command; a `cd mobile && npm test` that silently runs from the repo root fires the forbidden root suite. This happened during the last run.
- No paid APIs (`/enrich-vocab`, `/generate-vocab`, `/vocab-image-generate`, `/speech-assess`). `pronounce` stays out of every PvP surface.
- i18n: every new user-facing string gets `en` + `vi` keys in `shared/i18n/strings.ts`; `check:i18n` must pass. Literal key strings only — a computed `t('prefix_' + x)` fails the checker (copy the `errorMessageKey` pattern in `battle.tsx`).
- Every new query stays tenant-scoped through `TenantDb` `own`/`pool`.
- Never `wrangler deploy` (Workers Builds owns deploys) and never `wrangler login` (global credential — it would evict the other account).
- **Commit per task; push ONCE at the end**, then run the ship checklist in Task 10. Pushing per task would trigger a deploy and an OTA publish per commit.

---

### Task 1: Fix the swapped face-off rotation (Critical)

Two independent derivations agree the two halves' rotations are swapped, so each player reads their OWN board upside-down. It survived review because both halves ARE rotated 90°, so text runs along the right axis and a screenshot looks plausible.

The geometry, so it is not re-broken: screen `+x` is right, `+y` is down; CSS `rotate(+N)` is clockwise; text is upright for a reader when the baseline→top vector points AWAY from them. The player at the LEFT edge looks in `+x`, so their letter tops must point `+x`, and only `rotate(90deg)` sends tops `(0,−1)` to `(+1,0)`. The RIGHT-edge player is the mirror: `rotate(-90deg)`.

**Files:**
- Modify: `src/flashcards/faceoff.tsx` (the two `<FaceoffHalf>` call sites and the component's header comment)
- Modify: `docs/superpowers/specs/2026-08-25-vocab-pvp-design.md`, `docs/superpowers/plans/2026-08-25-vocab-pvp.md`, `docs/superpowers/plans/2026-08-25-vocab-pvp-verify.md` (all three assert the swapped mapping)

- [ ] **Step 1: Swap the two values.** `side={1}` takes `rotateDeg={90}`, `side={2}` takes `rotateDeg={-90}`.
- [ ] **Step 2: Correct the prose in all three documents** so they state left = `rotate(90deg)`, right = `rotate(-90deg)`, and record the rule that keeps it fixed: *the letter tops point away from the player, so the left-edge player needs tops pointing right.* The old files assert the inverse rule ("a rotated box's top edge points at its reader"), which is what produced the bug — delete that sentence, do not soften it.
- [ ] **Step 3: `npm run typecheck` + `npm run lint`** → clean.
- [ ] **Step 4: Commit** `fix(pvp): face-off halves were rotated away from their players, not toward them`

---

### Task 2: Stop the ladder read taking /vocabulary down (Critical)

`loadGarden`, `loadReview` and `loadTuiMu` each sit in a try/catch returning null, and `flashcards.tsx` states why: "a deploy can reach the edge minutes before its D1 migration does, and /vocabulary is the flashcards screen first". `monthLadder` — reading `pvp_matches`, a table introduced in the very same commit — was added to that `Promise.all` **unguarded**. The worker is already live in production (`/game-ws` answers `426` there); if `0055_pvp.sql` has not been applied, every visit to the main vocabulary page throws a 500 for staff and students alike.

Second defect, same file: `ladderFromMatches` documents its daily cap as "the first `PVP_LADDER_DAILY_CAP` matches (chronological)" and its own comment admits it "relies on the caller's row order being chronological" — but `monthLadder` never orders. For a student past 10 matches in one ICT day, WHICH ten count is whatever order SQLite returns, and since a win is 3 points and a loss 1, the same rows can total differently between reads.

**Files:**
- Modify: `app/routes/flashcards.tsx`, `server/services/pvp.ts`

- [ ] **Step 1: Order the query.** Add `.orderBy(asc(pvpMatches.playedAt))` to `monthLadder` (import `asc` from `drizzle-orm`).
- [ ] **Step 2: Wrap the read** in the same degrade-to-null shape as its three siblings:

```ts
/** Same posture as loadGarden: this page is the topics list first, and a ladder is not worth a
 *  500 while a migration is still catching up with a deploy. */
async function loadLadder(db: TenantDb): Promise<LadderRow[]> {
  try {
    return await monthLadder(db, currentIctMonth());
  } catch (err) {
    console.error('pvp ladder unavailable on /vocabulary', err);
    return [];
  }
}
```

  Call `loadLadder(db)` in the `Promise.all` instead of `monthLadder(...)`. The card already renders nothing for an empty ladder, so `[]` needs no UI change.
- [ ] **Step 3: `npm run typecheck` + `npm run lint`** → clean.
- [ ] **Step 4: Commit** `fix(pvp): order the ladder query and stop it taking /vocabulary down`

---

### Task 3: GameRoom correctness (Important)

Six defects in `workers/game-room.ts`, all found by adversarial review of the shipped DO. The hibernation discipline, the alarm chain, the reconnect deadline, the disconnect handling and the persistence order were all verified CORRECT — do not disturb them.

**Files:**
- Modify: `workers/game-room.ts`, `test-worker/game-room.test.js`

- [ ] **Step 1: Send `lobby` to any socket joining mid-game.** `handleConnect`'s `question` and `reveal` branches send only that one message, and `applyServerMsg` recovers config with `'config' in view ? view.config : ({} as RoomConfig)`. A client that mounts fresh mid-game (page refresh, app relaunch) starts at `{phase:'connecting'}`, so config becomes `{}` — and `{} as RoomConfig` means TypeScript cannot see it. The damage is silent and real: `secondsPerQuestion` is `undefined` so the countdown bar computes `width: "NaN%"`, the header reads "Question 3 of undefined", and at finish the student posts to `/vocabulary/undefined` with `topicId: undefined` — **the round is never recorded, losing the mastery and garden write that the DO's own docstring says the design depends on.** Fix: in every non-lobby branch, `sendTo(server, { type: 'lobby', … })` first (it carries code, config, players and hostId), then the phase message. Order matters — the reducer takes config from the previous view.
- [ ] **Step 2: Answer a `done`-phase reconnect.** There is no `done` branch, yet the connect still returns 101, so the client sits on "Connecting…" forever with no error and no way out. It is reliably reachable: the finish+60s alarm closes every socket, and both clients treat a close they did not initiate as reconnectable. The same gap permanently defeats that cleanup — sockets re-accumulate and no further alarm is armed. Add: `else if (room.phase === 'done') this.sendTo(server, { type: 'finish', standings: this.standingsOf(players) });`
- [ ] **Step 3: Refuse answers after the deadline.** The `answer` branch checks phase and index but not the clock, and `phase` stays `question` until the alarm actually *fires* — Cloudflare alarms are eventual, and a hibernated object must be woken first. An answer landing in that window is scored `speedPoints(room.deadline - a.ms, totalMs)`; `speedPoints` clamps a negative `msLeft` to zero bonus, so it still banks the **full 500 base points** while a classmate who honestly ran out of time gets nothing. Add `if (Date.now() > room.deadline) return;` after the phase/index check.
- [ ] **Step 4: Make `revealStep` idempotent and the alarm self-healing.** Its scoring loop does `player.score += …` unconditionally, so a second run for the same `qIndex` double-awards; and `deleteAlarm()` cannot cancel an alarm that has already fired, so a queued `alarm()` can land right after an early-advance, read `phase === 'reveal'` and jump to the next question milliseconds into what should be a 4-second reveal — players never see the answer. Three lines:
  - `if (room.phase !== 'question') return;` at the top of `revealStep`;
  - persist the reveal's end as the room's `deadline` (`{ ...room, phase: 'reveal', deadline: revealDeadline }`);
  - in `alarm()`, before dispatching on phase: `if (Date.now() < room.deadline - 50) { await this.ctx.storage.setAlarm(room.deadline); return; }` — an alarm that arrives early re-arms itself instead of advancing the game.
  The existing `deleteAlarm()` becomes redundant; leave or drop it, but say which in the commit.
- [ ] **Step 5: Validate the submitted option.** `msg.option` is written straight to storage, so an authenticated student can post a 200 KB string, blow the 128 KiB per-value storage limit and throw out of `webSocketMessage`. With the question already loaded for Step 3: `if (typeof msg.option !== 'string' || !q.wire.options.includes(msg.option)) return;`
- [ ] **Step 6: Free a finished room's storage.** The `done` alarm branch closes sockets and returns — no `deleteAll()`, no further alarm — and the 2h expiry branch below it is unreachable for a done room. Every played match leaves `room`, `questions`, `players` and `answers:0…N` in its DO permanently. Add `await this.ctx.storage.deleteAll()` after closing the sockets. **Land this after Step 2**, or a late reconnect turns the spinner into a 404.
- [ ] **Step 7: Extend `test-worker/game-room.test.js`.** The existing reconnect test passes while Step 1's bug is live because it only asserts a `question` message arrives — tighten it and add the rest: a mid-game reconnect receives a `lobby` carrying `config.topicId` and `config.secondsPerQuestion` before its `question`; a reconnect to a finished room receives `finish`; an answer sent after `room.deadline` scores nothing; an option that is not in the question's own list is ignored. Do NOT run the suite.
- [ ] **Step 8: `npm run typecheck` + `npm run lint`** → clean. Report that `npm run test:worker` covers this and was not run.
- [ ] **Step 9: Commit** `fix(pvp): mid-game joins, late answers, reveal races and room cleanup in GameRoom`

---

### Task 4: Report a refused room code as a refused room code (Important)

`GameRoom` answers an unknown code with HTTP 404, a full lobby with 403 and a started game with 409 — but no client can read the status of a *failed* WebSocket handshake; it only sees close code 1006. Both clients then burn all three reconnect attempts (1s + 2s + 4s) and show `connection_lost`. So `pvp_error_not_found`, `pvp_error_already_started` and `pvp_error_full` are unreachable dead protocol, and a student who mistypes one character stares at a spinner for ~7 seconds and is then told the connection dropped.

**Files:**
- Modify: `workers/game-room.ts`, `src/lib/game-socket.ts`, `mobile/lib/game-socket.ts`, `mobile/test/game-socket.test.ts`, `test-worker/game-room.test.js`

- [ ] **Step 1: Say it over the socket, server-side.** For those three refusals, accept the socket, `sendTo(server, { type: 'room-error', code })`, return the 101, then close. That makes the existing protocol and both clients' existing error copy actually reachable — no new strings needed.
- [ ] **Step 2: Update the DO test.** `test-worker/game-room.test.js` currently asserts the 404 and 403 statuses; those become a 101 plus a `room-error` message. Same commit.
- [ ] **Step 3: Still distinguish a refused upgrade client-side**, for the cases that never reach Step 1 (a 401, a 426, the worker being down). Extract the decision as a pure function rather than burying it in a callback:

```ts
/** What a close means: retry after `delayMs`, or give up with this error code. */
export function closeOutcome(
  everOpened: boolean,
  attempt: number,
): { retryInMs: number } | { errorCode: 'not_found' | 'connection_lost' } {
  if (!everOpened && attempt === 0) return { errorCode: 'not_found' };
  const delay = backoffDelay(attempt);
  return delay === null ? { errorCode: 'connection_lost' } : { retryInMs: delay };
}
```

  Track whether `onopen` ever fired; only a socket that HAD opened earns the reconnect backoff.
- [ ] **Step 4: Add mobile tests** for `closeOutcome` (refused-on-first-attempt → `not_found`; opened-then-closed → 1000/2000/4000 → `connection_lost`). `pwd && cd mobile && npm test` → PASS. This suite is free; the root one is not.
- [ ] **Step 5: Mirror the helper on the web client.** `src/lib/game-socket.ts` has no `backoffDelay` of its own — it indexes `RECONNECT_DELAYS_MS` inline — so give it the same two small functions rather than importing across the web/mobile boundary (those two files deliberately share no code; only `shared/logic/pvp.ts` is shared).
- [ ] **Step 6: `npm run typecheck`, `npm run lint`, `pwd && cd mobile && npx tsc --noEmit`** → clean.
- [ ] **Step 7: Commit** `fix(pvp): a refused room code says so instead of timing out`

---

### Task 5: An escape hatch during face-off play (Important)

The play step is `position: fixed; inset: 0` on a route outside the `_app` layout and renders NO exit control — only setup and finish have one. An abandoned duel traps the tablet: the only ways out are the browser back button (often not visible on a classroom tablet) or playing to the end.

**Files:**
- Modify: `src/flashcards/faceoff.tsx`, `shared/i18n/strings.ts`

- [ ] **Step 1: Put the control in the divider.** The divider is the one region belonging to neither player and is already unrotated, so it is the honest home for a neutral control. Add an icon button at the BOTTOM of the divider column, below the scores: 44px minimum touch target, `MIcon name="x"`, `aria-label` from a new `pvp_faceoff_quit` key. Pass an `onQuit` prop into `Divider` rather than reaching for the navigate closure inside it.
- [ ] **Step 2: Confirm before leaving.** Abandoning forfeits a match in progress, so route it through `useConfirm` from `../ui.jsx` (title `pvp_faceoff_quit`, message `pvp_faceoff_quit_msg`, `danger: true`, confirm label the shared `fc_exit`). Its modal renders unrotated and centred — sideways to both players but upright for the teacher at a long edge, which is the right audience for an abort.
- [ ] **Step 3: Navigate by slug.** All three exits currently use `topic.id`, which resolves (`getTopicBySlug` matches id OR slug) but leaves a UUID in the URL. Widen the loader's `LoaderData` to carry `slug` and use `topic.slug ?? topic.id` in all three.
- [ ] **Step 4: Escape key too.** A `useEffect` keydown listener on `window` while `step === 'play'`, firing the same confirm; removed on unmount and on step change.
- [ ] **Step 5: i18n.** `pvp_faceoff_quit` ("Quit match" / "Thoát trận") and `pvp_faceoff_quit_msg` ("Leave this match? Neither player gets the win." / "Thoát trận này? Sẽ không ai được tính thắng.") in BOTH `en` and `vi`.
- [ ] **Step 6: `npm run typecheck`, `npm run lint`, `npm run check:i18n`** → clean.
- [ ] **Step 7: Commit** `feat(pvp): a way out of a face-off in progress`

---

### Task 6: Race rules as pure logic

**Files:**
- Modify: `shared/logic/pvp.ts`, `test/pvp.test.ts`

**Interfaces (Produces — Task 7 imports these exact names):**

```ts
/** Race mode: a preset question count, a shared countdown, independent progress. */
export const RACE_QUESTION_COUNTS = [10, 15, 20] as const;
export const RACE_DEFAULT_QUESTIONS = 10;
export const RACE_SECONDS_CHOICES = [60, 90, 120] as const;
export const RACE_DEFAULT_SECONDS = 90;
/**
 * A wrong tap costs the tapper this long, and nobody else. Without a cost, four-way
 * spam-tapping finishes a race instantly and the mode measures thumb speed, not vocabulary;
 * with a SHARED lockout it would stall the opponent, which is exactly what this mode exists
 * to avoid. A self-only cooldown is the one option that satisfies both.
 */
export const RACE_WRONG_PENALTY_MS = 1500;

export type RaceState = {
  /** Each side's own index into the SHARED question list — both face the same questions in the
   *  same order (fairness), each at their own position. */
  progress: { 1: number; 2: number };
  /** Epoch ms until which that side's taps are ignored. Self-only; see RACE_WRONG_PENALTY_MS. */
  blockedUntil: { 1: number; 2: number };
  totalQuestions: number;
  finished: boolean;
  /** Set when finished; null while running AND on a finished draw. */
  winner: FaceoffSide | null;
};

export function newRace(totalQuestions: number): RaceState;
// { progress: {1:0,2:0}, blockedUntil: {1:0,2:0}, totalQuestions, finished: false, winner: null }

/** One tap. Ignored when finished or while that side is cooling down. Correct advances ONLY
 *  that side (reaching totalQuestions finishes the race with them as winner); wrong starts
 *  that side's cooldown and touches nothing else. `now` is passed in so this stays pure. */
export function raceAnswer(s: RaceState, side: FaceoffSide, correct: boolean, now: number): RaceState;

/** The countdown expired: whoever got further wins, equal progress is a draw (winner null). */
export function raceTimeUp(s: RaceState): RaceState;
```

- [ ] **Step 1: Write the failing tests** in `test/pvp.test.ts`, beside the existing `faceoffAnswer` block:

```ts
describe('raceAnswer', () => {
  it('advances only the side that answered correctly', () => {
    const s = raceAnswer(newRace(10), 1, true, 1000);
    expect(s.progress).toEqual({ 1: 1, 2: 0 });
    expect(s.finished).toBe(false);
  });

  it('starts a self-only cooldown on a wrong tap and leaves the opponent free', () => {
    const s = raceAnswer(newRace(10), 1, false, 1000);
    expect(s.progress).toEqual({ 1: 0, 2: 0 });
    expect(s.blockedUntil[1]).toBe(1000 + RACE_WRONG_PENALTY_MS);
    expect(s.blockedUntil[2]).toBe(0);
    // The opponent can still score while side 1 is cooling down — the whole point of the mode.
    expect(raceAnswer(s, 2, true, 1100).progress).toEqual({ 1: 0, 2: 1 });
  });

  it('ignores a tap from a cooling-down side, and accepts it after the penalty', () => {
    const s = raceAnswer(newRace(10), 1, false, 1000);
    expect(raceAnswer(s, 1, true, 1000 + RACE_WRONG_PENALTY_MS - 1)).toBe(s);
    expect(raceAnswer(s, 1, true, 1000 + RACE_WRONG_PENALTY_MS).progress[1]).toBe(1);
  });

  it('finishes with that side as winner on the last question', () => {
    let s = newRace(3);
    for (let i = 0; i < 3; i++) s = raceAnswer(s, 2, true, 1000 + i);
    expect(s).toMatchObject({ finished: true, winner: 2 });
    expect(s.progress[2]).toBe(3);
  });

  it('is a no-op once finished', () => {
    const s = raceAnswer(newRace(1), 1, true, 1000);
    expect(raceAnswer(s, 2, true, 2000)).toBe(s);
  });
});

describe('raceTimeUp', () => {
  it('gives the win to whoever got further', () => {
    const s = raceTimeUp(raceAnswer(newRace(10), 1, true, 1000));
    expect(s).toMatchObject({ finished: true, winner: 1 });
  });

  it('calls equal progress a draw', () => {
    expect(raceTimeUp(newRace(10))).toMatchObject({ finished: true, winner: null });
  });

  it('leaves an already-finished race alone', () => {
    const s = raceAnswer(newRace(1), 1, true, 1000);
    expect(raceTimeUp(s)).toBe(s);
  });
});
```

- [ ] **Step 2: Watch them fail.** `npm run typecheck` fails on the missing exports — that IS the red state for a plain-TS module. Do not run `npm test`.
- [ ] **Step 3: Implement** the interface above under a new `// ---- Race mode ----` heading below the face-off block. Keep the reducers total and reference-stable: return the SAME object (`return s`) for an ignored tap, which is what the `toBe(s)` assertions pin.
- [ ] **Step 4: `npm run typecheck` + `npm run lint`** → clean. Report that `npm test` covers `test/pvp.test.ts` but was not run.
- [ ] **Step 5: Commit** `feat(pvp): race mode rules and scoring`

---

### Task 7: The Race mode screen and the mode picker

**Files:**
- Modify: `src/flashcards/faceoff.tsx`, `shared/i18n/strings.ts`

**Interfaces:**
- Consumes: everything from Task 6; `newFaceoff`/`faceoffAnswer` unchanged for Duel; the exit control from Task 5.

- [ ] **Step 1: Generalise the two shared pieces** so one set serves both games:
  - `FaceoffHalf` keeps its per-side `question` prop (Race hands each half a different one). Rename `locked` → `blocked` and add `blockedLabel: string`, so Duel can say "wrong, wait for the next question" while Race says "try again in a moment".
  - `Divider` takes `fill1: number`, `fill2: number` (each 0..1), `centerLabel: string`, plus the `onQuit` from Task 5 — instead of computing points-to-target itself. Duel passes `score / FACEOFF_TARGET` and `"3/13"`; Race passes `progress / totalQuestions` and the seconds remaining.
- [ ] **Step 2: Add the mode choice to the setup step**, above the player pickers, as two large option rows (same shape as the Battle dialog's room/face-off choice):
  - `pvp_faceoff_mode_duel` — "Duel — first to 5" / "Đấu tay đôi — đến 5 điểm", sub `pvp_faceoff_mode_duel_sub` ("Both players get the same question. A wrong tap sits out the rest of it." / "Cả hai cùng một câu. Trả lời sai thì bỏ qua câu đó.")
  - `pvp_faceoff_mode_race` — "Race — first to finish" / "Đua nước rút — ai xong trước", sub `pvp_faceoff_mode_race_sub` ("Each player runs their own questions against the clock. A wrong tap only costs you." / "Mỗi người tự chạy câu của mình theo đồng hồ. Trả lời sai chỉ mình bạn mất lượt.")
  Race additionally shows a question-count picker (`RACE_QUESTION_COUNTS`, default `RACE_DEFAULT_QUESTIONS`) and a duration picker (`RACE_SECONDS_CHOICES`, default `RACE_DEFAULT_SECONDS`). Duel keeps its fixed rules and shows no pickers.
  Race needs its own cooldown message, distinct from Duel's `pvp_faceoff_locked`: add `pvp_race_cooldown` — "Wrong — try again in a moment…" / "Sai rồi — thử lại ngay…" — passed as `blockedLabel`.
- [ ] **Step 3: Race play state.** On Start, build the questions once, then the race from what actually exists, plus a deadline:

```tsx
// buildQuizQuestions caps the round at the DECK size, so a 6-word topic yields 6 questions
// even when 10 were asked for. Seed the race from questions.length, never from the picker,
// or totalQuestions promises a question that is not there.
const qs = buildQuizQuestions(words, questionCount);
setQuestions(qs);
setRace(newRace(qs.length));
setDeadline(Date.now() + seconds * 1000);
```

  Each half renders `questions[race.progress[side]]`; a tap calls
  `setRace((r) => raceAnswer(r, side, option === q.answer, Date.now()))`. The countdown needs a
  tick, and the expiry must settle exactly once:

```tsx
React.useEffect(() => {
  if (step !== 'play' || mode !== 'race' || deadline === null) return;
  const id = setInterval(() => {
    setNow(Date.now());
    // raceTimeUp returns the same object once finished, so a double tick cannot double-settle.
    if (Date.now() >= deadline) setRace((r) => raceTimeUp(r));
  }, 200);
  return () => clearInterval(id);
}, [step, mode, deadline]);
```

  A separate effect moves to the finish step when `race.finished` turns true, so both endings — someone finished, or the clock ran out — land in one place.
- [ ] **Step 4: Keep the finish step working for both.** It reads `winner` and a score pair; give Race an equivalent shape at the call site (scores from `progress`) or branch. A draw still shows `pvp_draw` and posts nothing.
- [ ] **Step 5: i18n** for every new key, `en` + `vi`.
- [ ] **Step 6: `npm run typecheck`, `npm run lint`, `npm run check:i18n`** → clean.
- [ ] **Step 7: Commit** `feat(pvp): race mode on the tabletop face-off`

---

### Task 8: Record a race as its own mode

Both games currently land in `pvp_matches` as `mode: 'quiz-faceoff'`. A race is a different game and should be distinguishable in the data — one text column, no migration.

**Files:**
- Modify: `shared/schemas.ts`, `server/services/pvp.ts`, `app/routes/game-rooms.tsx`, `src/flashcards/faceoff.tsx`, `docs/superpowers/specs/2026-08-25-vocab-pvp-design.md`

- [ ] **Step 1: Widen the input.** `FaceoffResultInput` gains `mode: z.enum(['quiz-faceoff', 'quiz-race'])`. `recordFaceoffMatch` writes `input.mode` instead of the hardcoded literal, keeping `code: '1V1'` for both (no room existed either way).
- [ ] **Step 2: Thread it through** the `faceoff-result` intent (`formData.get('mode')`) and the screen's submit. Keep every existing rule: staff-only, winner ≠ loser (422), draws never posted, no mastery/garden write anywhere in this path.
- [ ] **Step 3: Update the spec's face-off section** to describe both games, their two `mode` values, and Race's rules (preset count, shared countdown, independent progress, self-only wrong-answer cooldown, winner = first to finish else furthest at time-up, draw not recorded).
- [ ] **Step 4: `npm run typecheck` + `npm run lint`** → clean.
- [ ] **Step 5: Commit** `feat(pvp): record face-off duels and races as distinct modes`

---

### Task 9: Test coverage for the changed surfaces

**Files:**
- Modify: `e2e/pvp.spec.ts`

- [ ] **Step 1: Repair the existing face-off block for the mode picker.** It goes "1v1 on this device" → player pickers → Start; insert the Duel choice between them. Everything after (the `[data-side]` locators, the lock assertion, "wins!") stays.
- [ ] **Step 2: Pin the rotation so Task 1 cannot silently regress.** This is the only automated guard against the bug that shipped — a screenshot would not have caught it, and review did not:

```ts
// Upright for the player at that edge: the left half's letter tops must point RIGHT (+x),
// which is rotate(90deg) = matrix(0, 1, -1, 0, …); the right half is the mirror.
const rotationOf = (side: 1 | 2) =>
  page.locator(`[data-side="${side}"] > div`).evaluate((el) => getComputedStyle(el).transform);
expect(await rotationOf(1)).toContain('matrix(0, 1, -1, 0');
expect(await rotationOf(2)).toContain('matrix(0, -1, 1, 0');
```

- [ ] **Step 3: Add a Race block.** Staff opens the face-off, picks Race, the 10-question count and the shortest duration, picks two students, starts. Tap a WRONG option on side 1 and assert side 1 shows its cooldown message **while side 2 can still score** — that is the mode's whole promise, so assert the opponent is unaffected, not merely that the tapper is punished. Then drive side 1 through all 10 questions correctly and assert `wins!` names that student and the ladder gained points. Clean up the topic.
- [ ] **Step 4: `npm run typecheck` + `npm run lint`** → clean. Do NOT run the suite; report that `npm run test:e2e:staging` covers it.
- [ ] **Step 5: Commit** `test(pvp): cover the face-off mode picker, rotation and race mode`

---

### Task 10: Push and ship

- [ ] **Step 1:** `npm run typecheck` && `npm run lint` && `npm run check:i18n` all clean; `pwd && cd mobile && npm test` green; `npm run format` on your own files only.
- [ ] **Step 2:** `node scripts/changelog.mjs "PvP fixes (face-off rotation, mid-game joins, late answers) plus a new face-off Race mode (F33/F34)"`
- [ ] **Step 3:** Commit the changelog and `git push origin main`.
- [ ] **Step 4: Ship checklist**, in order:
  1. Workers Builds deploys on push — do NOT `wrangler deploy`. Confirm the new code is live: `curl -s -o /dev/null -w "%{http_code}" 'https://<prod-host>/game-ws?code=ABCD'` → `426`.
  2. **`0055_pvp.sql` may still be pending on prod — check this first.** `npx wrangler d1 migrations list mochi-class --remote`, then `npx wrangler d1 migrations apply mochi-class --remote` if so. The verifying session's wrangler authenticated as the WRONG Cloudflare account (error 7403 on mochi-class); if that recurs, STOP and tell the user rather than running `wrangler login`. Task 2 removes the 500, but the ladder stays empty until the migration lands.
  3. `pwd && cd mobile && npx eas-cli workflow:runs` — top run should match the commit. The known failure is an exhausted free CI quota; then publish by hand: `npx eas-cli update --branch preview --platform android --environment preview --message "..."`. Never drop `--environment preview`.
  4. Verify delivery: `runtimeVersion` from `shared/version.json` (never hardcoded) into the CLAUDE.md manifest curl; the body's `gitSha` must equal the pushed commit.
- [ ] **Step 5: Report** the commit sha, the ship-checklist outcomes, and: "Suites that cover this change (not run, user-triggered): `npm test` (test/pvp.test.ts), `npm run test:worker` (game-room), `npm run test:e2e:staging` (e2e/pvp.spec.ts), `pwd && cd mobile && npm test` (game-socket)."

## Deferred — deliberately not in this plan

Real but not worth a task now; revisit if they bite:

- **`100vh`/`100vw` vs the fixed container.** The rotated box's fit assumes viewport units equal the `inset: 0` parent's box. A tablet browser with a dynamic toolbar can resolve `100vh` to the large-viewport height while the container is laid out shorter, over- or under-sizing the board slightly. `100dvh`/`100dvw` would be sturdier.
- **The `66px` divider width is duplicated** — hardcoded in `Divider` and again inside the half's `calc()`. Change one and the geometry silently drifts; a shared constant would fix it.
- **The divider's own text is upright for neither player** (it reads correctly only from a long edge). Probably right — it is symmetric and glanceable, and the numerals are short — but it is the one text nobody reads straight on.
- **`GameRoom`'s `/init` trusts its body wholesale.** Safe only because `createRoom` is its sole caller; worth a schema check if anything else ever posts to it.

## What NOT to do

- No `wrangler deploy`, no `wrangler login`, no test suites beyond the free ones, no paid API calls, no new npm dependencies.
- Do not touch the room-battle protocol beyond the six fixes in Task 3 and Task 4's refusal messages; do not touch LiveHub or the pronounce path.
- Do not port face-off to mobile. It stays web-only by design (`docs/mobile-parity.md`); the shared reducers are ready if that ever changes.
- Do not "fix" the five DO behaviours the review verified as CORRECT: hibernation discipline, the alarm chain with nobody answering, early-advance vs disconnects, the replayed original deadline, and broadcast-before-persist.
