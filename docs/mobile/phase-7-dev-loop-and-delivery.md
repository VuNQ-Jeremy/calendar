# Phase 7 — Dev loop and delivery

**Depends on:** Phase 6 (the push pipeline it makes functional), Phase 2 (the `expo-updates` install it completes)
**Touches:** `mobile/app.config.ts`, `shared/version.json`, `mobile/.gitignore`, new `mobile/google-services.json`, EAS credentials, a local Android SDK
**Risk:** low in code, medium in operations — three external consoles (Firebase, EAS, Android Studio) and two credentials that cannot be created from this repo
**Deliverable:** a Fast Refresh loop from VS Code to an emulator, push notifications that actually arrive, and OTA updates that actually land.

## Why this phase exists

Phase 6 built the entire notification pipeline — registration, token storage, cron jobs, an
idempotency ledger, deep links, three Android channels — and **it cannot deliver a single
notification.** Phase 2 installed `expo-updates` and wrote two build profiles around channels,
and **no update can reach any device.**

Neither is a bug in the code. Both are missing *credentials and endpoints* that live outside the
repository and were never created. The code has been correct and inert.

This was found on **2026-07-28**, immediately after the first successful APK (build 4,
`750a833d`, `v0.0018`, versionCode 4) was installed and there was finally something real to test
against. That is the honest sequence: four consecutive build failures consumed the attention that
would otherwise have gone to asking "and when it builds, will push work?"

---

## Evidence

Taken from the shipped artifact, not from reasoning about the config. Repeat it any time you
suspect one of these is wrong again — a build log can be misleading, an APK cannot.

```bash
# Download the artifact
curl -sL -o mochi.apk "$(npx eas-cli build:view <BUILD_ID> --json \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).artifacts.buildUrl")"
```

```powershell
# An APK is a zip. AndroidManifest.xml is binary XML, but its string pool is readable UTF-16,
# and resources.arsc holds the string resources the google-services Gradle plugin generates.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead("mochi.apk")
foreach ($n in 'AndroidManifest.xml','resources.arsc') {
  [IO.Compression.ZipFileExtensions]::ExtractToFile($z.GetEntry($n), "$n", $true)
}
$z.Dispose()
$manifest = [Text.Encoding]::Unicode.GetString([IO.File]::ReadAllBytes("AndroidManifest.xml"))
$res      = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes("resources.arsc"))
```

| Marker | Where | Build 4 | Means |
|---|---|---|---|
| `EXPO_UPDATE_URL` | manifest | **absent** | app has no update server to ask |
| `u.expo.dev` | manifest | **absent** | same, confirming it is not set under another key |
| `expo-channel-name` | manifest | **absent** | the `channel: "preview"` in eas.json never reached the binary |
| `EXPO_UPDATES_CHECK_ON_LAUNCH` | manifest | present | the `expo-updates` plugin *did* run — it simply had no URL to write |
| `EXPO_RUNTIME_VERSION` | manifest | present | runtimeVersion is wired correctly |
| `FirebaseMessagingService` | manifest | present | `expo-notifications` bundles firebase-messaging unconditionally |
| `google_app_id` | resources | **absent** | no Firebase config was ever compiled in |
| `gcm_defaultSenderId` | resources | **absent** | same |

The Firebase result is the instructive one. The **library** is in the APK, so nothing fails at
link time or at install time. The **configuration** is not, so `FirebaseApp.initializeApp()` finds
nothing at runtime and throws `Default FirebaseApp is not initialized in this process`. That
exception surfaces inside `getExpoPushTokenAsync`, where `lib/push.ts:110` catches it and logs a
warning:

```ts
} catch (err) {
  // Never fatal. A phone with no Play Services, or offline at sign-in, still has a working app.
  console.warn('[push] register failed', String(err));
  return null;
}
```

That `catch` is correct and should stay — a student on a Play-less handset must still get a
working app. But it means the failure is **silent from the outside**: the app looks healthy, the
server reports `sent: 0`, and every instinct points at the cron or the ledger. Anyone debugging
this without `adb logcat` would lose a day to it.

---

## The three gaps

