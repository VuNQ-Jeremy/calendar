# Phase 2 — Expo shell: auth, theming, navigation

**Depends on:** Phase 1
**Touches:** new `mobile/` directory only. **Nothing in the web app changes in this phase.**
**Risk:** medium — new toolchain
**Deliverable:** a **real APK on a real phone** that logs in against production, shows the
correct role-based navigation, and can edit your profile.

## Why this first

The operator chose auth + shell + navigation as the first build. It is the right call: it is
the thinnest slice that exercises the entire stack end to end — token auth, secure storage, the
API client, theming, i18n, navigation, EAS Build, and device install. Every later phase is
then "add a screen" rather than "add a screen and also discover that push builds are broken."

Nothing else can be validated until an APK is on a phone.

---

## Task 2.1 — Scaffold

```bash
cd <repo root>
npx create-expo-app@latest mobile --template tabs   # TypeScript
cd mobile
```

Delete the template's demo screens immediately. Keep `expo-router`, the `app/` directory
convention, and `metro.config.js`.

**`mobile/metro.config.js`** — Metro must be told to watch `shared/`, which lives outside the
project root:

```js
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '..', 'shared');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [sharedRoot];
// Force Metro to resolve deps from mobile/node_modules only — the repo root has a full
// web-app node_modules that must never leak into the bundle.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;
module.exports = config;
```

**`mobile/tsconfig.json`** — add a path alias so imports read cleanly:

```json
{ "extends": "expo/tsconfig.base",
  "compilerOptions": { "strict": true,
    "paths": { "~/*": ["./*"], "@shared/*": ["../shared/*"] } } }
```

> **If Metro cannot resolve `@shared/*`:** this is the single most likely failure in the phase.
> `disableHierarchicalLookup` plus `watchFolders` is the combination that works; if it still
> fails, add an explicit `config.resolver.extraNodeModules = { '@shared': sharedRoot }`. Do
> **not** "fix" it by copying `shared/` into `mobile/` — the whole point is one source of truth.

### Dependencies

```
expo-router  expo-secure-store  expo-notifications  expo-sqlite  expo-font  expo-av
expo-speech  expo-document-picker  expo-image-picker  expo-clipboard  expo-sharing
@react-native-async-storage/async-storage  @react-native-community/netinfo
react-native-gesture-handler  react-native-reanimated  react-native-safe-area-context
react-native-screens  react-native-svg  @shopify/flash-list
@tanstack/react-query  zod
@expo-google-fonts/fredoka  @expo-google-fonts/nunito-sans  @expo-google-fonts/dm-mono
```

`zod` must be installed **in `mobile/`** — `@shared/schemas.ts` imports it and each project
resolves its own copy.

Fonts come from `@expo-google-fonts/*`, **not** the web app's `@fontsource` CSS packages —
those are 13 CSS files and are useless to React Native. The families must match the web:
**Fredoka** (display), **Nunito Sans** (body), **DM Mono** (numerics/codes).

---

## Task 2.2 — `mobile/lib/api.ts`

```ts
const BASE = process.env.EXPO_PUBLIC_API_URL!;   // https://<your-worker>.workers.dev

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: unknown) { super(message); }
}

export async function apiFetch<T>(path: string, init?: RequestInit & { auth?: boolean }): Promise<T>
```

Responsibilities:

- Prefix `BASE`, set `Content-Type: application/json` (**except** when the body is `FormData` —
  React Native must set the multipart boundary itself; setting it manually breaks uploads).
- Attach `Authorization: Bearer <token>` from secure storage unless `auth: false`.
- Unwrap the `{ data }` envelope; throw `ApiError` from `{ error, issues }`.
- **On 401: clear the stored token and route to `/login`.** Do this in exactly one place, here.
  Every screen then gets correct session-expiry behavior for free.
- Add a request timeout (`AbortController`, ~15s) — Vietnamese mobile connections drop, and a
  hung fetch with no timeout presents as a frozen screen.

Create `mobile/lib/endpoints.ts` with one typed function per endpoint from the Phase 1 table
(`listEvents()`, `createEvent(input: EventInput)`, …), typed with the Zod-inferred types from
`@shared/schemas`. Screens call these, never `apiFetch` directly.

