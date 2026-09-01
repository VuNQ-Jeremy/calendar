# Project instructions

## Spending my money

- **Never trigger a paid API call as part of doing a task unless I asked for
  that, in this session, in so many words.** The keys in this project bill a
  real account of mine. There is no "it's only a dollar" — I did not agree to
  the dollar. This is not covered by any standing authorization, and unlike a
  bad commit it cannot be reverted.
- **"Use the session model" / "use the in-session model" / "don't use haiku"
  means YOU generate the content yourself, in the conversation, and write it to
  a file.** It does NOT mean "call the API with a better model id". If I wanted
  an API call I would have said which endpoint. When I name a model in a
  sentence about generating content, I am telling you *who is writing it*, not
  configuring a request.
- **Never add product code whose purpose is to enable a paid path** (a model
  override, a quality tier, a "just this once" flag) so that a task can be
  finished. Ask instead. Building the switch and then flipping it is worse than
  asking, not better.
- **The paid paths in this repo**, so there is no guessing:
  - Anthropic — `/enrich-vocab` and `/generate-vocab`, both through the
    `TranslateProxy` DO. Billed per token, no free tier.
  - Workers AI — `/vocab-image-generate` (`@cf/leonardo/phoenix-1.0`, Flux
    fallback). Billed per image.
  - Azure Speech — `/speech-assess`. F0 free tier with a monthly cap; going over
    it is a real charge and the cap is per-subscription, not per-school.
  - Free, and fine to use without asking: Openverse image search (no key),
    Pixabay (free tier), the Google Docs export endpoints.
- **Before any bulk run that would hit a paid API more than once, tell me the
  request count and the estimated cost, then wait.** Not "I'm about to…" in the
  middle of a tool sequence — stop and let me answer. `--dry-run` first if the
  script has one.
- **A backfill or migration of content is the high-risk case**, because the
  per-call cost looks trivial and the loop runs hundreds of times. Two calls to
  check a format is fine; the same call over 400 rows is a purchase.

## Git

- **Push to `main` only.** Commit and push work to the `main` branch; do not
  create or push to feature branches for this project.
- **Always commit and push to `main` when a task is finished.** After
  completing a piece of work (feature, fix, refactor, etc.), automatically
  stage the relevant files, commit, and push to `main` without waiting to be
  asked — this is standing authorization for that specific action, not for
  other risky git operations (force-push, reset, etc.).

## Versioning

- **Add a changelog entry on every push to `main`.** Run
  `node scripts/changelog.mjs "1-2 line summary"` as part of your final commit.
  It stages `CHANGELOG.md` for you.
- **The build number is derived from the git commit count** — never store or
  hand-edit it. `shared/version.json` holds only `major`, `buildOffset`, and
  `runtimeVersion`, all of which change rarely. This is what keeps parallel work
  from several machines from conflicting on a counter.
- **Bump the major only at real milestones**, with
  `node scripts/changelog.mjs --major "…"`.
- **`runtimeVersion` is not the app version.** It gates Expo OTA updates: an
  update only reaches an installed APK whose `runtimeVersion` matches. Bump it by
  hand, only when native dependencies change.

## Publishing to the mobile app (OTA)

- **Every push to `main` must end with a published OTA update.** The EAS workflow
  `mobile/.eas/workflows/publish-preview-update.yml` does this automatically (Expo
  GitHub App → run `eas update` on push, branch `preview`, environment `preview`).
  A git push alone does NOT reach phones — only a successful workflow run or a
  manual `eas update` does.
- **After pushing, verify the run fired and succeeded:**
  `cd mobile && npx eas-cli workflow:runs` — the top entry should be your commit
  with `Status SUCCESS` and `Trigger Type GitHub` (allow a minute or two). A failed
  or missing run means phones silently keep the old bundle.
- **Manual fallback** (also the command for ad-hoc publishes):
  `cd mobile && npx eas-cli update --branch preview --platform android --environment preview --message "..."`
  Never drop `--environment preview` — it supplies `EXPO_PUBLIC_API_URL`; without
  it the published bundle boots with no API base URL (and historically crashed
  pre-frame and was silently rolled back — see `mobile/lib/api.ts`).
- **Delivery is verifiable without a device.** The served update for this app is:
  `curl -s -H "expo-platform: android" -H "expo-runtime-version: $(node -p "require('./shared/version.json').runtimeVersion")" -H "expo-channel-name: preview" -H "expo-protocol-version: 1" -H "accept: multipart/mixed" https://u.expo.dev/83251f6c-1fa9-4724-ba61-39a9eb806aab`
  — grep the body for `"gitSha"`: it must equal the commit you pushed. **Read the
  runtime version from `shared/version.json`, never hardcode it.** Each runtime
  version is its own update track, so asking for a stale one returns the last update
  published before the bump — an old `gitSha` that looks exactly like a broken
  pipeline. (This wasted a debug cycle on 2026-08-14: the doc said `2`, the real
  value was `3`.) Phones apply the update on the **first** launch after publish:
  `mobile/lib/updates.ts` checks, downloads and reloads inside the splash screen. If
  the connection is too slow for its budgets it falls back to the next launch.
