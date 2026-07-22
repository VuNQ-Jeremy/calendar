# Project instructions

## Git

- **Push to `main` only.** Commit and push work to the `main` branch; do not
  create or push to feature branches for this project.
- **Always commit and push to `main` when a task is finished.** After
  completing a piece of work (feature, fix, refactor, etc.), automatically
  stage the relevant files, commit, and push to `main` without waiting to be
  asked — this is standing authorization for that specific action, not for
  other risky git operations (force-push, reset, etc.).

## Debugging

- **When a component remounts mysteriously, look up the component tree first.**
  Creating a new component function on every parent render (`React.createElement(
  () => <Child />, ...)` with a fresh arrow function each time) will unmount and
  remount the entire subtree, wiping local state. Check the parent's render path
  before chasing symptoms in the child (event handlers, modals, etc).