---

## Task 2.3 — Auth

**`mobile/lib/auth.tsx`** — an `AuthProvider` exposing
`{ user, status, login, logout, redeemInvite }`.

- Token in **`expo-secure-store`** (Android Keystore-backed). **Never AsyncStorage** — that is
  plaintext on disk.
- On cold start: read the token → `GET /api/auth/me` → hydrate `user`, or clear and show login.
  Show a splash while `status === 'loading'`; do not flash the login screen at a logged-in user.
- `logout()` → `POST /api/auth/logout`, clear secure store, **clear the React Query cache**
  (mirrors `clearCache()` in the web's `logout.tsx` `clientAction`), unregister the push token
  (Phase 6).

**Route guard** — `expo-router` root layout:

```tsx
// mobile/app/_layout.tsx
// if status === 'loading'  → <Splash/>
// if !user                 → <Redirect href="/login"/>
// if user.kind==='student' → student tab group
// else                     → staff tab group
```

> **Password changes sign the phone out.** `changePassword` deletes every other session for the
> account (`server/services/auth.ts:329-335`). If the user changes their password on the web,
> the phone's next request 401s. That is correct security behavior — make sure it presents as a
> clean "Please sign in again" screen, not a crash.

---

## Task 2.4 — Theme

**`mobile/theme/index.ts`** wraps `@shared/tokens`:

```ts
import { ramp, semantic, categoryColor, typography, radius, spacing } from '@shared/tokens';
export const theme = { color: semantic, ramp, category: categoryColor, radius, spacing,
  font: { display: 'Fredoka_500Medium', body: 'NunitoSans_400Regular',
          bodyBold: 'NunitoSans_700Bold', mono: 'DMMono_400Regular' } } as const;
export type Theme = typeof theme;
```

Provide it via context with a `useTheme()` hook. Build a small primitive set mirroring the
**names** of the 11 web DS components so screens read the same across codebases:
`Button, Card, Input, Badge, Tag, Avatar, Checkbox, Switch, ProgressBar, IconButton, Tabs`.

**Rules:**
- Buttons: **48dp minimum height** (the web DS default is 44px, which is the iOS floor; Android
  Material wants 48). The web `is-sm` variant at 36px is **too small for touch** — do not port
  it as a tappable control.
- Every touch target ≥ 48×48dp. Use `hitSlop` where the visual is smaller.
- Honor safe-area insets everywhere (`react-native-safe-area-context`). Android gesture
  navigation bars overlap content otherwise.
- Icons: the web uses `lucide-react`. Use **`lucide-react-native`** so the icon set matches
  exactly.

---

## Task 2.5 — i18n

**`mobile/lib/i18n.tsx`** — the React Native analogue of `src/lib/i18n.tsx`, over
`@shared/i18n/strings`:

- Same public surface: `LanguageProvider`, `useLang()` → `{ t, lang, setLang }`.
- Persist to **AsyncStorage** (not `localStorage`).
- **Default to `vi`.** The web defaults differently, but this is a Vietnamese school and the
  phone is the personal device.
- On first launch with no stored preference, seed from the device locale
  (`expo-localization`), falling back to `vi`.

**Rule:** no hardcoded strings, in any screen, in any phase. If a string is missing from
`STRINGS`, add it to **both** `en` and `vi` in `shared/i18n/strings.ts` — which means the web
app gets it too. That is intentional.

---

## Task 2.6 — Data layer (React Query)

```tsx
const qc = new QueryClient({ defaultOptions: { queries: {
  staleTime: 30_000, gcTime: 5 * 60_000, retry: 2,
  refetchOnWindowFocus: false,   // use AppState 'active' instead on RN
}}});
```

**Mirror the web's cache key and invalidation map** (`src/lib/cache.ts`, and the
`client-cache-architecture` project note). Do not invent a new scheme:

