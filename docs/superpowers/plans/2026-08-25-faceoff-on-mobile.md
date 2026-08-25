# 1v1 face-off on mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. This plan is ONE
> linear sequence for a single developer, start to finish — **not** task-by-task with per-task
> commits. Do the steps in order, commit ONCE at the end (Step 22), push once, then run the
> Verification section. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the tabletop 1v1 face-off (both Duel and Race) to the Expo app, reversing the "web-only by design" decision recorded in `docs/mobile-parity.md`.

**Architecture:** The game rules already live in `shared/logic/pvp.ts` and are already importable from mobile, so this is one screen plus one API route — no new game logic anywhere. The layout is deliberately NOT a port of the web screen: web splits left/right and rotates each half ±90° because a tablet lies in landscape with a player at each short edge. The phone is locked to portrait, so mobile splits **top/bottom with the top half rotated 180°**.

**Tech Stack:** Expo / React Native (expo-router), React Router 7 resource route, Drizzle/D1, vitest (`test-worker` via `cloudflare:test`).

**Spec:** `docs/superpowers/specs/2026-08-25-vocab-pvp-design.md` — the face-off decision section, whose "web-only" scope lines Step 20 corrects.

## The constraint that shapes this plan

`mobile/app.config.ts` sets `orientation: 'portrait'` and `expo-screen-orientation` is **not** a dependency. Matching the web's landscape ±90° layout would need that native module, a hand-bumped `runtimeVersion` (3 → 4), and **a freshly built APK installed on every phone** — no OTA can carry it, and until every device is reinstalled the update reaches nobody.

Portrait top/bottom at 180° needs none of that: pure JS, ships on the next `eas update`, and puts each player at a short edge of a phone exactly as the web version does for a tablet. A 180° rotation also preserves the bounding box, so this screen needs none of the web version's swapped-dimensions trick — it is the simpler of the two.

## Global Constraints

