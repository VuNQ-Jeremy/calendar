# Changelog

One entry per push to `main`. Newest first. Add one with:
`node scripts/changelog.mjs "what changed"`

Version is `v{major}.{build}`. `major` lives in `shared/version.json`; the build number is
derived from the git commit count and is never stored.

## v0.0040 — 2026-07-28
Verify the navigation-latency work in a real browser: the e2e suite now passes against production and covers the offline retry-storm guard and scoped cache invalidation

## v0.0039 — 2026-07-28
Add a Playwright suite for the navigation-latency behaviours: cache-hit navigations, hover prefetch, and the pending progress bar, run against a real deployment

## v0.0038 — 2026-07-28
Speed up navigation: SWR route cache, scoped invalidation, prefetch, pending indicators, single-query auth

## v0.0037 — 2026-07-28
Review and amend the navigation latency plan: fix an infinite SWR retry loop on failed background refreshes, couple homework and assessments cache invalidation in both directions, and correct the verified source citations

## v0.0036 — 2026-07-28
docs: add navigation latency improvement plan (SWR route cache, scoped invalidation, prefetch, pending UI, single-query auth)

## v0.0035 — 2026-07-28
Fix npm run update:preview, which could never succeed: scope the OTA export to Android (the web export fails on expo-sqlite's wasm import) and pass the environment that non-interactive mode requires.

## v0.0034 — 2026-07-28
Fix the More screen rendering as an unstyled vertical stack: Link asChild routes through Radix Slot, which destroys a Pressable's function-form style prop.

## v0.0033 — 2026-07-28
Branded bottom tab bar for the mobile app with three admin-selectable styles (soft pill, floating dock, top indicator), and a fix for the tab bar being drawn underneath Android's navigation buttons.

## v0.0031 — 2026-07-28
Correct check 3: signing in does not register a push token, because the permission prompt is deliberately deferred to More - Notifications.

## v0.0030 — 2026-07-28
Stop the login page revealing a live invite code: the loader now returns only whether an unused code exists, and the hint shows a mask.

## v0.0029 — 2026-07-28
Fix invite codes arriving already spent: form booleans posted as the string 'false' were coerced to true. Same fix un-breaks turning off homework done, material favorite, assessment-type active and notification prefs.

## v0.0028 — 2026-07-28
Record that sent: 1 counts messages handed to Expo rather than accepted tickets, so it cannot prove delivery, and map each FCM credential to the check that actually proves it.

## v0.0027 — 2026-07-28
Build 5 carries both fixes: an aapt2-based APK verifier in mobile/scripts proves the update URL, runtimeVersion 2, the preview channel and the Firebase resources are all compiled in.

## v0.0026 — 2026-07-28
Record that the dev build and the preview APK cannot coexist on one device, and that OTA verification must therefore come before installing the dev build.

## v0.0025 — 2026-07-28
Document the two ordering traps in push verification: the 30-minute lead window, and a ledger key consumed by firing a job before any device has registered.

## v0.0024 — 2026-07-28
Compile the Firebase config into the app: googleServicesFile wired up, so FirebaseApp can initialise and push tokens can be issued.

## v0.0023 — 2026-07-28
Document the Google Cloud API-restriction trap for FCM keys, and record in mobile/.gitignore why google-services.json must stay committed.

## v0.0022 — 2026-07-28
Re-check phase 7's Android prerequisites against the machine: Studio and the SDK are installed, the emulator image and AVD are not, and ANDROID_HOME is unset.

## v0.0021 — 2026-07-28
Give the mobile app an EAS Update endpoint to check, and bump runtimeVersion to 2 for it. Verified absent from the shipped APK's manifest, so every published OTA had been a silent no-op.

## v0.0014 — 2026-07-28
Fix the version stamp always showing v0.0000: Workers Builds is the sole deployer now and its shallow clone is deepened before the build number is derived.

## v0.0010 — 2026-07-27
Mobile phase 4: staff core on the phone — dashboard with a two-tap attendance shortcut, agenda-first calendar with month and day views, long-press reschedule, full-screen event detail with attendance/homework/materials tabs, class schedule and roster editors, and homework grading.

## v0.0009 — 2026-07-27
Pre-flight for phase 4: install react-native-webview and the native date/time picker before the first APK, so no later native addition forces a runtimeVersion bump and a reinstall.

## v0.0008 — 2026-07-27
Mobile flashcards: all three games (flip rebuilt on Reanimated gestures), offline topic downloads, and an idempotent outbox so a game finished with no signal syncs exactly once. /api/flashcards/topic/:slug now returns results too, so students see the leaderboard on the phone as they do in the browser.

## v0.0007 — 2026-07-27
Point the mobile app at the live Worker (https://calendar.ngqv0712.workers.dev) — the same origin as the web app, since /api/* are resource routes in the same Worker.

## v0.0006 — 2026-07-27
Add the Expo mobile app shell: bearer-token auth in secure storage, role-based bottom tabs, the design system as React Native primitives, vi-first i18n, and React Query mirroring the web's cache keys. Login, Profile, More and Language are real; the rest are labelled placeholders.

## v0.0005 — 2026-07-27
Fix CI version stamp: deploy workflow now checks out full history so the derived build number is not v0.0000.

## v0.0004 — 2026-07-27
Accept a JSON body on /translate so the mobile client can use it, alongside the FormData the web screen posts.

## v0.0003 — 2026-07-27
Add a JSON API at /api/* for the mobile app: bearer-token auth, ~30 resource routes over the existing service layer, and idempotent flashcard result recording.

## v0.0002 — 2026-07-27
Extract the i18n dictionary, color tokens, flip-gesture tuning, and recurrence/date logic into shared/ so the mobile app can import them. No behaviour change.

## v0.0001 — 2026-07-27
Introduce shared versioning: derived build number, changelog script, and a sidebar version stamp.