| Web key | React Query key |
|---|---|
| `route:dashboard` | `['dashboard']` |
| `route:calendar` | `['events']` |
| `route:classes` | `['classes']` |
| `route:people` | `['people']` |
| `route:flashcards` | `['flashcards','topics']` |
| `route:flashcards:<slug>` | `['flashcards','topic',slug]` |
| `att:{eventId}:{date}` | `['attendance',eventId,date]` |
| `evmat:{eventId}` | `['eventMaterials',eventId]` |

The web's `clientAction` does a coarse `invalidate('route:')` after most mutations, because
classes and students appear in nearly every loader. **Keep that coarseness** — a blanket
`queryClient.invalidateQueries()` after a mutation is correct here and much safer than
hand-maintaining a fine-grained graph. Narrow it only where the web already narrows it
(`flashcards*`).

Add `@tanstack/query-async-storage-persister` so query data survives an app restart. This is
groundwork for Phase 3's offline mode — but note it is **not sufficient** for offline study,
which needs its own durable store and an outbox.

---

## Task 2.7 — Navigation

This is the mobile answer to the drawer the web app deferred
(`src/styles/app.css:423` — *"Full mobile nav/drawer is future work."*). Do not port the
260px sidebar; do not port the 64px icon rail.

**Staff** — bottom tabs (5, the practical maximum):

| Tab | Route | Contents |
|---|---|---|
| Dashboard | `/(staff)/dashboard` | Phase 4 |
| Calendar | `/(staff)/calendar` | Phase 4 |
| Classes | `/(staff)/classes` | Phase 4 |
| Flashcards | `/(staff)/flashcards` | Phase 3 |
| More | `/(staff)/more` | a pushed list screen |

**More** contains: People, Homework, Materials, Assessments, Feedback, **Config (Admin only)**,
Profile, Language, Sign out. Gate Config on `user.role === 'Admin'`, mirroring the `adminOnly`
flag on the `NAV` const in `app/routes/_app.tsx`.

**Student** — bottom tabs (2): Flashcards, Profile.

This mirrors the server exactly: `requireStaff` bounces students to `/flashcards`, and `getUser`
returns `null` for parents. **A student must never see a staff tab**, and the client-side gate
is cosmetic — the API returns 403 regardless, which is the real enforcement.

---

## Task 2.8 — Screens

Ship these three fully; everything else is a labelled placeholder.

**Login** — port `app/routes/login.tsx` (457 lines, four modes):
1. Sign in (email, password, "remember me" → `ttlDays: 90`)
2. Invite redemption (`XXX-XXX` code, name, optional email, password)
3. Forgot password (email → `POST /api/auth/request-reset`)
4. Reset with token — **deep-link only.** Configure an Android app link so
   `/login?mode=reset&token=…` opens the app. If deep linking proves fiddly, defer it: users can
   reset on the web and then sign in on the phone. Say so in the UI rather than showing a broken
   flow.

**Profile** — port `app/routes/profile.tsx`: name, color picker (the six `ColorId` values),
contact fields, change password.

**More** — the list screen above.

---

## Task 2.9 — App config and the build

**`mobile/app.config.ts`** — a TypeScript config, **not** `app.json`, so it can read the shared
version file from Phase 0:

```ts
import { formatVersion, versionCode, RUNTIME_VERSION } from '../shared/version';
import { gitBuild, gitSha } from '../scripts/git-version.mjs';

const build = gitBuild();                 // commit count — derived, never stored

export default {
  expo: {
    name: 'Mochi', slug: 'mochi', scheme: 'mochi',
    version: formatVersion(build),        // "v0.0042"
    orientation: 'portrait', userInterfaceStyle: 'light',
    android: {
      package: 'com.mochi.lms',
      versionCode: versionCode(build),    // monotonic integer, required by Android
      adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '<brand orange>' },
      permissions: ['INTERNET', 'POST_NOTIFICATIONS'],
    },
    plugins: ['expo-router', 'expo-secure-store', 'expo-font', 'expo-updates',
      ['expo-notifications', { icon: './assets/notification-icon.png', color: '<brand orange>' }]],
    extra: { eas: { projectId: '<from eas init>' }, gitSha: gitSha(), build },
    updates: { url: '<from eas update:configure>' },

    // NOT { policy: 'appVersion' } — see below.
    runtimeVersion: String(RUNTIME_VERSION),
  },
};
```