- **This must stay OTA-shippable: add NO native dependency and do NOT touch `runtimeVersion`.** If a step seems to need either, STOP and report — a `runtimeVersion` change silently cuts every installed phone off from updates until it is reinstalled.
- **ONE commit, ONE push, at Step 22.** Nothing is committed before that.
- **Never run test suites.** Forbidden: `npm test`, `npm run test:worker`, `npm run test:e2e`, `npm run test:e2e:staging`, `cd mobile && npm run test:bundle`, `cd mobile && npm run test:device`. You WRITE the test; the human runs it in Verification.
- **Free checks you must run**: `npm run typecheck`, `npm run lint`, `npm run check:i18n`, `npm run format` (your own files' hunks only — the tree is CRLF and `--check` false-flags everything else), and `cd mobile && npm test` + `cd mobile && npx tsc --noEmit`.
- **`cd` does not persist between tool calls.** Verify `pwd` before every command. A `cd mobile && npm test` that silently runs from the repo root fires the forbidden root suite — this has already happened once on this feature.
- **Reuse the existing `pvp_*` i18n keys.** Every string needed already exists in both `en` and `vi`: `pvp_faceoff_mode_duel`, `pvp_faceoff_mode_duel_sub`, `pvp_faceoff_mode_race`, `pvp_faceoff_mode_race_sub`, `pvp_race_cooldown`, `pvp_faceoff_locked`, `pvp_faceoff_rule`, `pvp_player_1`, `pvp_player_2`, `pvp_pick_student`, `pvp_start`, `pvp_draw`, `pvp_winner`, `pvp_rematch`, `pvp_faceoff_quit`, `pvp_faceoff_quit_msg`, `pvp_race_duration`, `pvp_mode_room`, `pvp_mode_faceoff`, `fc_exit`, `fc_round_size`, `done`. Add a key only if something has no equivalent, and then to BOTH blocks in `shared/i18n/strings.ts`.
- `/api/*` is bearer-only — the app never has a cookie, so the existing cookie action that records a face-off is unreachable from the phone. That is why Step 1 exists.
- Minimum touch target 48dp (`TOUCH` in `mobile/theme`), not the web's 44.
- Never `wrangler deploy`, never `wrangler login`.
- Do not duplicate the game rules. `shared/logic/pvp.ts` is the only place they live and both clients import it.

## File map

| File | Responsibility |
|---|---|
| `app/routes/api.pvp.faceoff.tsx` (new) | Bearer, staff-only POST that records one finished duel. Thin — all rules stay in the service it calls. |
| `app/routes.ts` | Register the route. |
| `server/api/docs/registry.ts` | OpenAPI entry. **Not optional** — a missing entry fails `test/api-docs-completeness.test.ts`. |
| `docs/api.md` | One table row. |
| `test-worker/api-pvp-faceoff.test.js` (new) | The route's auth levels and validation. |
| `mobile/lib/endpoints.ts` | One function on the existing `pvp` object. |
| `mobile/app/play/faceoff/[slug].tsx` (new) | The whole screen: setup, play, finish. Outside `(app)` so there is no tab bar. |
| `mobile/app/(app)/vocabulary/[slug]/index.tsx` | Turn the single Battle button into room-vs-1v1. |
| `docs/mobile-parity.md`, the spec | Stop asserting face-off is web-only. |

---

## The sequence

### The API route

- [ ] **Step 1: Write the route.** Create `app/routes/api.pvp.faceoff.tsx`:

```tsx
import { parseBody, withAuth } from '../../server/api/handler';
import { recordFaceoffMatch } from '../../server/services/pvp';
import { FaceoffResultInput } from '../../shared/schemas';

/**
 * Record one finished tabletop duel from the mobile app. STAFF only, matching the cookie twin in
 * `game-rooms.tsx`: the tablet (or phone) running a face-off is the teacher's, and a student's
 * device must not be able to write a match. Anonymous quick-play posts nothing at all.
 *
 * This exists because `/api/*` is bearer-only and the app has no cookie, so that cookie action is
 * unreachable from the phone. Every rule — winner ≠ loser, the mode enum, no mastery/garden write —
 * already lives in `recordFaceoffMatch` and `FaceoffResultInput`; this route adds none of its own.
 */
export const action = withAuth('staff', async ({ request, db }) => {
  await recordFaceoffMatch(db, await parseBody(request, FaceoffResultInput));
  return { ok: true };
});
```

- [ ] **Step 2: Register it.** In `app/routes.ts`, beside the existing `api/pvp/ladder` line:
  `route('api/pvp/faceoff', 'routes/api.pvp.faceoff.tsx'),`
- [ ] **Step 3: Add the OpenAPI entry.** In `server/api/docs/registry.ts`, in the `vocabulary` array beside the two existing PvP entries. `FaceoffResultInput` is already exported from `shared/schemas` — add it to that file's big import list if it is not there yet.

```ts
  {
    path: '/api/pvp/faceoff',
    routePattern: 'api/pvp/faceoff',
    tag: 'Vocabulary',
    operations: [
      {
        method: 'post',
        auth: 'staff',
        summary: 'Record a finished 1v1 face-off',
        description:
          'The bearer twin of the `faceoff-result` intent on `/game-rooms`, for the mobile app. ' +
          'Staff only — a student device may not write a match, and an anonymous quick-play game ' +
          'posts nothing. Draws are never posted. `mode` is `quiz-faceoff` for a duel or ' +
          '`quiz-race` for a race.',
        request: { schema: FaceoffResultInput },
        responses: {
          200: ok(z.object({ ok: z.literal(true) }), 'Recorded.'),
          422: err('same_player', 'winner and loser are the same student.'),
        },
      },
    ],
  },
```

- [ ] **Step 4: Document it** in `docs/api.md`'s "Everything else" table, right after the `/api/pvp/ladder` row:

```
| POST | `/api/pvp/faceoff` | staff | Records one finished 1v1 face-off from the app — `FaceoffResultInput` (`mode`, `topicId`, winner/loser student ids and scores, `total`). The bearer twin of `/game-rooms`'s `faceoff-result` intent, which a phone cannot reach. 422 `same_player` when winner and loser match; draws are never posted |
```

- [ ] **Step 5: Write the route test.** Create `test-worker/api-pvp-faceoff.test.js`. This belongs in `test-worker/`, not `e2e/`: it is a route-level auth question, `cloudflare:test` runs it against `SELF` with no deploy, and `live-hub.test.js` already has the exact session-seeding harness to copy. Read that file first for `seedStaffSession` and the `db()` helper, and copy its style.

```js
import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import * as flashcardsSvc from '../server/services/flashcards';
import * as peopleSvc from '../server/services/people';
import { pvpMatches, pvpMatchPlayers } from '../server/db/schema';
import { eq } from 'drizzle-orm';

/**
 * `POST /api/pvp/faceoff` — the bearer route the mobile face-off records through.
 *
 * The interesting properties are all refusals: a student token must not be able to write a match,
 * and a self-match must be rejected before it reaches the insert. The happy path is asserted on the
 * ROWS, not the status, because a 200 with nothing written is the failure that would actually cost
 * a teacher their recorded game.
 */

function db() {
  return new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);
}