- **Known wart:** workflow-published bundles stamp `v0.0000` in the in-app version
  row (EAS's checkout has no git history for the commit count). The `gitSha` in the
  stamp is still correct; trust the sha, not the number.

## End-to-end tests

- **Every new feature, mutation intent, or data object ships with an e2e spec in
  the same commit.** When you add or change a route action intent, a dialog, or a
  table, extend the matching `e2e/crud-*.spec.ts` (or create a new one) with a
  UI-driven lifecycle test — create → edit/variants → delete, through the real
  dialogs. The suite's contract is that every write path is exercised end to end;
  don't let it rot back to partial coverage.
- **A user-visible feature also updates the walkthrough catalogue in the same
  commit.** New screen, new dialog, renamed button — if a person would meet it on
  a manual pass of `/walkthrough`, the story in `shared/walkthrough.ts` that
  covers it changes too (or a new story is added: goto-first, fill values
  prefixed `WALKTHROUGH`, cleanup last — `test/walkthrough.test.ts` enforces the
  shape). The tour targets literal English UI strings, so a copy change silently
  breaks a spotlight.
- **Run against the isolated test env, never production.** `npm run
  test:e2e:staging` resets the `calendar-test` D1 to seed data and runs the whole
  suite (~4 min). CRUD specs are guarded in `e2e/crud-helpers.ts` and skip unless
  `E2E_BASE_URL` contains `calendar-test`. Provisioning / redeploying the test
  env: `npm run test:env:setup` (needs the ngqv0712 wrangler login; the env is
  selected at BUILD time via `CLOUDFLARE_ENV=test` — never `wrangler deploy
  --env test`, which silently ships prod config).
- **Test suites are manual-trigger only — never run one on your own.** That means
  `npm test` / `npm run test:watch` / `npm run test:worker` (unit) and `npm run
  test:e2e` / `npm run test:e2e:staging` (plus the `npm run test:env:setup`
  deploy it depends on). They run ONLY when I explicitly ask for them in that
  session. A suite is not a definition-of-done gate, not part of the commit/push
  routine, and not something to run "to be safe" before reporting a task
  finished — the unit suite is slow to come back and the staging one costs ~4 min
  and redeploys calendar-test, so an unasked-for run is a real cost, not a free
  precaution. Write and commit the specs as required above; leave running them to
  me. When a change plausibly affects behaviour a suite covers, say so in one
  line and let me decide — don't run it and don't wait on an answer.
- **What you may run freely** is the fast static checks: `npx tsc --noEmit -p
  tsconfig.json` (or `npm run typecheck`), `npm run lint`, `npm run check:i18n`,
  `npm run format`. Those are the checks to lean on before a commit. The mobile
  logic suite — `cd mobile && npm test` — belongs in that list too: it is vitest in
  plain Node, runs in about a second, and touches nothing outside the process.
- **The mobile app has its own three layers** (`docs/mobile/TESTING.md`), and only
  the first is free:
  - `cd mobile && npm test` — free, ~1s. Needs Node 24 (`node:sqlite`).
  - `cd mobile && npm run test:bundle` — an `expo export` plus the packaging guard,
    about a minute. Fine to run when packaging or `app.config.ts` changed; not part
    of the routine.
  - `cd mobile && npm run test:device` — Maestro on an emulator. **Manual-trigger
    only**, exactly like the e2e suite. Never run it unasked.
- **A change under `mobile/lib/` ships with a mobile test in the same commit**, the
  same rule the web features follow above. `lib/` is where the offline queue and the
  HTTP client live: the two places where a silent regression costs a student their
  finished work rather than showing an error.
- **Use the helper kit in `e2e/crud-helpers.ts`** — it encodes the app's UI
  contract: no `<form>`/`name=` attributes (locate inputs structurally by their
  `.mochi-field` label), combobox/date menus portalled to `document.body` (locate
  options from `page` with exact names), and dialogs that close optimistically
  before the server responds (always `await posted(path)` — the POST to
  `<path>.data` — before asserting on the re-rendered list).
- **New tables must be added to the reset sweep.** `seed.sql` predates several
  tables, so `scripts/test-accounts.sql` deletes them explicitly — otherwise a
  failed run leaks rows into the next reset. When a migration adds a table that
  specs will write to, add its `DELETE FROM …;` there in the same commit.
- Test accounts: staff `dev@mochi.edu`, student `vunq@mochi.edu` (both
  `mochi123`, re-hashed on every reset). Specs create their own throwaway rows
  (unique `E2E … ${Date.now()}` names) and clean up after themselves; don't
  mutate the six seeded assessment types or the four seeded remark criteria —
  other specs and seeded score rows depend on them.

## Debugging

- **When a component remounts mysteriously, look up the component tree first.**
  Creating a new component function on every parent render (`React.createElement(
  () => <Child />, ...)` with a fresh arrow function each time) will unmount and
  remount the entire subtree, wiping local state. Check the parent's render path
  before chasing symptoms in the child (event handlers, modals, etc).
