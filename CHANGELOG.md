# Changelog

One entry per push to `main`. Newest first. Add one with:
`node scripts/changelog.mjs "what changed"`

Version is `v{major}.{build}`. `major` lives in `shared/version.json`; the build number is
derived from the git commit count and is never stored.

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
