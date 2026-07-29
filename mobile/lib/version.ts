import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

/**
 * The build stamp: `v0.0042 · rt1 · a1b2c3d · <updateId>`.
 *
 * With OTA updates this is the ONLY reliable way to know what a phone is actually running —
 * the APK's version and the JS bundle's version diverge the moment an update ships. All four
 * parts matter:
 *
 *   version   the derived build number (git commit count), from app.config.ts
 *   rtN       runtimeVersion — which APKs this bundle is even allowed to reach
 *   sha       the commit, for going straight to the code
 *   updateId  which OTA bundle, or `embedded` if the APK's original JS is still running
 */
export function versionStamp(): string {
  const cfg = Constants.expoConfig;
  const extra = (cfg?.extra ?? {}) as { gitSha?: string };
  const version = cfg?.version ?? 'v?';
  const runtime = cfg?.runtimeVersion ?? '?';
  const sha = extra.gitSha ?? 'dev';
  // `isEmbeddedLaunch`, NOT `updateId ? … : 'embedded'` — updateId is non-null on an embedded
  // launch too (it is the embedded manifest's own id), so the old check could never say
  // `embedded` and an APK that had never applied an OTA looked like it was running one
  // (2026-07-29: that misread cost a debugging detour).
  const update = Updates.isEmbeddedLaunch ? 'embedded' : (Updates.updateId?.slice(0, 8) ?? '?');
  return `${version} · rt${runtime} · ${sha} · ${update}`;
}

/**
 * The same stamp, attached to every feedback submission via `FeedbackInput.appVersion`. A bug
 * report from an unknown bundle is nearly useless once OTA updates are in play.
 */
export function appVersionForFeedback(): string {
  return versionStamp();
}
