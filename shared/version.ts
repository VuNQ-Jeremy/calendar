import v from './version.json';
import { formatVersionWith, resolveBuildWith, versionCodeWith } from './version-math';

/**
 * Version formatting, shared by the web app and the mobile app.
 *
 * The displayed version is `v{major}.{build}`, e.g. `v0.0042`:
 *   - `major` is stored in version.json and bumped by hand at milestones only.
 *   - `build` is DERIVED from `git rev-list --count HEAD` at build time and injected
 *     (web: vite `define`; mobile: app.config.ts). Nothing stores it, so parallel work
 *     from several machines can never conflict on a counter.
 *
 * This module runs in the browser and in React Native, so it cannot call git itself —
 * see scripts/git-version.mjs for the Node side.
 */

export const MAJOR = v.major;

/**
 * Commits that predate versioning. Subtracted from the raw commit count so the sequence
 * starts at v0.0001 with the commit that introduced it, rather than at the repo's history
 * depth. Set once; never change it, or every previously shipped version renumbers.
 */
export const BUILD_OFFSET = v.buildOffset;

/**
 * Native compatibility version for Expo OTA updates. Deliberately SEPARATE from the build
 * number: an update only reaches an installed APK whose runtimeVersion matches, so tying
 * this to a per-commit counter would orphan every install on every push. Bump it by hand,
 * only when native dependencies change.
 */
export const RUNTIME_VERSION = v.runtimeVersion;

// The formulas live in version-math.ts so mobile/app.config.ts can use them from Node
// without pulling in the JSON import. These wrappers just bind the stored numbers.

/** Raw `git rev-list --count HEAD` -> this project's build number. */
export function resolveBuild(commitCount: number): number {
  return resolveBuildWith(BUILD_OFFSET, commitCount);
}

/** formatVersion(42) === 'v0.0042' */
export function formatVersion(build: number): string {
  return formatVersionWith(MAJOR, build);
}

/** Monotonic integer for Android's versionCode. */
export function versionCode(build: number): number {
  return versionCodeWith(MAJOR, build);
}