| # | Gap | Blocks | Fixable in-repo? |
|---|---|---|---|
| 1 | No `updates.url` in app config | OTA — every `npm run update:preview` is a no-op | Yes — task 7.1, **fixed in config; proved only once an APK is built** |
| 2 | No FCM credentials (two of them) | All push, on every device | No — needs Firebase console, task 7.2. **Outstanding, and it gates 7.3 and every row of 7.5 except Fast Refresh** |
| 3 | No `developmentClient` build exists | Fast Refresh from VS Code | Yes — task 7.4, needs an AVD first |

---

## Task 7.1 — Add the EAS Update endpoint ✅ done 2026-07-28

**Status:** applied. `updates.url` is in `app.config.ts` and `shared/version.json` is on
`runtimeVersion: 2`. Verified with `npx expo config --type public` (both fields resolve) and
`tsc --noEmit` (clean, after regenerating `.expo/types` — trap 6 below). **Not yet in any binary:**
the manifest check in the Evidence section still fails until an APK is built, which waits on 7.2.


`expo-updates` is listed in `plugins` at `app.config.ts:73`, but there is no `updates` object
anywhere in the config. The plugin therefore configures a client that checks *nothing*.

**Why this was missed:** `eas update:configure` is the command that normally writes this, and it
can only write a **static `app.json`**. This project uses `app.config.ts` — it has to, because it
reads `shared/version.json` — so the command has nothing to edit and the field must be added by
hand. This is the third time that same limitation has bitten: `extra.eas.projectId` and `owner`
both had to be hand-written for exactly the same reason, and both have comments saying so.

Add to `app.config.ts`, alongside `runtimeVersion`:

```ts
  /**
   * The EAS Update endpoint. Hand-written for the same reason `extra.eas.projectId` is:
   * `eas update:configure` can only edit a static app.json, and this config is a .ts file.
   *
   * Without this the `expo-updates` plugin still runs and still writes
   * EXPO_UPDATES_CHECK_ON_LAUNCH into the manifest — it just has no server to ask, so every
   * published update is silently ignored. Verified absent from build 4's APK; see
   * docs/mobile/phase-7-dev-loop-and-delivery.md.
   *
   * The project id must match `extra.eas.projectId` below.
   */
  updates: {
    url: 'https://u.expo.dev/83251f6c-1fa9-4724-ba61-39a9eb806aab',
    /**
     * 0, not a timeout: never block the splash screen waiting on the network. The app launches
     * from the cached bundle immediately, fetches any update in the background, and applies it
     * on the NEXT launch. A student on a slow connection at the start of class must not stare
     * at a splash screen while we poll a CDN.
     */
    fallbackToCacheTimeout: 0,
  },
```

**Do not set `runtimeVersion` inside `updates`.** It is already a top-level field sourced from
`shared/version.json`, and duplicating it creates two numbers that will drift.

**The channel comes from `eas.json`, not from here.** Each build profile declares
`"channel": "preview"` / `"development"`; EAS stamps it into the binary at build time and maps it
to a branch on first publish. The channels already exist on EAS with empty branch mappings —
which is normal for "no update published yet", and would resolve itself on the first successful
`eas update`. The missing URL is the actual blocker, not the empty mapping.

---

## Task 7.2 — FCM credentials *(operator — cannot be done from this repo)*

Android push is **Expo → FCM → device**. Two separate credentials are needed, at two different
points in the lifecycle, and having only one of them fails just as completely as having neither.

| Credential | Lives | Used at | Purpose |
|---|---|---|---|
| `google-services.json` | in the APK | build time → runtime | lets the *device* register with FCM and obtain a token |
| FCM V1 service account key | on EAS servers | send time | lets *Expo's push service* authenticate to FCM to deliver |

### Steps

1. **Firebase console** → create a project (name it anything; `mochi` is fine — this one is not
   immutable the way the EAS slug was).
2. **Add app → Android.** The package name must be exactly **`com.mochi.lms`** — it must match
   `android.package` in `app.config.ts` character for character. A mismatch produces an APK that
   builds cleanly and fails to register at runtime, with a misleading error.
3. Download **`google-services.json`** → save to `mobile/google-services.json`.
4. Same project → **Project settings → Service accounts → Generate new private key** → save the
   JSON somewhere outside the repo.
5. Upload it to EAS:
   ```bash
   cd mobile
   npx eas-cli credentials -p android
   # → production/preview → Push Notifications (FCM V1) → upload the service account key
   ```
