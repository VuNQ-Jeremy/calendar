# Vocab PvP — verification instructions (Opus 5, separate session)

You are verifying work another agent (Sonnet 5) shipped as **one commit on `main`**:
"feat(pvp): vocab battles — join-by-code quiz races, GameRoom DO, monthly ladder
(F33/F34)". Your job is to **verify and report, not to fix** — findings go to the user
ranked by severity; touch code only if the user then asks.

## Inputs

1. Spec (binding authority): `docs/superpowers/specs/2026-08-25-vocab-pvp-design.md`
2. Plan the implementer followed: `docs/superpowers/plans/2026-08-25-vocab-pvp.md`
3. The commit: `git log --oneline -5` to find it, then review `git show <sha>` (it is
   large — read it file by file, `git show <sha> -- <path>`).

## Ground rules (repo law, they bind you too)

- Test suites are manual-trigger only. `npm run test:worker`, `npm test`, and
  `npm run test:e2e:staging` are the suites that cover this change — ask the user for
  permission in THIS session before running any of them; if granted, run worker + unit
  first, e2e:staging last (~4 min, redeploys calendar-test — check no other session is
  using staging first).
- Free to run without asking: `npm run typecheck`, `npm run lint`, `npm run check:i18n`,
  `cd mobile && npm test` (Node 24).
- Never `wrangler deploy`, never `wrangler login`. Read-only wrangler commands are fine.
- No paid API calls (`/enrich-vocab`, `/generate-vocab`, `/vocab-image-generate`,
  `/speech-assess` and their upstreams).

## Verification checklist

### A. Static (run these first)

- [ ] `npm run typecheck`, `npm run lint`, `npm run check:i18n` — all clean.
- [ ] `cd mobile && npm test` — green (must include the new game-socket tests).

### B. Spec compliance (read the diff against the spec)

- [ ] **Answers never ride the wire.** In `workers/game-room.ts` + `shared/logic/pvp.ts`:
  the `question` message and `WireQuizQuestion` carry no answer; the answer appears only
  in DO storage and the `reveal` message.
- [ ] **Tenant fencing is structural.** DO id built as `t:<tenantId>:<code>` with
  tenantId taken from the authenticated session in `handleGameUpgrade`, never from
  client input. Ladder query goes through `db.own(pvpMatches)`. `pvp_match_players` has
  a comment justifying its missing `tenant_id`.
