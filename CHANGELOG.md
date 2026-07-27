# Changelog

One entry per push to `main`. Newest first. Add one with:
`node scripts/changelog.mjs "what changed"`

Version is `v{major}.{build}`. `major` lives in `shared/version.json`; the build number is
derived from the git commit count and is never stored.

## v0.0002 — 2026-07-27
Extract the i18n dictionary, color tokens, flip-gesture tuning, and recurrence/date logic into shared/ so the mobile app can import them. No behaviour change.

## v0.0001 — 2026-07-27
Introduce shared versioning: derived build number, changelog script, and a sidebar version stamp.
