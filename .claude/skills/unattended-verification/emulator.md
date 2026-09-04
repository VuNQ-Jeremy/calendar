# Android emulator — boot, load, drive, prove clean

Facts: AVDs `mochi_dev` (use) and `entag_dev`; binary `%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe`
(not on PATH; `adb` is). App id `com.mochi.lms`, launch scheme `mochi://`. Maestro
(`npm run test:device`) needs a JVM this machine does not have — do not install one; drive with
`scripts/adb-ui.mjs`. Two kinds of build behave differently: a **preview release APK** applies the
`preview` OTA by itself on the first launch after publish; a **dev-client** never does and needs the
deep link in §3.

## 1. Boot and trust the device

```bash
# Bash tool, run_in_background — never foreground. -no-snapshot-load: quickboot would restore a wedged snapshot.
"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -avd mochi_dev -no-snapshot-load -no-boot-anim
```
Then poll `adb shell getprop sys.boot_completed` for `1` (Monitor tool, ≤ 4 min). **`adb devices`
answering is not proof the device works**: after a long driving session the ActivityManager can
wedge so that `am force-stop` and `dumpsys` hang while `adb shell echo` still answers. Probe:

```bash
timeout 5 adb shell am force-stop com.mochi.lms || echo WEDGED   # WEDGED → adb emu kill, boot again with -no-snapshot-load
adb shell dumpsys package com.mochi.lms | grep -m1 versionCode    # the build you think is installed
adb shell input keyevent 224; adb shell wm dismiss-keyguard
```

Installing: `adb install -r <apk>`. A signature clash means a dev-client is on the device —
`adb uninstall com.mochi.lms` first (log it; the dev-client is gone). `eas build` is only
authorized when §0.2 lists it; otherwise take the last `FINISHED` artifact:
`cd mobile && npx eas-cli build:list --platform android --limit 3 --json --non-interactive` →
`artifacts.applicationArchiveUrl`, `curl -L -o`, expect > 30 MB.

## 2. Launch

```bash
adb shell am force-stop com.mochi.lms
adb shell pm clear com.mochi.lms                    # deterministic login screen; nothing durable lives only on the emulator
adb shell am start -n com.mochi.lms/.MainActivity   # release APK
```
Dev-client: the launcher icon opens the dev menu, not the app. Cold-start it with a deep link — local
Metro: `mochi://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081`; the published preview
OTA: see §3. The floating dev-menu bubble overlaps the Calendar `+` FAB; drag it away.

## 3. Prove the OTA reached the device

Release APK: launch, wait ~25 s (the splash checks 3 s + fetches 12 s, then reloads), open **More**,
swipe up to the version row: `v0.0000 · rt<N> · <sha7> · <updateId>`. Pass = `<sha7>` is HEAD and the
row does not end in `embedded`. Stale → force-stop, relaunch, check once more (a slow fetch defers
to the next launch). Still stale → log "OTA not applied on device", continue; every `tapText` that
returns `false` takes an `err-*.png` and moves on.

Dev-client: load the served update by deep link, runtime read from the file, never typed:

```bash
RV=$(node -p "require('./shared/version.json').runtimeVersion")
adb shell am start -a android.intent.action.VIEW -d "mochi://expo-development-client/?url=https%3A%2F%2Fu.expo.dev%2F83251f6c-1fa9-4724-ba61-39a9eb806aab%3Fchannel-name%3Dpreview%26runtime-version%3D${RV}%26platform%3Dandroid"
```
The loaded bundle talks to **production** (`EXPO_PUBLIC_API_URL` from the EAS preview env).

## 4. Drive with `scripts/adb-ui.mjs`

Scratchpad script, Node 24, imported by URL:

```js
import { adb, dump, findText, findContains, tapText, tapXY, type, back, swipeUp, swipeDown, shot, wait }
  from 'file:///F:/code/calendar/scripts/adb-ui.mjs';
const OUT = 'F:/code/calendar/docs/superpowers/reviews/<date>-<feature>-smoke/';
const must = (ok, label) => { if (!ok) { shot(`${OUT}err-${label}.png`); throw new Error(label); } };
const keyboardUp = () => /mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method'));

adb('shell', 'am', 'start', '-n', 'com.mochi.lms/.MainActivity'); await wait(25_000); shot(`${OUT}01-launch.png`);
if (findText('Email')) { tapText('Email'); await wait(800); }            // login lands on the Zalo tab
must(tapText('you@school.edu'), 'email-field'); type('vunq@mochi.edu'); if (keyboardUp()) { back(); await wait(500); }
must(tapText('Password'), 'password-field');   type('mochi123');        if (keyboardUp()) { back(); await wait(500); }
must(tapText('Sign in'), 'sign-in'); await wait(10_000); shot(`${OUT}02-home.png`);
must(tapText('<Tab label>'), 'tab'); await wait(4_000);
if (!findContains('<expected text>')) { swipeDown(); await wait(3_000); }   // pull-to-refresh
shot(`${OUT}03-list.png`); must(findContains('<expected text>'), 'row-visible');
```

Helper contract: `dump()` parses `uiautomator dump` into `{text, desc, cls, bounds, cx, cy}` nodes;
`tapText(label, {contains})` taps the centre of the first match and returns `false` when absent;
`type()` escapes spaces; `shot(path)` pulls the PNG as a file (piping the binary through PowerShell
corrupts it); `back()` is keyevent 4. Submit typed answers by tapping the on-screen button, never
`keyevent 66`.

Traps, each already paid for:
- **`uiautomator dump` cannot settle while anything animates** (a ticking timer, a spinner) and
  silently returns the *previous* dump. Capture coordinates before the animation starts, drive by
  `tapXY`, and verify with screenshots.
- **The keyboard swallows the first back press.** Gate on `mInputShown` before counting presses.
- **The login layout shifts ~90 px** when the "session ended" banner shows — never reuse coordinates
  captured on a clean login screen; re-`dump()`.
- **"Back exited the app" vs "back navigated"** look alike in a screenshot; the truth is
  `adb shell dumpsys activity activities | grep topResumedActivity`. The 5 main tabs are roots
  (back → "Exit Mochi?"), every other screen retraces silently.
- Photo proofs: `adb push <jpg> /sdcard/Pictures/x.jpg` then
  `adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/x.jpg`;
  pick the first large `android.widget.ImageView` node in the picker from a `dump()`.
- Keep the smoke under ~12 PNGs and Read every one; describe each in one line in the log.

## 5. Leave it clean (unconditional — after failure and at the hard stop)

1. Data the smoke wrote on production: delete through the app's UI or action route (the same
   Playwright context that created the fixture), then prove it:
   `npx wrangler d1 execute mochi-class --remote --command "SELECT COUNT(*) AS n FROM <table> WHERE <text> LIKE 'WALKTHROUGH%'"` → `0`,
   and the total equals the `N0` recorded at preflight. A UI delete that fails is a finding; the
   SQL fallback (`DELETE … WHERE … LIKE 'WALKTHROUGH%'`, `wrangler r2 object delete mochi-files/<key>`)
   is used only when §0.2 lists it, and the log says the UI path failed.
2. Device: `adb shell rm /sdcard/Pictures/<pushed>`; `adb shell am force-stop com.mochi.lms`; `adb emu kill`.
3. Repo: `git status --short` shows only the plan file and the PNGs. Scratch scripts stay in the scratchpad.
