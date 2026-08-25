# 1v1 face-off on mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the tabletop 1v1 face-off (both Duel and Race) to the Expo app, reversing the "web-only by design" decision in `docs/mobile-parity.md`.

**Architecture:** The rules already live in `shared/logic/pvp.ts` and are already importable from mobile, so this is a screen plus one API route — no new game logic. The layout is NOT a port of the web screen: the web splits left/right and rotates each half ±90° because a tablet lies in landscape with a player at each short edge. A phone is locked to portrait, so on mobile the split is **top/bottom with the top half rotated 180°** — which is both the natural fit for a phone lying flat between two players and much simpler to implement, since a 180° rotation preserves the bounding box and needs none of the web version's swapped-dimensions trick.

**Ships over OTA.** That is the reason for the portrait decision, not a coincidence — see Global Constraints.

**Spec:** `docs/superpowers/specs/2026-08-25-vocab-pvp-design.md` — the face-off decision section, whose "web-only" scope line Task 5 updates.

## The decision that shapes this plan

`mobile/app.config.ts` sets `orientation: 'portrait'` and `expo-screen-orientation` is **not** a dependency. A landscape face-off matching the web layout would therefore need a new native module, a hand-bumped `runtimeVersion` (3 → 4), and a **freshly built APK installed on every device** — no OTA can deliver it, and until every phone is reinstalled the update reaches nobody.

Portrait top/bottom with a 180° rotation needs none of that: pure JS, ships on the next `eas update`, and puts each player at a short edge of a phone exactly as the tablet version does for a tablet. That is what this plan builds. If landscape parity is ever genuinely wanted, it is a separate piece of work gated on a release, not an update.

## Global Constraints

- **This must remain OTA-shippable: add NO native dependency and do NOT touch `runtimeVersion`.** If a task seems to need either, stop and report rather than bumping it — a `runtimeVersion` change silently cuts every installed phone off from updates until it is reinstalled.
- **Never run test suites.** Forbidden: `npm test`, `npm run test:worker`, `npm run test:e2e`, `npm run test:e2e:staging`, `cd mobile && npm run test:bundle`, `cd mobile && npm run test:device`.
- **Free checks you MUST run**: `npm run typecheck`, `npm run lint`, `npm run check:i18n`, and — verifying `pwd` first — `cd mobile && npm test` and `cd mobile && npx tsc --noEmit`.
- **`cd` does not persist between tool calls.** Verify `pwd` before every command; a `cd mobile && npm test` that silently runs from the repo root fires the forbidden root suite.
- **Reuse the existing `pvp_*` i18n keys.** Every string this feature needs already exists (mode labels, `pvp_race_cooldown`, `pvp_faceoff_locked`, `pvp_draw`, `pvp_winner`, `pvp_rematch`, `pvp_faceoff_quit*`, `pvp_start`). Add a key only if something genuinely has no equivalent, and then in BOTH `en` and `vi`.
- `/api/*` is bearer-only; the mobile app never has a cookie. Recording therefore needs its own API route — the existing cookie action is not reachable from the app.
- Minimum touch target 48dp (`TOUCH` in `mobile/theme`), not the web's 44.
- Never `wrangler deploy`, never `wrangler login`. Commit per task; push once at the end.

---

### Task 1: A bearer route for recording a face-off result

**Files:**
- Create: `app/routes/api.pvp.faceoff.tsx`
- Modify: `app/routes.ts`, `server/api/docs/registry.ts`, `docs/api.md`

**Interfaces:**
- Consumes: `FaceoffResultInput` from `shared/schemas.ts` and `recordFaceoffMatch` from `server/services/pvp.ts` — both already exist and already enforce the rules; do not duplicate or re-implement either.
- Produces: `POST /api/pvp/faceoff` → `{ ok: true }`, consumed by Task 2.

- [ ] **Step 1: The route.** `export const action = withAuth('staff', async ({ request, db }) => { await recordFaceoffMatch(db, await parseBody(request, FaceoffResultInput)); return { ok: true }; });` — `'staff'` level, matching the cookie twin: a student's device must not be able to record a result, and anonymous quick-play posts nothing at all. `recordFaceoffMatch` already rejects winner === loser with 422.
- [ ] **Step 2: Register it** in `app/routes.ts` beside `api/pvp/ladder`.
- [ ] **Step 3: Document it in the OpenAPI registry** (`server/api/docs/registry.ts`), in the `vocabulary` block beside the other two PvP entries. **This is not optional**: `test/api-docs-completeness.test.ts` fails the build for any `/api/*` route with no registry entry — it caught exactly this omission on the last PvP change. Add the row to `docs/api.md`'s "Everything else" table too.
- [ ] **Step 4:** `npm run typecheck` + `npm run lint` → clean.
- [ ] **Step 5: Commit** `feat(pvp): a bearer route for recording a face-off result`

