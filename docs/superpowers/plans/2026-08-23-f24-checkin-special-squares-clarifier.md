# F-24 Clarifier Brief (for the Opus 5 supervising session)

You are the clarifier for the execution of
`docs/superpowers/plans/2026-08-23-f24-checkin-special-squares.md` (spec:
`docs/superpowers/specs/2026-08-23-f24-checkin-special-squares-design.md`). A Sonnet 5 session
executes the plan in one go with a single commit + push at the very end. Your job: answer its
questions, resolve ambiguities WITHOUT reopening locked decisions, and review the final diff
before the commit if asked. You do not write feature code unless the user redirects you.

## The one-paragraph feature

Check-in kiosk boards gain up to two seeded squares: **homework** (label =
`session_previews.homework_text` of the SAME occurrence, authored in the Preview tab) and
**vocab** (present when ≥1 `vocab_assignments` deadline falls in `(previous occurrence, this
occurrence]`). They are real `checklist_items` rows (`kind` column), so taps/bags/misses/tallies
reuse existing machinery. Vocab pre-checks students who met every applicable assignment;
`checklist_check_seeds` makes a teacher's uncheck permanent. New `vocab_assignment_students`
narrows assignments to picked students (zero rows = whole class). Assign UI: "Giao từ vựng"
section in the event dialog's Check-in tab + kiosk checkout shortcut, both posting the existing
`/flashcards` assign intents.

## Locked decisions — do NOT let the executor renegotiate these

Kiosk placement, anyone-taps, auto+override vocab, homework on session_previews, squares COUNT
toward bags/misses/rankings, only-render-when-backed, window `(prev, D]`, both assign surfaces,
join-table scope. Full table in the spec.

## Load-bearing invariants (reject any "simplification" that drops one)

1. **Today-guard** (`date < ictDateOf(now)` → skip seeding) in BOTH `ensureSpecialItems` and
   `seedVocabChecks`. Without it, browsing a past occurrence mints retroactive misses into
   closed months and shifts rankings history.
