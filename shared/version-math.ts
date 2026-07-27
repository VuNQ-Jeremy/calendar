/**
 * The version formulas, with the stored numbers passed IN rather than imported.
 *
 * Split out of version.ts for one reason: version.ts does `import v from './version.json'`,
 * and Node cannot load a bare JSON import from an ESM graph without an import attribute.
 * `mobile/app.config.ts` is evaluated by Node (via Expo's config loader), so it reads
 * version.json itself and calls these. The browser and React Native go through version.ts,
 * where their bundlers handle the JSON import fine.
 *
 * Keep this file free of imports. That is the whole point of it.
 */

/** Raw `git rev-list --count HEAD` -> this project's build number. */
export function resolveBuildWith(buildOffset: number, commitCount: number): number {
  return Math.max(0, commitCount - buildOffset);
}

/** formatVersionWith(0, 42) === 'v0.0042' */
export function formatVersionWith(major: number, build: number): string {
  return `v${major}.${String(build).padStart(4, '0')}`;
}

/**
 * Android requires a monotonically increasing integer. `major * 10000 + build` stays
 * monotonic across major bumps: v0.9999 -> 9999, v1.0000 -> 10000.
 */
export function versionCodeWith(major: number, build: number): number {
  return major * 10_000 + build;
}
