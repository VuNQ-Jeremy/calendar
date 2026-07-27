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

## Debugging

- **When a component remounts mysteriously, look up the component tree first.**
  Creating a new component function on every parent render (`React.createElement(
  () => <Child />, ...)` with a fresh arrow function each time) will unmount and
  remount the entire subtree, wiping local state. Check the parent's render path
  before chasing symptoms in the child (event handlers, modals, etc).