- [ ] **Hibernation discipline** (compare with `workers/live-hub.ts`): `acceptWebSocket`
  not `accept()`, auto-response ping/pong pair, per-socket state in
  `serializeAttachment` ≤2KB, ALL room state in `ctx.storage` (grep the DO for any
  instance field that isn't rebuilt from storage — a bare `this.players = {}` cache
  that's trusted after wake is a real bug).
- [ ] **Auth on the upgrade**: bearer first, cookie fallback, parents rejected, code
  validated `^[A-Z0-9]{4}$`, identity headers overwritten (not merged) on the forwarded
  request, name URI-encoded.
- [ ] **Results rails**: web student posts via the `record-result` intent, mobile via
  `outbox.enqueue` + `flush` (copied from the play route, garden note included). The DO
  never writes mastery/garden.
- [ ] **Ladder math**: win 3 / play 1, per-student per-ICT-day cap of 10, monthly window
  computed with the ICT helpers (`ictDateOf`) — flag ANY `new Date().toISOString()`
  date-bucketing in ladder/month code (known UTC bug class).
- [ ] **Both wrangler env blocks** have the `GAME_ROOM` binding, and migrations gained
  `v5` with `new_sqlite_classes`.
- [ ] **Reset sweep**: `scripts/test-accounts.sql` deletes both new tables, child first.
- [ ] **No paid paths touched**; pronounce absent from every PvP surface.
- [ ] **i18n**: every new user-visible string has en + vi keys on its platform.
- [ ] **Face-off mode** (`/faceoff/:slug`, `src/flashcards/faceoff.tsx`): left/right
  split with each player's ENTIRE board (word, options, feedback, lock overlay) inside
  one swapped-dimensions box rotated `-90deg` (left) / `90deg` (right) toward its
  player's short edge; both progress bars live back-to-back in the central divider
  (nothing in the divider rotates — numerals only); play is fully client-side (no
  fetches between Start and Finish);
  questions built once via `buildQuizQuestions`; reducer logic lives in
  `shared/logic/pvp.ts` (`newFaceoff`/`faceoffAnswer`), not in the component.
- [ ] **Face-off recording**: the `faceoff-result` intent is STAFF-gated (a student
  session gets 403); winner ≠ loser validated; draws are never posted; the inserted
  match uses `mode: 'quiz-faceoff'`, `code: '1V1'`, ranks 1/2 — and NO mastery/garden
  write happens anywhere in the face-off path (the session is the teacher's, not the
  players').

### C. Adversarial reads (where this design can actually break)

- [ ] Race: two players answer at the same ms / a player answers exactly at deadline —
  is grading idempotent (answer recorded once, alarm + early-advance can't both run the
  reveal step twice)? Look for a phase check inside the reveal step.
- [ ] Reconnect: does a rejoining player get the ORIGINAL deadline (not a fresh one)?
- [ ] A room with players who never answer: does the alarm chain still reach `finish`?
- [ ] `players` map vs connected sockets: standings should include disconnected players;
  early-advance ("everyone answered") should count connected players only — or if it
  counts all players, a disconnect must not stall the question past its deadline (the
  alarm covers it — verify the alarm isn't cancelled prematurely).
- [ ] Host quits in lobby: can the room ever start? (Acceptable v1 answer: no — expiry
  reaps it. Flag only if a crash results.)
- [ ] The DO's D1 insert on finish: failure handling — a throw here must not prevent the
  `finish` broadcast players already deserve (order: broadcast, then persist, or
  try/catch with log).
- [ ] `toWireQuiz` image prompts: what happens when `imageOf` is null despite prompt
  'image' (shouldn't occur per builder, but a null crash on phones is worth a look).
- [ ] Mobile: the battle route sits OUTSIDE `(app)` (no tab bar), and the Android back
  button behaves per the app's back rules (detail screens retrace silently).
- [ ] Face-off spam/lockout: a wrong tap locks only that side; taps from a locked side
  and taps after `finished` are no-ops; both-wrong advances the question with no point
  (check the reducer tests assert all three).
- [ ] Face-off question exhaustion: reaching FACEOFF_MAX_QUESTIONS with a tie yields a
  draw (winner null) and the UI offers rematch without posting; higher-score finish
  posts normally.

### D. Deployment state (read-only)

- [ ] `npx wrangler d1 migrations list mochi-class --remote` — the pvp migration is
  applied (the auto-apply Action is often cancelled; if pending, tell the user — do not
  apply without their go-ahead in this session).
- [ ] `cd mobile && npx eas-cli workflow:runs` — top run matches the commit and
  SUCCEEDED, or a manual update was published; verify served `gitSha` via the CLAUDE.md
  curl recipe with `runtimeVersion` read from `shared/version.json`.
- [ ] Spot-check prod serving the new worker: the deployed version stamp `v{build}·{hash}`
  should reflect the pushed commit (see the repo's live-verify notes).

### E. Test quality (read, don't run)

- [ ] `test/pvp.test.ts` asserts real values (speedPoints boundaries, cap at 10, reducer
  walk) — not just "doesn't throw".
- [ ] `test-worker/game-room.test.js` drives a full two-player game and asserts persisted
  rows, not only status codes.
- [ ] `e2e/pvp.spec.ts` uses `crud-helpers` (calendar-test guard, `posted()` waits),
  creates and cleans up its own topic, and doesn't touch the six seeded assessment types
  or four seeded remark criteria.

## Report format

Rank findings Critical / Important / Minor with file:line references. For each: what
breaks, the concrete scenario, and the smallest fix. End with: which checklist sections
passed clean, which suites you did or did not run (and why), and a one-line ship/no-ship
verdict. Do not fix anything unless the user asks after reading the report.
