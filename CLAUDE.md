# Project instructions

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
  `curl -s -D - -o /dev/null -H "expo-platform: android" -H "expo-runtime-version: 2" -H "expo-channel-name: preview" -H "expo-protocol-version: 1" -H "accept: multipart/mixed" https://u.expo.dev/83251f6c-1fa9-4724-ba61-39a9eb806aab`
  — the `expo-update-id` header is what phones get. Phones apply it on the second
  launch after publish (download on the first, apply on the next).
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
- **Run against the isolated test env, never production.** `npm run
  test:e2e:staging` resets the `calendar-test` D1 to seed data and runs the whole
  suite (~4 min). CRUD specs are guarded in `e2e/crud-helpers.ts` and skip unless
  `E2E_BASE_URL` contains `calendar-test`. Provisioning / redeploying the test
  env: `npm run test:env:setup` (needs the ngqv0712 wrangler login; the env is
  selected at BUILD time via `CLOUDFLARE_ENV=test` — never `wrangler deploy
  --env test`, which silently ships prod config).
- **A feature isn't done until the full suite is green** against calendar-test:
  `npm run test:env:setup` to deploy your change there, then the staging run.
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
