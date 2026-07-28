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
  /**
   * `mochi-class`, not `mochi`, and it has to stay that way.
   *
   * This must match the slug of the EAS project named by `extra.eas.projectId` below, and Expo
   * does not allow a project slug to be renamed after creation. The project was created as
   * `mochi-class`, so this follows it. Nothing user-facing is affected: the app is named "Mochi"
   * (`name` above), installs as `com.mochi.lms`, and deep-links on the `mochi://` scheme. The
   * slug only appears in expo.dev URLs.
   */
  slug: 'mochi-class',
  /**
   * The EAS account that owns this project. Required because the config is dynamic: with a
   * static app.json, `eas init` writes this itself; with app.config.ts it cannot, and without it
   * EAS cannot tell which of the signed-in accounts to publish to.
   */
  owner: 'vu-nguyens-team',
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
    // A required peer of expo-audio, not a direct import of ours. `expo-doctor` flags it as
    // missing because a native peer must be a direct dependency — outside Expo Go it is not
    // hoisted for you, and the app crashes when audio first loads an asset.
    'expo-asset',
    // Phase 4 needs these two: a WebView to show a material (it can send the bearer header,
    // which expo-web-browser cannot), and the native date/time picker for event times and the
    // long-press "Move to…" reschedule. Installed BEFORE the first APK on purpose — adding a
    // native module after one ships means a runtimeVersion bump and a reinstall for every phone.
    '@react-native-community/datetimepicker',
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
    /**
     * The EAS project this app publishes to.
     *
     * Hand-written, and it has to be: `eas init` can only auto-write a STATIC app.json, and this
     * config is a .ts file (it has to be — it reads shared/version.json). Run from the wrong
     * directory, `eas init` silently creates an app.json at the repo root instead, which links
     * the web app rather than this one. If you ever re-run it, run it from `mobile/` and copy the
     * id it prints to here.
     *
     * `lib/push.ts` passes this to `getExpoPushTokenAsync` — without it, no push token, no
     * notifications.
     */
    eas: { projectId: '83251f6c-1fa9-4724-ba61-39a9eb806aab' },
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