---

### Task 2: The mobile face-off screen

**Files:**
- Create: `mobile/app/play/faceoff/[slug].tsx`
- Modify: `mobile/lib/endpoints.ts`

**Interfaces:**
- Consumes: `newFaceoff`, `faceoffAnswer`, `FACEOFF_TARGET`, `FACEOFF_MAX_QUESTIONS`, `newRace`, `raceAnswer`, `raceTimeUp`, `RACE_*` — all from `@mochi/shared/logic/pvp`; and `buildQuizQuestions` from `@mochi/shared/logic/flashcards`.
- Produces: the route `/play/faceoff/<slug>`, pushed by Task 3.

- [ ] **Step 1: Endpoint function.** In `mobile/lib/endpoints.ts`, extend the existing `pvp` object with
  `recordFaceoff: (input: FaceoffResultInput) => apiFetch<{ ok: true }>('/api/pvp/faceoff', { method: 'POST', body: input })`,
  importing the type from `@mochi/shared/schemas` the way its neighbours do.
- [ ] **Step 2: Route placement.** Put the screen at `mobile/app/play/faceoff/[slug].tsx` — under `app/play/`, OUTSIDE the `(app)` tab group, which is what removes the tab bar (same reason `play/[slug]/[mode].tsx` and `play/battle/[code].tsx` live there). Read `play/battle/[code].tsx` first for the house shape of a full-screen game route.
- [ ] **Step 3: The split layout.** A `flexDirection: 'column'` filling the screen:

```tsx
// Player 1 sits at the TOP short edge, so their whole board is rotated 180° to face them.
// Unlike the web's ±90° halves, a 180° rotation preserves the bounding box — no swapped
// width/height trick is needed here, which is why this screen is simpler than its web twin.
<View style={{ flex: 1, transform: [{ rotate: '180deg' }] }}>{board(1)}</View>
<Divider />
<View style={{ flex: 1 }}>{board(2)}</View>
```

  `board(side)` renders that player's name (when picked), the current word, and the four options as full-width `Button`s at `size="lg"` (52dp, above the 48dp floor), plus the blocked/cooldown message when that side is out.
- [ ] **Step 4: The divider.** A short unrotated horizontal strip between the halves, carrying — top to bottom — player 1's progress, the counter, the scores, an exit control, and player 2's progress. Use the existing `ProgressBar` from `~/ui` (it takes `value` 0-100 and a `color`) rather than hand-rolling bars; give player 1 `color="violet"` and player 2 `color="green"` to match the web. Nothing in the divider rotates: numerals read from either side, and an exit belongs to neither player.
  Note Android already gives this screen a free way out (it is a detail route, so back retraces silently) — the exit control is for parity and for a tablet in a case, not because there is no alternative.
- [ ] **Step 5: Setup step.** Mode choice first (Duel / Race, reusing `pvp_faceoff_mode_*` keys), then for Race the question-count and duration pickers (`RACE_QUESTION_COUNTS`, `RACE_SECONDS_CHOICES`), then Start.
  Staff may optionally pick the two players. There is no Select component in `mobile/ui` and no existing student-picker screen to copy, so render the roster from `api.students.list()` as a scrollable row of `Button variant="soft"` chips with the chosen one switched to `variant="primary"`, one list per slot. That is proportionate for a class-sized roster; if a school ever has hundreds of students this wants a searchable screen instead — say so in a comment rather than building it now. Students see no pickers at all and their games record nothing, exactly as on web.
- [ ] **Step 6: Play and finish.** Duel: both halves show the SAME question from one shared index; a wrong tap locks only that side until the question advances. Race: each half shows `questions[race.progress[side]]`, a wrong tap starts only that side's cooldown, and a `setInterval(…, 200)` drives the countdown and settles `raceTimeUp` once at expiry. Seed Race from `questions.length`, never the picker value — `buildQuizQuestions` caps a round at the deck size. On finish, show the winner (or `pvp_draw`) and a rematch; when both players were picked AND the caller is staff AND it is not a draw, post via `api.pvp.recordFaceoff` with the right `mode` (`'quiz-faceoff'` for Duel, `'quiz-race'` for Race). A draw posts nothing.
- [ ] **Step 7:** `pwd && cd mobile && npx tsc --noEmit` and `pwd && cd mobile && npm test` → clean/green; root `npm run typecheck`, `npm run lint`, `npm run check:i18n` → clean.
  On tests: this screen is not unit-testable (the mobile suite runs in plain Node with no renderer — see `mobile/vitest.config.ts`), and the rules it drives are already covered by `test/pvp.test.ts`. The only `mobile/lib/` change is one endpoint function following an established pattern that `mobile/test/api.test.ts` already covers, so no new mobile test is warranted. State that reasoning in the report rather than adding a hollow test to satisfy the rule.
