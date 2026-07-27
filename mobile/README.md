# Mochi mobile (Expo, Android)

The native client for the Mochi LMS. Built per
[docs/mobile/phase-2-expo-shell.md](../docs/mobile/phase-2-expo-shell.md); it talks to the JSON
API documented in [docs/api.md](../docs/api.md) and shares `shared/` with the web app.

## Run it

```bash
cd mobile
cp .env.example .env.local     # set EXPO_PUBLIC_API_URL to the deployed Worker
npm install
npm start                      # then scan the QR with Expo Go, or press `a`
```

`npm run typecheck` and `npm run bundle` (a full Metro production bundle) are the two checks
that run without a device. Both must pass before a commit.

## Build an APK

```bash
npm i -g eas-cli && eas login
eas init && eas update:configure    # writes extra.eas.projectId and updates.url into app.config.ts
npm run build:preview               # -> a download URL to send people
```

Set `EXPO_PUBLIC_API_URL` in **both** `.env.local` (for `expo start`) and the matching profile's
`env` block in `eas.json` (for builds). It is inlined into the bundle at build time and is public
— fine for a base URL, never for a secret.

> **Changing it does not invalidate Metro's transform cache.** The old value stays baked into the
> cached module and the next local bundle silently ships it — confirmed, not theoretical. After
> editing the URL, run `npx expo export --clear` (or `npx expo start --clear`). EAS builds are
> unaffected; they start from a clean cache. To check what a bundle really contains:
> `grep -ao 'https://[A-Za-z0-9.-]*workers\.dev' .expo/export-check/_expo/static/js/android/*.hbc`

JS-only changes ship over the air with `npm run update:preview` — no reinstall. A new APK is only
needed when native config changes, and `runtimeVersion` in `shared/version.json` must be bumped
by hand when it does. See the long comment in `app.config.ts`.

## Layout

| Path | What |
|---|---|
| `app/` | expo-router routes. `index.tsx` routes by role; `(app)/` is the signed-in tab shell |
| `lib/api.ts` | the only place that speaks HTTP. Owns the timeout and the global 401 handler |
| `lib/endpoints.ts` | one typed function per API endpoint. Screens never call `apiFetch` |
| `lib/auth.tsx` | session state; the token lives in `expo-secure-store` |
| `lib/query.ts` | React Query client, cache keys mirrored from the web's `src/lib/cache.ts` |
| `lib/i18n.tsx` | the RN half of i18n over `shared/i18n/strings.ts`. Defaults to `vi` |
| `theme/` | the design system as RN values, from `shared/tokens.ts` |
| `ui/` | the eleven primitives, named to match the web DS |

## Two things that will bite you

**`shared/` is an npm dependency, not a Metro watch folder.** `package.json` declares
`"@mochi/shared": "file:../shared"`. Metro's `watchFolders` genuinely cannot reach a sibling
directory here — Expo's forked file map ignores roots outside the project root — so imports are
`@mochi/shared/tokens`, not a relative path or a tsconfig alias. `metro.config.js` explains it in
full. Do not "simplify" it.

**A stale typed-routes file produces impossible `tsc` errors.** `.expo/types/router.d.ts` is
generated from Metro's file map, and with a warm cache after you add files, expo-router's typegen
mis-enumerates them — it emits entries like `/../components/Charts` and types real dynamic routes
as static, so `router.push('/people/student/abc')` fails to typecheck against a route that plainly
exists. The file is gitignored, so this is only ever local. The fix is a cold regeneration:

```sh
rm -rf .expo/types && npx expo start --clear   # wait for Metro, then Ctrl-C
npm run typecheck
```

`npx expo export` does NOT regenerate it; only `expo start` does.

**Screen components live at module scope.** Defining a component inline in a parent's render or
in a navigator's `options` gives it a new identity every render, which remounts the screen and
wipes its state. This already bit the web app once — see `CLAUDE.md`.