> **`runtimeVersion` must not track the push counter.** An OTA update only reaches an installed
> APK whose `runtimeVersion` matches. Phase 0's counter bumps on **every** push — if
> `runtimeVersion` followed it, every update would orphan every installed APK and force a
> reinstall, destroying the whole OTA benefit. `RUNTIME_VERSION` is bumped by hand in
> `shared/version.json` **only when native dependencies change** (new native module, new
> permission, plugin change). Expect that roughly twice in the project.
>
> Because this phase installs every native module up front (Task 2.1), Phases 3–5 are pure JS
> and ship entirely over the air.

**Version stamp.** In the More screen footer, render
`v0.0042 · rt1 · a1b2c3d · <updateId>` from `Constants.expoConfig.version`,
`RUNTIME_VERSION`, `Constants.expoConfig.extra.gitSha`, and `Updates.updateId`. With OTA updates this is the
**only** reliable way to know which bundle a phone is running. Also attach all four to every
feedback submission via the `appVersion` field added to `FeedbackInput` in Phase 0.

Icons: generate from the Mochi brand color and the existing visual language. The repo has **no
`public/` directory and no favicon at all** — there is no existing icon asset to reuse. Create
`icon.png` (1024²), `adaptive-icon.png` (foreground, 1024², safe zone inside the central 66%),
`splash.png`, and `notification-icon.png` (white-on-transparent — Android tints it).

**`mobile/eas.json`:**

```jsonc
{ "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal",
                     "android": { "buildType": "apk" }, "channel": "development" },
    "preview":     { "distribution": "internal", "android": { "buildType": "apk" },
                     "channel": "preview",
                     "env": { "EXPO_PUBLIC_API_URL": "https://<your-worker>.workers.dev" } }
  }}
```

**Build and distribute:**

```bash
npm i -g eas-cli && eas login && eas init && eas update:configure
eas build -p android --profile preview        # → returns a download URL
```

That URL is the "just a link" the operator asked for. Send it; users download and install
(Android will prompt to allow installs from that source — document this).

**Then configure OTA updates**, which is what makes this sustainable:

```bash
eas update --branch preview --message "…"
```

JS-only changes ship over the air. Users install the APK **once**; every later phase reaches
them without a reinstall. A new APK is only needed when native config changes (new native
module, permission, or an `app.json` plugin change) or `runtimeVersion` bumps.

> Build a **`development` profile APK too** and keep it installed on the test device. Expo Go
> is fine for fast iteration on Phases 2–5 UI, but it **cannot test push notifications**
> (Phase 6) or `expo-secure-store` behavior faithfully.

---

## Acceptance criteria

- [ ] `cd mobile && npx expo start` runs; the app loads in Expo Go on a physical device.
- [ ] `@shared/*` imports resolve in Metro — verify by importing `STRINGS` and rendering a
      translated string.
- [ ] Login against **production** works. The token is in `expo-secure-store`, not AsyncStorage.
- [ ] Kill and relaunch the app → still signed in, no login flash.
- [ ] A **student** account sees exactly two tabs. A **Teacher** sees five tabs and **no**
      Config row in More. An **Admin** sees the Config row.
- [ ] Language toggles EN ↔ VI and survives a restart. Default on a fresh install is **vi**.
- [ ] Edit your name in Profile → refresh the **web** app → the new name is there.
- [ ] Change your password on the web → the phone's next request shows a clean re-login prompt,
      not a crash.
- [ ] Turn on airplane mode → the app shows a readable error, not a hang (proves the timeout).
- [ ] The More footer shows `v0.00NN · rtN · <sha> · <updateId>`, and the number matches what
      `git rev-list --count HEAD` reports for the commit that was built.
- [ ] `eas build -p android --profile preview` succeeds and the APK installs on a real device.
- [ ] `eas update --branch preview` ships a visible JS change to that installed APK **without
      reinstalling** — bump the version first and confirm the More footer shows the new number.
      This proves `runtimeVersion` was correctly decoupled from the push counter.