- [ ] **Step 8: Commit** `feat(pvp): 1v1 face-off on mobile`

---

### Task 3: The entry point on the mobile topic screen

**Files:**
- Modify: `mobile/app/(app)/vocabulary/[slug]/index.tsx`

- [ ] **Step 1: Turn the single Battle button into a choice.** That screen currently has one `Battle` button (`Swords` icon) that immediately creates a room via `api.pvp.createRoom`. It now needs two destinations, matching the web's Battle dialog: the room battle it already does, and "1v1 on this device" pushing `/play/faceoff/<slug>`. Keep it to two plain buttons rather than introducing a modal — the app has no dialog primitive in `mobile/ui` and two buttons in the existing launcher grid read fine. Reuse `pvp_mode_room` and `pvp_mode_faceoff`.
- [ ] **Step 2:** Gate both on `words.length >= MIN_WORDS.quiz`, as the current Battle button already is.
- [ ] **Step 3:** `pwd && cd mobile && npx tsc --noEmit` → clean; root `npm run typecheck`, `npm run lint`, `npm run check:i18n` → clean.
- [ ] **Step 4: Commit** `feat(pvp): launch a 1v1 face-off from a topic on mobile`

---

### Task 4: e2e coverage for the new route

**Files:**
- Modify: `e2e/pvp.spec.ts`

The mobile screen itself cannot be driven by Playwright, but the API route it depends on can — and that route is where a regression would silently lose a recorded match.

- [ ] **Step 1:** Add a test that posts a valid face-off result to `/api/pvp/faceoff` with a staff bearer token and asserts the ladder gains the winner's points; then assert a STUDENT token gets 403 and `winnerStudentId === loserStudentId` gets 422. Mint the bearer via `POST /api/auth/login` the way the spec's existing helpers authenticate, and follow `crud-helpers`' guard so it only runs against calendar-test.
- [ ] **Step 2:** `npm run typecheck` + `npm run lint` → clean. Do NOT run the suite; report that `npm run test:e2e:staging` covers it.
- [ ] **Step 3: Commit** `test(pvp): cover the face-off recording API`

---

### Task 5: Docs and ship

**Files:**
- Modify: `docs/mobile-parity.md`, `docs/superpowers/specs/2026-08-25-vocab-pvp-design.md`

- [ ] **Step 1: Correct the parity doc.** Its `/faceoff/:slug` row currently reads "Not built, web-only by design". Replace it with the built state AND the layout difference — web splits left/right at ±90° for a landscape tablet, mobile splits top/bottom at 180° for a portrait phone — plus the reason: portrait is what keeps this OTA-shippable.
- [ ] **Step 2: Correct the spec.** Its face-off section says face-off is web-only and lists "Face-off on the mobile app" under out-of-scope. Both are now wrong. Record the portrait/180° decision and the `expo-screen-orientation` constraint that drove it, so nobody "fixes" mobile to match web's ±90° without realising it costs a new APK.
- [ ] **Step 3:** All free checks clean; `npm run format` on your own files only.
- [ ] **Step 4:** `node scripts/changelog.mjs "1v1 face-off on mobile (portrait, top/bottom split) plus a bearer route for recording it"`, commit, `git push origin main`.
- [ ] **Step 5: Ship checklist:** Workers Builds deploys on push (do NOT `wrangler deploy`); confirm `npx wrangler d1 migrations list mochi-class --remote` reports nothing pending (this feature adds no migration, so it should already be clean); then `pwd && cd mobile && npx eas-cli workflow:runs` — on the known free-tier CI quota failure, publish by hand with `npx eas-cli update --branch preview --platform android --environment preview --message "..."`, never dropping `--environment preview`; finally verify the served `gitSha` equals the pushed commit using the CLAUDE.md manifest curl with `runtimeVersion` read from `shared/version.json` (it must still be **3** — if it is not, something bumped it and no phone will get this).

## What NOT to do

- Do not add `expo-screen-orientation` or any other native dependency, and do not bump `runtimeVersion`.
- Do not duplicate the game rules — `shared/logic/pvp.ts` is the only place they live, and both clients import it.
- Do not port the web's ±90° swapped-dimensions layout; on a portrait phone it is both wrong and unnecessary.
- Do not let a student's device record a result, and do not record a draw.