const post = (token, body) =>
  SELF.fetch('https://example.com/api/pvp/faceoff', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/pvp/faceoff', () => {
  it('records a duel and rejects the refusals', async () => {
    const d = db();
    const topic = await flashcardsSvc.createTopicWithWords(
      d,
      { name: `Faceoff API ${crypto.randomUUID()}`, description: null, color: 'orange' },
      [{ word: 'cat', meaningVi: 'con mèo' }],
    );
    const a = await peopleSvc.createStudent(d, { name: 'Faceoff A', color: 'green' });
    const b = await peopleSvc.createStudent(d, { name: 'Faceoff B', color: 'blue' });

    // Seed a staff session the same way test-worker/live-hub.test.js does, and a student one.
    const staffToken = await seedStaffSession('faceoff-api-staff@test.com');
    const studentToken = await seedStudentSession('faceoff-api-student@test.com');

    const payload = {
      mode: 'quiz-faceoff',
      topicId: topic.id,
      winnerStudentId: a.id,
      loserStudentId: b.id,
      winnerScore: 5,
      loserScore: 3,
      total: 8,
    };

    // A student device must never write a match.
    expect((await post(studentToken, payload)).status).toBe(403);

    // Winner and loser cannot be the same person.
    const same = await post(staffToken, { ...payload, loserStudentId: a.id });
    expect(same.status).toBe(422);

    // Staff: recorded, and the ROWS are what proves it.
    expect((await post(staffToken, payload)).status).toBe(200);
    const rawDb = createRawDb(env);
    const matches = await rawDb.select().from(pvpMatches).where(eq(pvpMatches.topicId, topic.id));
    expect(matches).toHaveLength(1);
    expect(matches[0].mode).toBe('quiz-faceoff');
    expect(matches[0].code).toBe('1V1');
    const players = await rawDb
      .select()
      .from(pvpMatchPlayers)
      .where(eq(pvpMatchPlayers.matchId, matches[0].id));
    expect(players.find((p) => p.rank === 1).studentId).toBe(a.id);
    expect(players.find((p) => p.rank === 2).studentId).toBe(b.id);
  });

  it('refuses an unknown mode before the insert', async () => {
    const staffToken = await seedStaffSession('faceoff-api-mode@test.com');
    const res = await post(staffToken, {
      mode: 'quiz-nonsense',
      topicId: 'x',
      winnerStudentId: 'a',
      loserStudentId: 'b',
      winnerScore: 1,
      loserScore: 0,
      total: 1,
    });
    expect(res.status).toBe(422);
  });
});
```

  `seedStaffSession` is in `live-hub.test.js` — lift it into this file (a small duplicated helper across two independent test files is the house pattern here; do NOT refactor `live-hub.test.js` to share it). Write `seedStudentSession` the same way but with `peopleSvc.createStudent` and `studentId` on the account row instead of `staffId`; read `scripts/test-accounts.sql` or `server/db/schema.ts`'s `accounts` table to get the column right.
- [ ] **Step 6: Do NOT run `npm run test:worker`.** It is forbidden here and the human runs it in Verification. Run `npm run typecheck` and `npm run lint` instead — both clean before moving on.

### The mobile endpoint

- [ ] **Step 7: Add the endpoint function.** In `mobile/lib/endpoints.ts`, extend the EXISTING `pvp` object (do not create a second one):

```ts
  /** Record a finished 1v1 face-off. STAFF only; a draw or an anonymous game posts nothing. */
  recordFaceoff: (input: FaceoffResultInput) =>
    apiFetch<{ ok: true }>('/api/pvp/faceoff', { method: 'POST', body: input }),