2. **Seed row written ONLY alongside an auto-inserted check.** Semantics: seed = "the derivation
   checked this pair once". Unmet students get NO seed row (so meeting the bar later still
   auto-checks); derivation never deletes checks (so a manual check on an unmet kid is safe);
   a seeded pair is never auto-written again (so a teacher's uncheck sticks).
3. **Sweep narrowing ships in the same commit as the join table.** `sweepCore` in
   `server/services/garden.ts` must skip non-applicable students, or the nightly garden cron
   penalizes whole classes for assignments narrowed to three kids. `forecastGardenSweep` shares
   `sweepCore` — one fix covers both.
4. **Mobile `homeworkText` round-trip.** `mobile/components/PreviewEditor.tsx` must include
   `homeworkText` in its save payload. The API action parses full `SessionPreviewInput`, where
   the field defaults to `''` — omit it and every mobile preview save silently wipes
   web-authored homework.
5. **Special rows are id-stable and seeder-owned.** `updateItem`/`deleteItem`/`reorderItems`
   refuse `kind !== 'custom'`; the seeder only relabels or deletes-when-unbacked. Never
   delete-then-reinsert on label change (checks hang off the id).
6. **Partial unique index + ON CONFLICT DO NOTHING** is the seeding race guard
   (`uq_checklist_items_special`). If Drizzle's `uniqueIndex().where()` gives the executor
   trouble in `schema.ts`, the SQL migration is the source of truth — the Drizzle mirror may
   express the index without the `where` clause as a last resort (document it in a comment),
   but the SQL must keep the partial predicate.
7. **Tenancy escape comments.** Every new raw query on `checklist_items`, `checklist_checks`,
   `checklist_check_seeds`, `vocab_assignment_students`, `tui_mu_events` needs a
   `// tenant-unscoped:` comment naming its fence, or the tripwire test fails. The fence is
   always an `ownedEvent`/`ownedItem`/own-scoped-assignment read upstream.
8. **Bag semantics.** `phaseComplete`, `evaluateEarn`, `tallyTuiMuMonth`, `setCheck` are
   deliberately UNCHANGED — the whole point of the seeded-rows design. If the executor finds
   itself editing `shared/logic/checkin.ts` beyond the three new pure functions, something went
   wrong.

## Delegated judgment calls (fine to decide locally; keep the spirit)

- Exact `PALETTE` color names for the two squares (`'blue'`/`'green'` if they exist in
  `src/lib/core.js`; otherwise nearest distinct hues). Icons: `book` (homework) / `star` (vocab)
  — both exist in `src/icons.tsx`.
- `Checkbox` prop shape in the AssignModal scope picker — mirror how the modes checkboxes in
  the same file already use it.
- The two e2e mirror-points (topic create/delete steps copied from `e2e/crud-garden.spec.ts`,
  and the assign-dialog title string, which comes from `garden_assign_title`). The assertions in
  the plan are the contract; the setup plumbing follows the sibling spec.
- Whether the AssignModal needs a z-index bump above `.kiosk-overlay` — check, don't assume.
- Label caps (300 chars via `.slice(0, 300)`) and `sortOrder` −2/−1 for specials.

## Codebase gotchas the executor may trip on (answers ready)

- **`npm run typecheck` only.** `tsc -b` emits ~150 stray `.js` files into the tree.
- **Prettier:** never repo-wide; the tree is CRLF and `--check` flags everything. Format only
  touched files.
- **Suites are manual-trigger only.** The executor writes specs and does NOT run
  `npm test`/`test:worker`/`test:e2e*`. The e2e baseline is ZERO failures, so when the user
  later runs them, any failure is real.
- **`/checkin` is cookie-authed, deliberately NOT under `/api/*`** (bearer-only there; browser
  fetchers 401 silently). New web data needs no `/api` twin — the mobile app doesn't render
  kiosk boards; it only needed the `homeworkText` type/editor mirror.
- **`shouldRevalidate` weirdness and `useCachedLoad`:** the web fetch layer is the repo's own
  cache (`src/lib/use-cached-load.js` + `markStale`/`noteLocalMutation`). New payload fields
  flow automatically; stale UI after a mutation usually means a missing `markStale(key)`.
- **Live domains:** `/checkin` action already broadcasts `'checkin'`/`'attendance'`;
  `/flashcards` assign intents broadcast their existing domains. Nothing new to register in
  `shared/live.ts`.
- **The event modal remount trap** (CLAUDE.md): never create component functions inside a
  render. `KioskAssign` is a top-level function in `kiosk.tsx` for exactly this reason.
- **`session_previews` HAS `tenant_id`** (0045); the checklist tables deliberately do NOT.
  `sessionPreviews` reads use `db.own(...)`, checklist reads use raw + escape comment.
- **OpenAPI/api-contract:** the `homeworkText` addition to `SessionPreviewRow` in
  `shared/api-contract.ts` keeps `/api/event-previews` docs honest. If
  `test/api-docs-spec.test.ts` or `api-contract.test.ts` hard-code the old shape, the fix is to
  update the fixture to include the new field — not to drop the contract change.
- **Zod-fixture lesson** (memory): ADDING defaulted/nullish fields is safe; never REMOVE input
  fields — old fixtures keep passing while validation silently narrows.

## Ops facts for the endgame (Task 10)

- **Cloudflare account is ngqv0712@gmail.com, never entag.** D1 commands need
  `CLOUDFLARE_API_TOKEN` in the environment; `wrangler login` is FORBIDDEN (evicts the global
  entag credential). If the token isn't present, the executor must stop and hand the two
  migration commands to the user — this session hit exactly that 7403 earlier.
- **Workers Builds is the deployer** — a push deploys prod within minutes, so the D1 migration
  (`npx wrangler d1 migrations apply mochi-class --remote`) must run immediately after the
  push, then be verified with `d1 migrations list mochi-class --remote` (0053 not pending).
  The GitHub Actions migration run is often cancelled; never trust it.
- **EAS publish workflow has been failing on free CI quota** (as of 2026-08-16). After push:
  `cd mobile && npx eas-cli workflow:runs`; on FAILED/missing, manual publish with
  `--environment preview` (dropping it = pre-frame crash + silent rollback). Workflow-published
  bundles stamp `v0.0000` — trust the gitSha, not the number.
- **Git pushes 403** when GCM picks the stale tech-entag credential — fix with
  `git credential reject` for github.com and retry as vunq-jeremy.
- **No paid APIs anywhere in this feature.** If the executor proposes calling
  `/enrich-vocab`, `/generate-vocab`, image generation, or speech assessment for ANY reason
  (test data included), the answer is no.

## Diff-review checklist (run when the executor says "ready to commit")

- [ ] Migration 0053 matches the Drizzle mirror; both new tables in `scripts/test-accounts.sql`
      (children ABOVE their parents' deletes).
- [ ] Invariants 1–8 above all present in the diff.
- [ ] Five `vocab_assignments` readers narrowed (`studentAssignments`, `activeAssignmentsFor`,
      `studentAssignmentsInMonth`, `assignmentProgress`, `sweepCore`) + CRUD writes join rows +
      `VocabAssignmentRow.studentIds` populated in BOTH `listAssignments` and `getAssignment`.
- [ ] AssignModal preserves stored scope when `rosterStudents` is absent (the /flashcards
      surface) — otherwise editing an assignment there silently widens it to the whole class.
- [ ] i18n EN/VI parity (`npm run check:i18n` green); no hard-coded Vietnamese in components.
- [ ] e2e specs use `posted()` before every post-assert, clean up their rows, and don't touch
      the six seeded assessment types / four remark criteria.
- [ ] ONE commit; changelog entry staged by `scripts/changelog.mjs`; no stray `.js` build
      artifacts (the `tsc -b` symptom) and no repo-wide reformat in the diff.
- [ ] Final report mentions: suites written-not-run + which ones to run, migration status, OTA
      status, and the mobile-test-rule flag for the type-only `mobile/lib` change.
