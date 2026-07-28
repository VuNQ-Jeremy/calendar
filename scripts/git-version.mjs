/**
 * Build-time git facts. Runs in Node only (vite.config.ts, mobile/app.config.ts,
 * scripts/changelog.mjs) — never in the browser or React Native.
 *
 * The build number is DERIVED from the commit count rather than stored, so every clone on
 * every machine computes the same number for the same commit and parallel work can never
 * conflict on a counter. See docs/mobile/phase-0-shared-extraction.md.
 */
import { execSync } from 'node:child_process';

function git(cmd, fallback, timeout) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], timeout })
      .toString()
      .trim();
  } catch {
    // No git on PATH, no .git directory (tarball / shallow CI checkout), or a detached
    // state with no commits. Never throw — a build must not depend on version metadata.
    return fallback;
  }
}

/**
 * Cloudflare Workers Builds — the deployer — clones at depth 1, and offers no clone-depth
 * setting to turn that off. A depth-1 clone counts 1 commit, which collapses the version to
 * v0.0000; that is exactly what shipped before this existed. So deepen the clone ourselves
 * before counting. The repo is public, so the fetch needs no credentials.
 *
 * Best-effort by design: if it fails, the count stays short and `resolveBuildWith` throws,
 * which fails the build loudly rather than deploying a wrong version number.
 */
function deepenShallowClone() {
  if (git('git rev-parse --is-shallow-repository', 'false') !== 'true') return;
  git('git fetch --unshallow --quiet origin', '', 120_000);
}

/** Commit count on the current branch. 0 outside a git checkout. */
export function gitBuild() {
  deepenShallowClone();
  return Number(git('git rev-list --count HEAD', '0')) || 0;
}

/**
 * Short commit SHA, or 'dev' outside a git checkout.
 *
 * EAS Build is the one place that is "outside a git checkout" while still building a real,
 * distributable app: it uploads an archive of the committed files WITHOUT `.git`, so every git
 * command there fails. It does export the commit it built from as an environment variable, and
 * using it matters — the sha is what makes a bug report from an installed APK traceable to a
 * line of code, and 'dev' on a shipped build would throw that away.
 *
 * The commit COUNT has no such fallback, which is why the Android versionCode is EAS's job
 * rather than this file's. See the comment in mobile/eas.json.
 */
export function gitSha() {
  const fromEas = process.env.EAS_BUILD_GIT_COMMIT_HASH;
  if (fromEas) return fromEas.slice(0, 7);
  return git('git rev-parse --short HEAD', 'dev');
}