```

  Add `FaceoffResultInput` to the file's existing `@mochi/shared/schemas` type import list.

### The screen

- [ ] **Step 8: Read the two references first.** `mobile/app/play/battle/[code].tsx` for the house shape of a full-screen game route (`Screen edges`, `StatusBar`, `router.back()`), and `src/flashcards/faceoff.tsx` for the game's structure — setup → play → finish, and how it drives both reducers. You are re-laying-out that second file, not re-designing it.
- [ ] **Step 9: Create the file** `mobile/app/play/faceoff/[slug].tsx`. It goes under `app/play/`, OUTSIDE the `(app)` tab group — that is what removes the tab bar, exactly as for `play/battle/[code].tsx`. Default-export a component reading `const { slug } = useLocalSearchParams<{ slug: string }>()`.
- [ ] **Step 10: Load the deck.** Use `useTopic(slug)` from `~/lib/use-topics` — the same hook `play/[slug]/[mode].tsx` uses, which gives `{ bundle, loading, unavailableOffline }` and works offline for a downloaded topic. Reuse that file's `unavailableOffline` and empty-deck early returns verbatim in shape (message + an exit button); do not invent new copy.
- [ ] **Step 11: Gate on the deck size.** If `bundle.words.length < MIN_WORDS.quiz` (import from `@mochi/shared/logic/flashcards`), render the same friendly dead-end as the offline case rather than letting a round build with too few words.
- [ ] **Step 12: Roster, staff only.** `const isStaff = user?.kind === 'staff'` from `useAuth()`. Fetch the roster ONLY when `isStaff` — `/api/students` is `level: 'staff'` (see `app/routes/api.students.tsx`), so a student's device calling it gets a 403 that `apiFetch` would surface as an error toast for no reason. Use `api.students.list()` inside an effect guarded on `isStaff`, and hold `{ id, name }[]` in state.
- [ ] **Step 13: Setup step.** A `ScrollView` card containing, in order: the mode choice (two `Button`s using `pvp_faceoff_mode_duel` / `pvp_faceoff_mode_race`, the selected one `variant="primary"` and the other `"soft"`, with the `_sub` string beneath each as a `Muted`); for Race only, a question-count row (`RACE_QUESTION_COUNTS`) and a duration row (`RACE_SECONDS_CHOICES`, labelled `pvp_race_duration`) as the same selected/unselected `Button` pairs the topic screen already uses for round size; then — staff only — two player slots.
  For the slots: there is no Select in `mobile/ui` and no existing student-picker screen to copy, so render the roster as a horizontally scrollable row of `Button variant="soft"` chips per slot, the chosen one switched to `variant="primary"`. That is proportionate for a class-sized roster; add a one-line comment noting that a school with hundreds of students would want a searchable screen instead. Students see no slots at all and their games record nothing, exactly as on web.
  Finish with a `pvp_start` button and the `pvp_faceoff_rule` line (it interpolates `{n}` — pass `FACEOFF_TARGET`).
- [ ] **Step 14: Build the round on Start.**

```tsx
// buildQuizQuestions caps a round at the DECK size, so a 6-word topic yields 6 questions even
// when 10 were asked for. Seed the race from questions.length, never the picker, or totalQuestions
// promises a question that is not there.
const qs = buildQuizQuestions(bundle.words, mode === 'race' ? questionCount : FACEOFF_MAX_QUESTIONS);
setQuestions(qs);
if (mode === 'race') {
  setRace(newRace(qs.length));
  setDeadline(Date.now() + seconds * 1000);
} else {
  setDuel(newFaceoff());
}
setStep('play');
```

- [ ] **Step 15: The split layout.** Player 1 sits at the TOP short edge, so their entire board is rotated 180°:

```tsx
<View style={{ flex: 1 }}>
  {/* 180° — not the web's ±90°. A phone is portrait-locked, so the two players sit at the top and
      bottom short edges. 180° also preserves the bounding box, so unlike the web version this
      needs no swapped width/height: RN maps touches through the transform, and because the bounds
      are unchanged every option button stays hit-testable where it is drawn. */}
  <View style={{ flex: 1, transform: [{ rotate: '180deg' }] }}>{board(1)}</View>
  <Divider … />
  <View style={{ flex: 1 }}>{board(2)}</View>