6. **Only if the Firebase API key was restricted** — Google Cloud console → APIs & Services →
   Credentials → the auto-created "Android key". If it has API restrictions applied, **FCM
   Registration API** and **Firebase Installations API** must both be in the allowed list. Expo's
   FCM credentials page calls this out explicitly. A key restricted without them registers no
   tokens and, like everything else in this phase, fails quietly. A brand-new project leaves the
   key unrestricted, so this step is usually a no-op — check it rather than assume it.

### Should `google-services.json` be committed?

**Yes.** It is client configuration, not a secret — every copy of the APK contains it, and it is
extractable in thirty seconds with the commands at the top of this document. The API key it holds
is scoped to the Firebase project and restricted by package name and signing certificate.
Committing it makes any clone able to produce a working build, which is the same reason
`shared/version.json` is committed rather than derived from a developer's environment.

The **service account key from step 4 is a real secret** and must never enter the repo. It goes
to EAS and nowhere else. `mobile/.gitignore` already covers `*.key`, `*.p8`, `*.p12` and `*.jks`;
add nothing for `google-services.json`, and do not let a "safety" `.gitignore` entry sneak in for
it — a missing `google-services.json` on a fresh clone produces the exact silent failure this
whole phase exists to fix.

---

## Task 7.3 — Wire the config and bump runtimeVersion

Once `mobile/google-services.json` exists:

```ts
  android: {
    package: 'com.mochi.lms',
    /**
     * Required for push. Without it the APK still contains firebase-messaging but none of the
     * google_app_id / gcm_defaultSenderId string resources it needs, so FirebaseApp fails to
     * initialise and getExpoPushTokenAsync throws — caught and logged by lib/push.ts, therefore
     * invisible unless you are watching logcat. Committed on purpose; see task 7.2.
     */
    googleServicesFile: './google-services.json',
    ...
```

The bump to `shared/version.json` is **already done** — it went in with task 7.1:

```diff
-  "runtimeVersion": 1
+  "runtimeVersion": 2
```

**One bump covers both changes, and only because nothing has been built in between.** `updates.url`
and `googleServicesFile` are two native changes, but a runtimeVersion only needs to change when a
binary carrying the *old* native surface exists in someone's hands. No APK has been built on `2`
yet, so both changes land in the same first `2` binary. **If a preview APK on runtimeVersion 2 is
distributed before `google-services.json` is added, FCM then requires a bump to 3** — the rule is
per shipped native surface, not per config edit.

**Why the bump is mandatory, not tidiness.** `runtimeVersion` identifies the *native* layer.
Adding FCM changes it: an OTA bundle built expecting a working `getExpoPushTokenAsync` would, if
delivered to the existing runtimeVersion-1 APK, run against a native shell that cannot provide
one. Bumping severs that path deliberately — updates published for `2` will not reach a `1`
device, which is exactly the protection the field exists for.

**Consequence, stated plainly:** the currently installed APK becomes permanently un-updatable.
It must be uninstalled and replaced. That is acceptable precisely once, here, because that APK
can neither receive OTAs nor register for push — it has no capability worth preserving.

Bump `runtimeVersion` **by hand and rarely**. The build number bumps on every commit; if
`runtimeVersion` followed it, every update would orphan every install. The comment at
`app.config.ts:120-129` already says this — this is the first real occasion to act on it.

---

## Task 7.4 — The local build and the Metro loop

### How the connection actually works

VS Code and Android Studio never talk to each other. Android Studio contributes only an emulator
and `adb`. The link is **Metro**, a dev server on the PC that watches the filesystem and serves
the JS bundle over HTTP.

```
VS Code — edit and save
    │  filesystem watch
    ▼
Metro dev server  localhost:8081
    │  HTTP, tunnelled by `adb reverse tcp:8081 tcp:8081`
    ▼
App on emulator — Fast Refresh, ~1s, state preserved
```

For a physical handset it is the same server reached over the LAN by IP, or via `--tunnel` when
the network isolates clients.

**The preview APK cannot do this.** `distribution: internal` with no `developmentClient` flag
produces a binary with the bundle baked in; it has no Metro client. Only the `development`
profile (`eas.json:19-26`) sets `developmentClient: true`.

### Getting a build that can

