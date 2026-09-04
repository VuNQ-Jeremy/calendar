---
name: unattended-verification
description: Use when writing or executing a long unattended plan (an overnight run) that must verify a shipped Mochi feature through Playwright, curl against the deployed Worker, or the Android emulator — and for any single plan step that drives a browser, adb, or a test suite without the user present.
---

# Unattended verification

## Overview

A long autonomous run cannot ask. So the **plan is the authorization**, the **reference files are the
memory**, and the **executor only observes, records and cleans up**. Every trap in this skill has
already cost a debugging cycle; the reference files exist so no session rediscovers one.

Two roles use this skill:

- **Planner** — writing the verification phase of a plan. Copy `plan-template.md` and fill every
  REQUIRED slot with values you verified by running the command next to the slot, today.
- **Executor** — running that plan. Read the plan's §0 first, then the reference file for the step
  in front of you. Never work from memory of a previous run.

## The contract

1. **Authorization is a list of exact commands** in the plan's §0.2 (`npm run test:e2e:staging`,
   `npx eas-cli build …`, the emulator, "WALKTHROUGH rows on class X"). A command not on the list
   is not granted: the executor ticks the step as `skipped — not authorized` and continues. A plan
   cannot grant what CLAUDE.md forbids outright (paid APIs, `wrangler deploy`, `git add -A`).
2. **Production writes are WALKTHROUGH-prefixed, on the class named in §0.2, and paired with a
   cleanup step that runs unconditionally** — after a failure, after the hard stop — and ends with
   a count query that must print zero. Cleanup goes through the app's own UI or action route;
   direct D1/R2 deletes are a fallback that must itself be listed in §0.2.
3. **The baseline is in the plan, verbatim.** A failure is compared by spec file + test title. Before
   calling a new red "yours", confirm the deployed stamp (`v0.NNNN · <sha>`) is your commit —
   another session may have redeployed. No second run "to confirm"; no widening the baseline list.
4. **Machine facts are re-verified when the plan is written** (paths, AVD names, Node version,
   installed APK, runtimeVersion) with the command given in the template, and dated. Copying last
   month's table is how a stale runtime version wastes a cycle.
5. **Scratch scripts live in the scratchpad directory, never in the repo**, and import repo modules
   by `file:///F:/code/calendar/…` URL (a bare `import 'playwright'` cannot resolve from outside
   the repo). Screenshots are read with the Read tool and described in the log, one line each.
6. **Waiting is never a foreground sleep.** Long processes start with `run_in_background`; polls
   use the Monitor tool or a bounded background loop. A `sleep 60` in a plan step is a bug.
7. **A dry step touches nothing.** When the step is "write the commands" or "write the spec", the
   executor does not run adb, curl, wrangler or Playwright to check its own draft.

## Quick reference

| Doing | Read |
|---|---|
| Writing a plan's §0 and verification phase | `plan-template.md` |
| Writing or fixing an e2e spec; screenshotting a deployed page; running staging from a plan; curl against authed routes | `playwright.md` |
| Booting the emulator, loading the OTA, driving the app with adb, proving cleanup | `emulator.md` |

## Common mistakes

- Treating a plan step ("run the e2e suite") as the grant. The grant is the §0.2 list.
- A `.tmp-*.mjs` at the repo root. It gets swept into someone's commit; the scratchpad does not.
- Hardcoding the runtime version in the OTA curl. Read `shared/version.json`.
- Trusting `uiautomator dump` while anything on screen animates — it returns the previous dump.
- Reading a `.data` POST body as JSON. It is turbo-stream; assert on status and rendered UI.
- `git checkout -- <file>` to undo a formatting false positive on a file another session may hold.