</View>
```

  `board(side)` renders: the player's name (when picked) as a `Body` with `fontFamily: th.font.bodyBold`; the current word as a `Title` at `th.text.xxl` with `th.font.displayBold`; the four options as `Button block size="lg"` (52dp, clear of the 48dp floor) in a `gap: th.spacing[3]` column; and, when that side is blocked, a `Muted` carrying `pvp_faceoff_locked` (Duel) or `pvp_race_cooldown` (Race), with the board at `opacity: 0.45`.
  Duel shows the SAME question to both halves (`questions[duel.qIndex]`); Race shows each side its own (`questions[race.progress[side]]`).
- [ ] **Step 16: The divider.** A short unrotated strip between the halves, top to bottom: player 1's `ProgressBar` (`color="violet"`), a `Mono` counter, the two scores, an `IconButton` exit (`X` from `lucide-react-native`, `label={t('pvp_faceoff_quit')}`), and player 2's `ProgressBar` (`color="green"`). Use the existing `~/ui` `ProgressBar` — it takes `value` 0-100 and clamps — rather than hand-rolling bars. Nothing in the divider rotates: numerals read from either side and the exit belongs to neither player.
  Duel passes `(score / FACEOFF_TARGET) * 100` per side; Race passes `(progress / totalQuestions) * 100` and shows the remaining seconds as the counter.
  The exit calls `router.back()`. Android already gives this screen a free way out — it is a detail route, so back retraces silently — so this control is for parity and for a tablet in a case, not because there is no alternative; skip a confirm dialog, because `mobile/ui` has no dialog primitive and back has never asked for one.
- [ ] **Step 17: Taps.** Duel: `setDuel((s) => faceoffAnswer(s, side, option === q.answer, questions.length))`. Race: guard the buzzer first, exactly as the web does — `if (deadline !== null && Date.now() >= deadline) return;` — then `setRace((r) => raceAnswer(r, side, option === q.answer, Date.now()))`.
- [ ] **Step 18: The Race countdown.** One effect, and settle the expiry exactly once:

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

  A separate effect moves to the finish step when the active game's `finished` turns true, so both endings — someone won, or the clock ran out — land in one place.
- [ ] **Step 19: Finish step and recording.** Show the winner via `pvp_winner` (interpolating that player's name, falling back to `pvp_player_1` / `pvp_player_2`) or `pvp_draw`, the two scores, a `pvp_rematch` button that rebuilds the round, and `done` to `router.back()`.
  Post once, from a `posted` ref guard, ONLY when: the game is finished, the winner is not null, BOTH players were picked, and `isStaff`. Send `api.pvp.recordFaceoff({ mode: mode === 'race' ? 'quiz-race' : 'quiz-faceoff', topicId: bundle.topic.id, winnerStudentId, loserStudentId, winnerScore, loserScore, total: questions.length })` inside a `try/catch` that swallows — the score is already on screen and a failed record must not crash the results view.
  Scores for Race are the two `progress` values; for Duel the two `scores` values.

### The entry point

- [ ] **Step 20: Two destinations on the topic screen.** In `mobile/app/(app)/vocabulary/[slug]/index.tsx` the single `Battle` button currently calls `createBattle.mutate()` directly. Make it two buttons side by side, both gated on the existing `words.length >= MIN_WORDS.quiz`: keep the room one (relabel with `pvp_mode_room`, keep the `Swords` icon and the `loading` state) and add a second using `pvp_mode_faceoff` that pushes `/play/faceoff/${encodeURIComponent(slug)}`. Two plain buttons, not a modal — `mobile/ui` has no dialog primitive and the launcher grid reads fine with them.

### Docs

- [ ] **Step 21: Stop asserting face-off is web-only.**
  - `docs/mobile-parity.md`: its `/faceoff/:slug` row says "Not built, web-only by design". Replace it with the built state, the layout difference (web = left/right ±90° for a landscape tablet; mobile = top/bottom 180° for a portrait phone), and the reason: portrait is what keeps it OTA-shippable.
  - `docs/superpowers/specs/2026-08-25-vocab-pvp-design.md`: its face-off section calls face-off web-only and lists "Face-off on the mobile app" under out-of-scope. Both are now false. Record the portrait/180° decision AND the `expo-screen-orientation` constraint behind it, so nobody later "fixes" mobile to match web's ±90° without realising it costs a new APK and cuts off every un-updated phone.

### Ship

- [ ] **Step 22: All checks, then ONE commit and ONE push.**
  1. `npm run typecheck`, `npm run lint`, `npm run check:i18n` — all clean.
  2. `pwd && cd mobile && npx tsc --noEmit` and `pwd && cd mobile && npm test` — clean and green.
  3. `npm run format` — apply only hunks in files you touched.
  4. `node scripts/changelog.mjs "1v1 face-off on mobile (portrait top/bottom split) plus a bearer route for recording it"`
  5. `git add -A && git commit` with a message naming the portrait/180° decision and its OTA reason, then `git push origin main`.

---

## Verification

Run after the push. The first two are the human's to trigger — they are forbidden to the implementer.

- [ ] **1. The suites that cover this change.**
  - `npm run test:worker` — includes the new `test-worker/api-pvp-faceoff.test.js`. Watch this one first; it is the only automated proof the route's auth levels are right.
  - `npm test` — the tripwires (`test/api-docs-completeness.test.ts` fails if Step 3's registry entry is missing or wrong, `test/tenant-scope.test.ts` if the route reached past `TenantDb`).
  - `npm run test:e2e:staging` — unchanged by this work, but it exercises the web face-off and the shared reducers this screen now also drives.
- [ ] **2. Deployment state.**
  - Workers Builds deploys on push — do NOT `wrangler deploy`. Confirm the route is live: `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://calendar.ngqv0712.workers.dev/api/pvp/faceoff` → **401** (no bearer), not an HTML 404. A 404 means the worker has not rolled over yet.
  - `npx wrangler d1 migrations list mochi-class --remote` → nothing pending. This feature adds no migration, so anything pending here came from elsewhere.
  - `pwd && cd mobile && npx eas-cli workflow:runs` — top run should match the commit. The known failure is the exhausted free CI quota; then publish by hand: `npx eas-cli update --branch preview --platform android --environment preview --message "1v1 face-off on mobile"`. Never drop `--environment preview`.
  - **`runtimeVersion` must still be 3.** `node -p "require('./shared/version.json').runtimeVersion"`. If it is 4, something added a native dependency and no installed phone will receive this — stop and investigate.
  - Verify delivery: the CLAUDE.md manifest curl with that runtime version; the body's `gitSha` must equal the pushed commit.