**Option A — EAS:** `cd mobile && npm run build:dev`. Correct, but a ~15 minute queue per attempt.

**Option B — local, once the Android SDK is installed:**

```bash
cd mobile
npx expo run:android
```

Compiles natively on the PC, installs straight to the running emulator, and starts Metro — one
command. Generates `mobile/android/`, which `.gitignore` already excludes (`/android`).

**Prefer B for this phase specifically.** Tasks 7.2 and 7.3 are native-config changes, and native
config is exactly the kind of thing that needs two or three attempts to get right. At 15 minutes
per EAS round trip that is a bad afternoon; locally it is two minutes with `adb logcat` open
beside it.

### Environment

Nothing to do — `mobile/.env.local` already sets
`EXPO_PUBLIC_API_URL=https://calendar.ngqv0712.workers.dev`, which is what `expo start` reads.
The `env` blocks in `eas.json` cover the EAS builds separately. Both must be kept in sync; the
README already notes this.

### Prerequisites the operator installs

**Re-checked 2026-07-28, after task 7.1.** Android Studio has since been installed, so item 1 is
done and only the emulator image is outstanding:

| Piece | State | Path |
|---|---|---|
| Android Studio | installed | `C:\Program Files\Android\Android Studio` |
| SDK platform | installed — `android-36.1` | `%LOCALAPPDATA%\Android\Sdk\platforms` |
| build-tools | installed — `36.0.0` | `…\Sdk\build-tools` |
| `adb` | present (1.0.41 / 37.0.0), **not on `PATH`** | `…\Sdk\platform-tools\adb.exe` |
| emulator binary | present | `…\Sdk\emulator\emulator.exe` |
| JDK | present (Android Studio's bundled JBR) | `…\Android Studio\jbr` |
| **system image** | **none installed** | `…\Sdk\system-images` is absent |
| **AVD** | **none created** | `%USERPROFILE%\.android\avd` is absent |
| `cmdline-tools` | absent | so there is no CLI `sdkmanager` / `avdmanager` |

1. **An AVD with a Google Play system image.** Not "Google APIs", not a plain AOSP image — push
   requires Play Services on the emulator. Pixel 7 / API 35 or 36, x86_64, is a reasonable default.
   With `cmdline-tools` absent this goes through **Android Studio → Device Manager**, not the CLI;
   the GUI downloads the image as part of creating the device.
2. **`ANDROID_HOME`.** Not currently set (nor `ANDROID_SDK_ROOT`, nor `JAVA_HOME`). React Native's
   Gradle plugin resolves the SDK from it, so `npx expo run:android` fails with "SDK location not
   found" until it is exported, or a `local.properties` with `sdk.dir` exists in the generated
   `android/` folder. Set it once, at the user level:
   ```powershell
   [Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
   ```
   Adding `%ANDROID_HOME%\platform-tools` to `PATH` is what makes bare `adb logcat` work — every
   `adb` line in this document assumes it.

One thing to watch on the first local build: the installed platform is `android-36.1`, and RN 0.86
targets `compileSdk 36`. If Gradle asks for a plain `android-36` it will try to fetch it and, with
no `cmdline-tools`, may need the missing package added from Android Studio's SDK Manager instead.

The APK is universal — build 4 compiled `armeabi-v7a`, `arm64-v8a` **and** `x86_64` — so a
standard x86_64 emulator will install it rather than failing `INSTALL_FAILED_NO_MATCHING_ABIS`.

### What each kind of change costs

| Change | What to do | Cost |
|---|---|---|
| Any `.tsx`, style, or logic edit | Save the file | ~1s, Fast Refresh |
| New JS-only npm package | Restart Metro | ~10s |
| Native module, permission, plugin, `google-services.json` | Full rebuild | 2 min local / 15 min EAS |
| Ship JS to installed preview APKs | `npm run update:preview` | ~1 min |

---

## Task 7.5 — Rebuild and verify

A locally built debug app **cannot test OTA** — debug builds load from Metro by design and
`expo-updates` is inert in them, and a local build has no channel attached. OTA verification
requires an EAS-built APK. Use the local build for writing code; use the EAS build to prove
distribution.

```bash
cd mobile && npm run build:preview      # first APK on runtimeVersion 2
```

### Verification matrix

| # | Check | Command / action | Pass |
|---|---|---|---|
| 1 | Fast Refresh | edit a screen, save | emulator updates in ~1s, navigation state kept |
| 2 | Firebase initialises | `adb logcat \| grep -i "\[push\]"` | **no** `register failed` line |
| 3 | Token registers | log in as a **student** | an `ExponentPushToken[...]` reaches `/api/push/register` |
| 4 | Update URL is in the binary | manifest check from the Evidence section | `u.expo.dev` **present** |
| 5 | Push delivers | force-close app, then `POST /api/push/run?job=class` | `sent: 1` and the notification arrives |
| 6 | Idempotent | run the same call again | `sent: 0` |
| 7 | Channels | Settings → Apps → Mochi → Notifications | **three** separate channels |
| 8 | Cold-start deep link | kill the app, tap a notification | lands on the right screen, not home |
| 9 | OTA | change a string → `npm run update:preview` → reopen | change appears without reinstalling |

Check 5 needs a **student** account. Staff and admin accounts receive nothing from any job — see
"Not in scope" below.

Firing the job needs an admin **bearer** token; `withAuth('admin')` does not accept the web
session cookie, so a browser console `fetch` returns 401.

```bash
BASE=https://calendar.ngqv0712.workers.dev
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"ADMIN_EMAIL","password":"PASSWORD"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).data.token")
curl -s -X POST "$BASE/api/push/run?job=class" -H "Authorization: Bearer $TOKEN"
```

Check 6 is the cheap stand-in for "the cron fires exactly once across three ticks" — same code
path, same ledger, no 45-minute wait.

---

## Acceptance criteria

- [ ] `u.expo.dev` present in the built APK's manifest
- [ ] `google_app_id` present in the built APK's `resources.arsc`
- [ ] `runtimeVersion` is `2` in `shared/version.json` and in the manifest
- [ ] `npx expo run:android` produces a working app on the emulator, and editing a `.tsx` file
      updates it without a rebuild
- [ ] A student login produces a push token server-side
- [ ] `POST /api/push/run?job=class` returns `sent: 1`, the notification arrives on a closed app,
      and a second identical call returns `sent: 0`
- [ ] `npm run update:preview` changes the installed preview APK without reinstalling
- [ ] `mobile/google-services.json` is committed; the service account key is not

---

## Traps already hit

Recorded so the next person does not rediscover them. The first four cost four consecutive failed
builds on 2026-07-28.

| Symptom | Cause | Fix |
|---|---|---|
| Gradle: `versionCode is set to 0` | build number derived from a git count EAS cannot provide | `appVersionSource: "remote"`, EAS owns `versionCode` |
| `ERR_IMPORT_ATTRIBUTE_MISSING` reading app config | Node ESM rejects a JSON import with no `with { type: 'json' }` | read the bytes — `scripts/version-store.mjs` |
| Prebuild: `git history is truncated (1 commits...)` | EAS re-inits the upload as a 1-commit repo; the shallow-clone guard fired | early return on `EAS_BUILD` in `scripts/git-version.mjs` |
| `'eas' is not recognized` | npm scripts called bare `eas` | `npx eas-cli` |
| `eas init` creates junk at the repo root | run from the repo root, which has no `expo` dependency | always run EAS commands from `mobile/` |
| tsc fails on valid `router.push()` calls | stale `.expo/types/router.d.ts`; `expo export` does not regenerate it | `rm -rf .expo/types && npx expo start --clear` |
| 179 stray `.js` files appear in the repo | `tsc -b` has no `noEmit` | `git clean -f -- '*.js'`, never commit them |
| expo-doctor fails on `disableHierarchicalLookup` | deliberate — it keeps the web's `node_modules` out of the native bundle | ignore it; it will fail on every build forever |

---

## Not in scope

- **Class reminders reaching staff.** The Phase 6 plan asks for it; no schema links a staff member
  to a class, so it is a feature rather than a fix. Recorded in
  [`docs/mobile-parity.md`](../mobile-parity.md) under "Knowingly not built". Its practical effect
  here is that push must be tested from a student account.
- **Per-user notification preferences.** `settings` is a school-wide k/v store; per-user prefs need
  a `user_settings` table. Documented at `server/services/notif-prefs.ts:6-14`.
- **iOS.** No `ios.googleServicesFile`, no APNs key, no Apple Developer account. Android only.
