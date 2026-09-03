import type { ExpoConfig } from 'expo/config';
// version-math.ts, not version.ts: this file is evaluated by Node (Expo's config loader), and
// version.ts does `import v from './version.json'`, which Node's ESM loader rejects without an
// import attribute. So the stored numbers are passed in — same formulas, one source of truth.
// The `.ts` extension is required: Node's extensionless resolution would find
// ../shared/version.json before ../shared/version.ts and hand back an object with no functions.
//
// The numbers themselves come through a .mjs helper for that same reason, one level down:
// importing the JSON *here* fails on the EAS build worker with ERR_IMPORT_ATTRIBUTE_MISSING.
// scripts/version-store.mjs has the full story; a preview build died on it.
// versionCodeWith() is deliberately not imported: EAS owns android.versionCode now. The web
// build still uses it via shared/version.ts.
import { formatVersionWith, resolveBuildWith } from '../shared/version-math.ts';
import { gitBuild, gitSha } from '../scripts/git-version.mjs';
import { storedVersion } from '../scripts/version-store.mjs';

/**
 * A TypeScript config, not app.json, so it can read shared/version.ts — the same module the
 * web app's version stamp uses. See docs/mobile/phase-0-shared-extraction.md.
 *
 * The build number is DERIVED from the git commit count at build time. Nothing stores it, so
 * two machines building the same commit produce the same version.
 */
const stored = storedVersion();
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
    /**
     * Required for push, and its absence is invisible.
     *
     * `expo-notifications` bundles firebase-messaging unconditionally, so without this the APK
     * still contains all the Firebase CODE and none of the google_app_id / gcm_defaultSenderId
     * string RESOURCES the google-services Gradle plugin generates from this file. FirebaseApp
     * then fails to initialise, getExpoPushTokenAsync throws, and lib/push.ts:110 catches it and
     * logs a warning — correctly, so a Play-less handset still gets a working app. The cost is
     * that push is dead while the app looks healthy and the server reports `sent: 0`. Verified
     * absent from build 4's resources.arsc; see docs/mobile/phase-7-dev-loop-and-delivery.md.
     *
     * The file is COMMITTED on purpose — client config, not a secret, extractable from any APK.
     * mobile/.gitignore explains at length why it must not be ignored. The package_name inside it
     * must equal `package` above exactly, or the app builds cleanly and never registers a token.
     */
    googleServicesFile: './google-services.json',
    /**
     * NO `versionCode` here on purpose.
     *
     * eas.json sets `appVersionSource: "remote"`, which makes EAS the owner of this value —
     * Expo's docs are explicit that a versionCode in app config is then ignored, so leaving one
     * would be a number that looks authoritative and is not. It was removed because the derived
     * one collapsed to 0 on the build machine (no `.git` in the uploaded archive) and Gradle
     * rejects `versionCode 0`. The long version is in eas.json.
     */
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: BRAND,
    },
    // CAMERA/RECORD_AUDIO/READ_MEDIA_* were added on 2026-09-04 for Practice (Nhiệm vụ): a
    // student photographs or films their finished work as proof. Adding them is a NATIVE change,
    // which is why shared/version.json's runtimeVersion went 3 -> 4 in the same commit.
    permissions: [
      'INTERNET',
      'POST_NOTIFICATIONS',
      'CAMERA',
      'RECORD_AUDIO',
      'READ_MEDIA_IMAGES',
      'READ_MEDIA_VIDEO',
    ],
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
    // Practice proof: on-device video compression before upload. A minute of 1080p is far past
    // the 50 MB ceiling, and a student on 4G should not be paying for the raw file.
    'react-native-compressor',
    [
      'expo-image-picker',
      {
        cameraPermission: 'Mochi dùng camera để chụp minh chứng nhiệm vụ.',
        microphonePermission: 'Mochi dùng micro khi quay video minh chứng.',
      },
    ],
    [
      'expo-splash-screen',
      { image: './assets/images/splash-icon.png', resizeMode: 'contain', backgroundColor: BRAND },
    ],
    ['expo-notifications', { icon: './assets/images/notification-icon.png', color: BRAND }],
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
   * The EAS Update endpoint. Hand-written for the same reason `extra.eas.projectId` is:
   * `eas update:configure` can only edit a static app.json, and this config is a .ts file.
   *
   * Without this the `expo-updates` plugin still runs and still writes
   * EXPO_UPDATES_CHECK_ON_LAUNCH into the manifest — it just has no server to ask, so every
   * published update is silently ignored. Verified absent from build 4's APK (no EXPO_UPDATE_URL,
   * no `u.expo.dev`); see docs/mobile/phase-7-dev-loop-and-delivery.md.
   *
   * The project id must match `extra.eas.projectId` above. The CHANNEL is not set here — each
   * eas.json build profile declares its own and EAS stamps it into the binary at build time.
   *
   * Deliberately no `runtimeVersion` key inside this object: it is already a top-level field
   * sourced from shared/version.json, and two copies would drift.
   */
  updates: {
    url: 'https://u.expo.dev/83251f6c-1fa9-4724-ba61-39a9eb806aab',
    /**
     * 0, not a timeout: the NATIVE layer never blocks on the network. A student on a slow
     * connection at the start of class must not stare at a splash screen while Android polls a
     * CDN with no time limit it can explain.
     *
     * The update is still applied on the first launch — `lib/updates.ts` does it in JS, inside the
     * splash the root layout already holds, with its own bounded budgets. That is deliberate rather
     * than raising this number: this value is baked into AndroidManifest at build time
     * (`EXPO_UPDATES_LAUNCH_WAIT_MS`), so tuning it needs a new APK, while the JS version ships over
     * OTA like everything else.
     */
    fallbackToCacheTimeout: 0,
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
