/**
 * Build-time git facts. Runs in Node only (vite.config.ts, mobile/app.config.ts,
 * scripts/changelog.mjs) — never in the browser or React Native.
 *
 * The build number is DERIVED from the commit count rather than stored, so every clone on
 * every machine computes the same number for the same commit and parallel work can never
 * conflict on a counter. See docs/mobile/phase-0-shared-extraction.md.
 */
import { execSync } from 'node:child_process';

function git(cmd, fallback) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    // No git on PATH, no .git directory (tarball / shallow CI checkout), or a detached
    // state with no commits. Never throw — a build must not depend on version metadata.
    return fallback;
  }
}

/** Commit count on the current branch. 0 outside a git checkout. */
export function gitBuild() {
  return Number(git('git rev-list --count HEAD', '0')) || 0;
}

/** Short commit SHA, or 'dev' outside a git checkout. */
export function gitSha() {
  return git('git rev-parse --short HEAD', 'dev');
}
