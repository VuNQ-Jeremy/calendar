import type { ExpoConfig } from 'expo/config';
// version-math.ts, not version.ts: this file is evaluated by Node (Expo's config loader), and
// version.ts does `import v from './version.json'`, which Node's ESM loader rejects without an
// import attribute. So the stored numbers are imported here and passed in — same formulas, one
// source of truth. The `.ts` extension is required: Node's extensionless resolution would find
// ../shared/version.json before ../shared/version.ts and hand back an object with no functions.
import stored from '../shared/version.json';
import { formatVersionWith, versionCodeWith, resolveBuildWith } from '../shared/version-math.ts';
import { gitBuild, gitSha } from '../scripts/git-version.mjs';

/**
 * A TypeScript config, not app.json, so it can read shared/version.ts — the same module the
 * web app's version stamp uses. See docs/mobile/phase-0-shared-extraction.md.
 *
 * The build number is DERIVED from the git commit count at build time. Nothing stores it, so
 * two machines building the same commit produce the same version.
 */
const build = resolveBuildWith(stored.buildOffset, gitBuild());
const BRAND = '#F79A4E'; // ramp.orange[400] — shared/tokens.ts

const config: ExpoConfig = {
  name: 'Mochi',
  slug: 'mochi',
  scheme: 'mochi',
  version: formatVersionWith(stored.major, build), // "v0.0042"
  orientation: 'portrait',
  userInterfaceStyle: 'light', // The design system is a single warm cream theme. No dark mode.
  icon: './assets/images/icon.png',
  android: {
    package: 'com.mochi.lms',
    versionCode: versionCodeWith(stored.major, build), // monotonic integer — Android rejects a repeat
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: BRAND,
    },
    permissions: ['INTERNET', 'POST_NOTIFICATIONS'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    'expo-localization',
    'expo-updates',
    // Config plugins for the native modules installed up front in task 2.1. They are all listed
    // HERE rather than in an app.json, because this file discards the config object Expo passes
    // it — two sources would silently lose whichever one lost the merge.
    'expo-sqlite',
    'expo-sharing',
    'expo-audio',
    [
      'expo-splash-screen',
      { image: './assets/images/splash-icon.png', resizeMode: 'contain', backgroundColor: BRAND },
    ],
    [
      'expo-notifications',
      { icon: './assets/images/notification-icon.png', color: BRAND },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    // eas.projectId is written here by `eas init` — do not hand-edit it.
    gitSha: gitSha(),
    build,
    // Mirrored into `extra` so a build that forgot the env var fails loudly at startup with a
    // clear message rather than firing requests at a relative URL. Public by definition.
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? null,
  },

  /**
   * NOT `{ policy: 'appVersion' }`, and NOT the build number.
   *
   * An OTA update only reaches an installed APK whose runtimeVersion MATCHES. The build
   * number bumps on every single push — if runtimeVersion followed it, every update would
   * orphan every installed APK and force a reinstall, which destroys the entire point of OTA.
   *
   * runtimeVersion lives in shared/version.json and is bumped BY HAND, only when native
   * dependencies change (new native module, new permission, plugin change).
   */
  runtimeVersion: String(stored.runtimeVersion),
};

export default config;