- [ ] **3. On a real device — the part no suite can settle.** Relaunch the app twice so the OTA lands (`mobile/lib/updates.ts` applies it inside the splash screen; a slow connection defers it to the next launch). Then, signed in as staff, open a topic with ≥4 words and tap the new 1v1 button, and check:
  - **The top half reads upright to someone sitting at the top edge** and the bottom half to someone at the bottom. This is the whole feature and it is exactly what shipped wrong on web — a screenshot of one half alone will look plausible either way, so physically turn the phone around.
  - Every option button on the ROTATED half responds to a tap where it is drawn (RN maps touches through the transform, but this is the first `transform: rotate` on a touchable in this app, so confirm it rather than assume).
  - Duel: a wrong tap dims only that half and it stays out until the question advances; first to 5 ends it.
  - Race: a wrong tap blocks only the tapper while the opponent can still score; the countdown runs out and settles a winner or a draw.
  - With two students picked, a finished non-draw game appears on the vocabulary ladder. As a student, there are no player slots and nothing is recorded.
  - Back and the divider's exit both leave cleanly mid-game.

## Self-review notes

Checked against the spec and the plan's own steps:

- **Spec coverage.** The spec's face-off decision (both games, the win conditions, the self-only cooldown, staff-gated recording, draws unrecorded, no mastery/garden write) is carried by Steps 14–19, and its two now-false scope claims are corrected in Step 21. The recording rules are not re-implemented — Step 1 delegates to `recordFaceoffMatch`, which the spec already governs.
- **Type consistency.** `recordFaceoff` (Step 7) is the only new signature and is used once, in Step 19, with the same field names `FaceoffResultInput` declares. The reducer calls in Steps 17–18 match the arities in `shared/logic/pvp.ts` (`faceoffAnswer(s, side, correct, totalQuestions)`, `raceAnswer(s, side, correct, now)`, `raceTimeUp(s)`). `mode` values are `'quiz-faceoff'` / `'quiz-race'` in Steps 1, 3, 5 and 19 alike.
- **Two deliberate deviations from the earlier draft of this plan**, both corrections: the route test moved from `e2e/` to `test-worker/` (it is a route-auth question, `cloudflare:test` needs no deploy, and `live-hub.test.js` already has the seeding harness), and the roster fetch is now explicitly gated on `isStaff` because `/api/students` is `level: 'staff'` and a student's device would otherwise take a pointless 403.
- **Known soft spot, accepted.** `seedStudentSession` in Step 5 is described rather than written out, because the `accounts` column for a student link has to be read from the schema rather than guessed. The step says exactly where to look. Everything else in this plan is literal.