- [ ] Submitting feedback from the phone records the version in `feedback.app_version`.
- [ ] The web app is untouched — `git diff` outside `mobile/` and `.gitignore` is empty.
- [ ] Committed and pushed to `main`.

## As built (2026-07-27)

Six deliberate departures from the plan above. Everything else was built as written.

1. **`shared/` is consumed as `@mochi/shared`, an npm `file:../shared` dependency — not the
   `@shared/*` alias over `watchFolders`.** The alias approach cannot work with Expo SDK 57:
   Expo's forked Metro file map is constructed with `rootDir: projectRoot` and silently ignores
   every root outside it (`@expo/cli/.../createFileMap-fork.js`), so `../shared` never enters the
   file map. Neither `extraNodeModules`, nor a custom `resolveRequest`, nor plain relative imports
   resolve; only `server.unstable_serverRoot = <repo root>` fixed resolution, and that broke the
   entry point. `shared/package.json` was added so npm can link the directory. The plan's rule is
   intact — one source of truth, no copy — only the specifier changed. `mobile/metro.config.js`
   carries the full explanation.
2. **`expo-audio`, not `expo-av`.** `expo-av` is removed in this SDK.
3. **Invite redemption is one form, not two steps.** The web does an `intent=redeem-check` round
   trip to show the role before asking for a password; the JSON API has no such endpoint
   (`POST /api/auth/redeem-invite` takes everything at once). An invalid code still fails with the
   same message.
4. **Reset-with-token is not shipped** — the plan's sanctioned fallback. Android app links need a
   verified intent filter plus `assetlinks.json` served from the domain, which is not phase-2
   work. The forgot-password screen says so via the `m_reset_on_web` string.
5. **No "remember me" switch.** `api.auth.login.tsx` sets `ttlDays: 90` unconditionally, so the
   control would toggle nothing.
6. **`shared/version-math.ts` was extracted** so `app.config.ts` can use the version formulas from
   Node. `version.ts` does a bare `import v from './version.json'`, which Node's ESM loader
   rejects without an import attribute. `version.ts` keeps its exact public surface.

`tsconfig.json` at the repo root now excludes `mobile` — the Expo app has its own tsconfig and
typechecking it from the web project resolves neither its lib types nor its paths.

**The API base URL is `https://calendar.ngqv0712.workers.dev`** — the same origin as the web app,
because `/api/*` are resource routes inside the same Worker (`app/routes.ts`, and `wrangler.jsonc`
declares no custom domain). It is set in `mobile/.env.example` and in both `eas.json` build
profiles. It is a public value: `EXPO_PUBLIC_*` is inlined into the APK.

**Not verified, and cannot be from this machine:** everything in the acceptance list that needs an
Expo account or a physical device — the APK build and install, the OTA update, and therefore live
login and the role-based tab counts on a real device. The endpoint itself was checked live:
unauthenticated `GET /api/bootstrap` returns `401 {"error":"unauthorized"}` as
`application/json` — not a redirect, not HTML — which is exactly the contract `lib/api.ts`
depends on. What *else* was verified here: `npx tsc --noEmit` clean, a full production Metro bundle of every route
(`npm run bundle`, 3,669 modules), `npx expo config` resolving the derived version, and the web
app untouched — `npm run typecheck`, `npm run lint`, `npm test` (143 tests) and `npm run build`
all green.

## Notes for the executor

- **The remount lesson applies here too** (`CLAUDE.md`). In React Navigation / expo-router,
  defining a screen component inline in the options or in a parent's render will remount it on
  every parent render and wipe its state. Define screen components at module scope.
- Do not commit `mobile/node_modules`, `mobile/.expo`, or a generated `mobile/android` — Phase 0
  added these to `.gitignore`.
- Reanimated requires the Babel plugin last in `babel.config.js`. `create-expo-app` sets it up;
  if you edit that file, keep it last.
- `EXPO_PUBLIC_*` env vars are **inlined into the bundle at build time and are public**. The API
  base URL is fine there. Never put a secret in one.
