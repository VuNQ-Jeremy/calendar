# Speed up page-to-page navigation

## Context

Clicking a sidebar link has a noticeable delay before the page transition. Investigation found the delay is real (blocking network on most navigations) **and** unacknowledged (zero pending UI). Root causes, all verified in source:

1. **No pending feedback.** `useNavigation` is used nowhere; between click and loader resolution the UI is completely inert.
2. **Blanket cache wipe.** Every route `clientAction` runs `invalidate('route:')` ([cache.ts](src/lib/cache.ts)), so after *any* mutation, every subsequent navigation is a cold, blocking `.data` fetch (auth + 1–6 D1 queries).
3. **SSR data never seeded.** No route sets `clientLoader.hydrate = true`, so the first-visited route is never cached — navigating away and back re-fetches it.
4. **No prefetching.** No `prefetch` prop on any `NavLink`; the click is the first moment the route's JS chunks are requested. (Note: React Router never prefetches *data* for routes with a `clientLoader` — verified in `node_modules/react-router/dist/development/lib/dom/ssr/components.js:293-296` — so `prefetch="intent"` warms chunks only.)
5. **Slow auth on every `.data` request.** `userFromToken` ([server/services/auth.ts:64-120](server/services/auth.ts#L64-L120)) makes **3 sequential D1 round trips** (sessions → accounts → staff/students), unmemoised; paid twice on cold document loads (`_app` loader + child loader in the same request).
6. **`routes/materials` chunk split is broken.** Built manifest shows `hasClientLoader:true` but no `clientLoaderModule` — because `CACHE_KEY`/`MAX_FILE_SIZE` are module-scope consts shared between `clientLoader`/`clientAction` and other exports ([materials.tsx:17-18](app/routes/materials.tsx#L17-L18)). Shared **imports** are fine; shared module-scope **locals** defeat the splitter.
7. `_app` layout loader (badge counts) re-runs on every mutation and on clicking the current page's link; no `shouldRevalidate` anywhere.

**Approach:** keep the existing `cache.ts` architecture, extend it with stale-while-revalidate (SWR). Mutations hard-invalidate only their own route's cache and mark dependent routes *stale* — stale data is served instantly and refreshed in the background. Add pending indicators, `prefetch="intent"`, hydrate-seeding, a single-query memoised auth, and a `shouldRevalidate` allowlist for the layout. Rejected: defer/streaming (high complexity, SWR makes warm navs instant), isolate-level session TTL cache (logout staleness risk), hover data-warming (follow-up; only helps first visit per route).

Verified safe foundations (from react-router v8 source):
- `clientLoader.hydrate = true` with SSR data present → clientLoader runs during hydration with **no fallback flash** and `serverLoader()` returns the SSR'd data **without a network request** (`lib/dom/ssr/routes.js:146-153`, `router.js:2046-2049`). No `HydrateFallback` needed.
- Calling `serverLoader()` fire-and-forget *after* the clientLoader resolves works: it's a plain `fetch('<path>.data?_routes=<id>')`, not tied to an aborted signal (`single-fetch.js:234-241`).
- The chunk splitter handles `clientLoader.hydrate = true` assignment statements correctly (`@react-router/dev` vite.js:238-243).

---

## Step 1 — Extend `src/lib/cache.ts` with staleness

Replace the entire file (current file is 41 lines: store Map, subs Map, notify, cacheGet, cacheSet, invalidate, clearCache, subscribe):

```ts
const store = new Map<string, unknown>();
const staleKeys = new Set<string>();
const subs = new Map<string, Set<() => void>>();

function notify(key: string) {
  subs.get(key)?.forEach((cb) => cb());
}

export function cacheGet<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function cacheSet(key: string, data: unknown): void {
  store.set(key, data);
  staleKeys.delete(key);
  notify(key);
}

/** Is the cached value flagged for background refresh? */
export function isStale(key: string): boolean {
  return staleKeys.has(key);
}

/** Clear the stale flag without touching the data (a refresh has been claimed). */
export function markFresh(key: string): void {
  staleKeys.delete(key);
}

/**
 * Flag every cached key starting with any prefix as stale. Unlike invalidate(),
 * the data keeps being served instantly; the next swrLoad (src/lib/route-cache.ts)
 * refreshes it in the background. Subscribers are notified so the currently
 * displayed route can kick off its refresh immediately (see useStaleRouteRefresh
 * in app/routes/_app.tsx).
 */
export function markStale(...prefixes: string[]): void {
  for (const key of store.keys()) {
    if (!staleKeys.has(key) && prefixes.some((p) => key.startsWith(p))) {
      staleKeys.add(key);
      notify(key);
    }
  }
}

/** Delete every key that starts with any of the given prefixes. */
export function invalidate(...prefixes: string[]): void {
  for (const key of store.keys()) {
    if (prefixes.some((p) => key.startsWith(p))) {
      store.delete(key);
      staleKeys.delete(key);
      notify(key);
    }
  }
}

export function clearCache(): void {
  const keys = [...store.keys()];
  store.clear();
  staleKeys.clear();
  keys.forEach(notify);
}

export function subscribe(key: string, cb: () => void): () => void {
  let set = subs.get(key);
  if (!set) subs.set(key, (set = new Set()));
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (!set!.size) subs.delete(key);
  };
}
```

## Step 2 — New module `src/lib/route-cache.ts`

Centralizes cache keys (this is also what fixes the materials chunk split — route files import keys instead of declaring module-scope consts), the SWR loader, the mutation→invalidation map, and pathname→key mapping. Full content:

```ts
/**
 * Route-level cache policy: keys, stale-while-revalidate loading, and the
 * mutation -> invalidation map.
 *
 * IMPORTANT: route modules must import these values instead of declaring
 * module-scope consts shared between clientLoader/clientAction and the other
 * exports. Sharing module-scope locals across route exports defeats React
 * Router's route-chunk splitting (this is exactly what broke the
 * routes/materials split — its CACHE_KEY was used by both clientLoader and
 * clientAction). Values imported from another module are safe to share.
 */
import { cacheGet, cacheSet, invalidate, isStale, markFresh, markStale } from './cache.js';

export const K = {
  dashboard: 'route:dashboard',
  calendar: 'route:calendar',
  classes: 'route:classes',
  people: 'route:people',
  materials: 'route:materials',
  homework: 'route:homework',
  assessments: 'route:assessments',
  flashcards: 'route:flashcards',
  config: 'route:config',
  feedback: 'route:feedback',
} as const;

export const flashcardTopicKey = (slug: string) => `route:flashcards:${slug}`;

/**
 * Stale-while-revalidate loader for route clientLoaders.
 * - miss: awaits serverLoader and caches (blocking, same as before);
 * - fresh hit: returns instantly, no network;
 * - stale hit: returns the stale data instantly and refreshes in the
 *   background; when the fresh data lands, cacheSet notifies subscribers and
 *   useStaleRouteRefresh (app/routes/_app.tsx) revalidates the visible route.
 */
export async function swrLoad<T>(key: string, serverLoader: () => Promise<T>): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== undefined) {
    if (isStale(key)) {
      markFresh(key); // claim the refresh so parallel loads don't duplicate it
      serverLoader().then(
        (data) => cacheSet(key, data),
        () => markStale(key), // failed refresh (offline / expired session): retry on next visit
      );
    }
    return cached;
  }
  const data = await serverLoader();
  cacheSet(key, data);
  return data;
}

export type MutationDomain =
  | 'calendar'
  | 'classes'
  | 'people'
  | 'materials'
  | 'homework'
  | 'assessments'
  | 'flashcards'
  | 'config'
  | 'feedback'
  | 'profile';

/**
 * hard  -> deleted (next load blocks on the network; used for the mutated
 *          route itself so the automatic post-action revalidation is fresh)
 * stale -> served instantly, refreshed in the background.
 *
 * Derived from what each route's loader reads:
 *   dashboard:   events(today), homework, classesLite, students, materials
 *   calendar:    events, classes, students, theme, materials, eventMaterials
 *   classes:     classes, students, materials, homework
 *   people:      students, staff, parents, invites, classesLite, flashcardStats
 *   materials:   materials, classesLite
 *   homework:    homework, classes, students, grades, assessment types
 *   assessments: scores, behavior, students, classesLite, assessment types
 *   flashcards:  topics (list) / topic+words+results+mastery (slug pages)
 *   config:      assessment types, uiPrefs
 *   feedback:    feedback
 */
const MUTATION_EFFECTS: Record<MutationDomain, { hard: string[]; stale: string[] }> = {
  calendar: { hard: [K.calendar], stale: [K.dashboard] },
  classes: {
    hard: [K.classes],
    stale: [K.dashboard, K.calendar, K.people, K.materials, K.homework, K.assessments],
  },
  people: {
    hard: [K.people],
    stale: [K.dashboard, K.calendar, K.classes, K.homework, K.assessments],
  },
  // routes/materials patches its own cache in its clientAction; 'evmat:' rows
  // (event-material joins shown in the calendar event modal) must be hard.
  materials: { hard: ['evmat:'], stale: [K.dashboard, K.calendar, K.classes] },
  homework: { hard: [K.homework, 'hw:'], stale: [K.dashboard, K.classes] },
  assessments: { hard: [K.assessments], stale: [] },
  // 'route:flashcards' is a prefix of every 'route:flashcards:<slug>' key, so
  // topic CRUD also drops all cached topic pages (slug may have changed).
  flashcards: { hard: [K.flashcards], stale: [K.people] },
  config: { hard: [K.config], stale: [K.homework, K.assessments] },
  feedback: { hard: [K.feedback], stale: [] },
  // profile edits change name/color which surface in many lists; profile has
  // no cache of its own, so mark everything stale (still served instantly).
  profile: { hard: [], stale: ['route:'] },
};

export function invalidateAfterMutation(domain: MutationDomain): void {
  const { hard, stale } = MUTATION_EFFECTS[domain];
  if (hard.length) invalidate(...hard);
  if (stale.length) markStale(...stale);
}

/** Map a pathname to its route cache key (null when the route has no cache). */
export function cacheKeyForPath(pathname: string): string | null {
  const fc = pathname.match(/^\/flashcards\/([^/]+)\/?$/);
  if (fc) return flashcardTopicKey(decodeURIComponent(fc[1]));
  const clean = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const map: Record<string, string> = {
    '/dashboard': K.dashboard,
    '/calendar': K.calendar,
    '/classes': K.classes,
    '/people': K.people,
    '/materials': K.materials,
    '/homework': K.homework,
    '/assessments': K.assessments,
    '/flashcards': K.flashcards,
    '/config': K.config,
    '/feedback': K.feedback,
  };
  return map[clean] ?? null;
}
```

## Step 3 — Rewrite every route's `clientLoader` / `clientAction`

**Generic clientLoader pattern** — applies to `dashboard`, `calendar`, `classes`, `people`, `materials`, `homework`, `assessments`, `flashcards`, `config`, `feedback` (10 files under `app/routes/`):

```ts
export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(K.<name>, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;
```

**Generic clientAction pattern** (domains: `calendar`, `classes`, `people`, `homework`, `assessments`, `config`, `feedback`, `profile`, `flashcards`):

```ts
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('<domain>');
  }
}
```

Per-file changes (in each: **delete the local `const CACHE_KEY = ...`**, trim the `cache.js` import to what's still used, add `import { K, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';` trimmed to what the file uses):

- [dashboard.tsx](app/routes/dashboard.tsx) — clientLoader with `K.dashboard`. No clientAction.
- [calendar.tsx](app/routes/calendar.tsx) — `K.calendar` + `invalidateAfterMutation('calendar')`; remove the `cacheGet, cacheSet, invalidate` import entirely.
- [classes.tsx](app/routes/classes.tsx) — `K.classes` + `'classes'`.
- [people.tsx](app/routes/people.tsx) — `K.people` + `'people'`.
- [homework.tsx](app/routes/homework.tsx) — `K.homework` + `'homework'` (map already hard-includes `'hw:'`).
- [assessments.tsx](app/routes/assessments.tsx) — `K.assessments` + `'assessments'`.
- [config.tsx](app/routes/config.tsx) — `K.config` + `'config'`.
- [feedback.tsx](app/routes/feedback.tsx) — `K.feedback` + `'feedback'`.
- [flashcards.tsx](app/routes/flashcards.tsx) — `K.flashcards` + `'flashcards'`.
- [profile.tsx](app/routes/profile.tsx) — clientAction only: `invalidateAfterMutation('profile')`; remove the `invalidate` import.

**[flashcards.$slug.tsx](app/routes/flashcards.$slug.tsx)** — parameterized key; delete the local `keyFor`; imports: `import { invalidate, markStale } from '../../src/lib/cache.js';` and `import { K, flashcardTopicKey, swrLoad } from '../../src/lib/route-cache.js';`:

```ts
export async function clientLoader({ serverLoader, params }: ClientLoaderFunctionArgs) {
  return swrLoad(
    flashcardTopicKey(params.slug!),
    () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>,
  );
}
clientLoader.hydrate = true as const;

export async function clientAction({ serverAction, params }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidate(flashcardTopicKey(params.slug!));
    // topic list shows word counts; people shows per-student flashcard stats
    markStale(K.flashcards, K.people);
  }
}
```

**[materials.tsx](app/routes/materials.tsx)** — keeps its own-cache row patching (see current clientAction at lines 90-120). Imports: `import { cacheGet, cacheSet, invalidate } from '../../src/lib/cache.js';` plus `import { K, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';`. Keep `MAX_FILE_SIZE` (it's only used by the server `action`, which is not chunk-split — but to be safe for the splitter, it can stay since it's not shared with clientLoader/clientAction; the blocker was `CACHE_KEY`). New clientAction (replaces lines 90-120):

```ts
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  const cached = cacheGet<Awaited<ReturnType<typeof loader>>>(K.materials);
  let data: Awaited<ReturnType<typeof serverAction>>;
  try {
    data = await serverAction();
  } catch (e) {
    invalidate(K.materials);
    invalidateAfterMutation('materials');
    throw e;
  }
  invalidateAfterMutation('materials'); // hard: 'evmat:'; stale: dashboard/calendar/classes
  // Patch the mutated row into the materials cache so the post-action
  // revalidation is a cache hit instead of a second server round-trip
  // (the download button depends on the fresh fileKey).
  const result = data as { ok?: boolean; material?: MaterialRow; deletedId?: string } | null;
  if (cached && result?.ok) {
    if (result.material) {
      const row = result.material;
      const exists = cached.materials.some((m) => m.id === row.id);
      const materials = exists
        ? cached.materials.map((m) => (m.id === row.id ? row : m))
        : [...cached.materials, row];
      cacheSet(K.materials, { ...cached, materials });
    } else if (result.deletedId) {
      cacheSet(K.materials, {
        ...cached,
        materials: cached.materials.filter((m) => m.id !== result.deletedId),
      });
    } else {
      invalidate(K.materials);
    }
  } else {
    invalidate(K.materials);
  }
  return data;
}
```

## Step 4 — `app/routes/_app.tsx`: pending UI, bridge hook, shouldRevalidate, prefetch

Current file: loader at lines 76-104, `Sidebar` at 110-196 (NavLink loop at 150-164, profile footer NavLink at 178-193), `AppLayout` at 202-283.

Extend the react-router import with `useNavigation, useRevalidator, useLocation`; add `import type { ShouldRevalidateFunctionArgs } from 'react-router';`, `import { cacheGet, subscribe } from '../../src/lib/cache.js';`, `import { cacheKeyForPath } from '../../src/lib/route-cache.js';`.

**4a. `shouldRevalidate`** — insert after the `loader`:

```ts
// The layout loader feeds the sidebar badge counts (homework due, unused
// invites, new feedback), uiPrefs, and the session user. Only mutations under
// these paths can change that data — skip the layout .data round-trip for
// everything else: plain GET navigations (incl. clicking the current page's
// nav link), revalidator.revalidate() calls from useStaleRouteRefresh, and
// unrelated mutations (calendar/classes/materials/assessments/flashcards —
// note class deletion SET NULLs homework rows, it doesn't delete them, so
// countDue is unaffected).
const APP_DATA_MUTATION_PATHS = ['/homework', '/people', '/feedback', '/config', '/profile'];

export function shouldRevalidate({ formAction, formMethod }: ShouldRevalidateFunctionArgs) {
  if (!formAction || !formMethod || formMethod.toUpperCase() === 'GET') return false;
  const path = formAction.split('?')[0];
  return APP_DATA_MUTATION_PATHS.some((p) => path === p || path.startsWith(p + '/'));
}
```

**4b. `NavProgress` + `useStaleRouteRefresh`** — module-level, before `AppLayout`:

```tsx
function NavProgress() {
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    // Only show for navigations that take noticeable time; cache-hit
    // navigations settle before the delay elapses and never flash the bar.
    const id = window.setTimeout(() => setVisible(true), 150);
    return () => window.clearTimeout(id);
  }, [busy]);
  if (!visible) return null;
  return <div className="nav-progress" aria-hidden="true" />;
}

/**
 * When the currently displayed route's cache entry changes underneath it
 * (a stale-while-revalidate refresh landing, or another screen's mutation
 * marking it stale), revalidate so useLoaderData picks up the new data.
 * Nearly free: shouldRevalidate above skips the layout loader and the child
 * clientLoader is a cache hit (or stale hit that kicks its own refresh).
 * Skips when the key was hard-deleted (cacheGet undefined) — React Router's
 * automatic post-action revalidation already covers that case.
 */
function useStaleRouteRefresh() {
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const location = useLocation();
  const key = cacheKeyForPath(location.pathname);
  const ref = React.useRef({ revalidator, navigation });
  ref.current = { revalidator, navigation };
  React.useEffect(() => {
    if (!key) return;
    return subscribe(key, () => {
      const { revalidator, navigation } = ref.current;
      if (
        cacheGet(key) !== undefined &&
        navigation.state === 'idle' &&
        revalidator.state === 'idle'
      ) {
        revalidator.revalidate();
      }
    });
  }, [key]);
}
```

No infinite loop: revalidate → clientLoader → fresh cache hit → swrLoad only calls `cacheSet` on miss → no notify.

**4c. In `AppLayout`**: call `useStaleRouteRefresh();` as the first statement, and render `<NavProgress />` as the first child inside the `.app` div (must be inside `.app` to inherit `--brand`).

**4d. NavLinks** — main loop (line ~151):

```tsx
<NavLink
  key={n.id}
  to={n.path}
  prefetch="intent"
  className={({ isActive, isPending }) =>
    'sb__item' + (isActive ? ' is-active' : '') + (isPending ? ' is-pending' : '')
  }
>
```

Profile footer (line ~178): add `prefetch="intent"` and the same `+ (isPending ? ' is-pending' : '')` on `'sb__foot'`.

## Step 5 — CSS

Append to `src/styles/app.css` near the `.sb__item` block (~line 349):

```css
/* ---- navigation pending feedback ---- */
.nav-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 9999;
  pointer-events: none;
  background: var(--brand, #f79a4e);
  transform-origin: left;
  animation: nav-progress-grow 1.2s ease-out forwards;
}
@keyframes nav-progress-grow {
  0% { transform: scaleX(0); }
  60% { transform: scaleX(0.7); }
  100% { transform: scaleX(0.92); }
}
.sb__item.is-pending,
.sb__foot.is-pending {
  animation: nav-pending-pulse 0.9s ease-in-out infinite alternate;
}
@keyframes nav-pending-pulse {
  from { opacity: 1; }
  to { opacity: 0.5; }
}
```

## Step 6 — `src/calendar/event-modal.tsx`

In `saveJoin` (line ~195), replace `invalidate('route:calendar');` with `markStale('route:calendar');`. Update the cache import: add `markStale`, drop `invalidate` if now unused in the file. This turns every material attach/detach in the event modal from a blocking 6-query calendar refetch into an instant update + background refresh.

## Step 7 — `server/services/auth.ts`: single-query auth + per-request memo

Replace `userFromToken` (lines 64-120) — 3 sequential D1 queries become 1 join; preserves all semantics including expiry-delete and "staffId set but staff row missing → null" (keep the existing doc comment above it):

```ts
export async function userFromToken(db: Db, rawToken: string): Promise<SessionUser | null> {
  const tokenHash = await hashToken(rawToken);
  // One joined query instead of 3 sequential D1 round-trips.
  const rows = await db
    .select({ session: sessions, account: accounts, staffRow: staff, studentRow: students })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .leftJoin(staff, eq(staff.id, accounts.staffId))
    .leftJoin(students, eq(students.id, accounts.studentId))
    .where(eq(sessions.token, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  if (new Date(row.session.expiresAt) < new Date()) {
    await db.delete(sessions).where(eq(sessions.token, tokenHash));
    return null;
  }

  const { account } = row;
  if (account.staffId) {
    if (!row.staffRow) return null;
    return {
      kind: 'staff',
      account: { id: account.id, email: account.email },
      user: {
        id: row.staffRow.id,
        name: row.staffRow.name,
        email: row.staffRow.email ?? null,
        role: row.staffRow.role,
        color: row.staffRow.color,
        phone: row.staffRow.phone ?? null,
      },
    };
  }

  if (account.studentId) {
    if (!row.studentRow) return null;
    return {
      kind: 'student',
      account: { id: account.id, email: account.email },
      user: {
        id: row.studentRow.id,
        name: row.studentRow.name,
        email: row.studentRow.email ?? null,
        role: 'Student',
        color: row.studentRow.color,
        phone: null,
      },
    };
  }

  return null; // parent accounts remain unsupported
}
```

Replace `getUser` (lines 122-127):

```ts
// On a cold document load the layout loader and the page loader run in the
// same request — memoise per Request object so the session resolves once.
// WeakMap keyed on the Request instance cannot leak across requests.
const userByRequest = new WeakMap<Request, Promise<SessionUser | null>>();

export function getUser(request: Request, env: Env): Promise<SessionUser | null> {
  const memo = userByRequest.get(request);
  if (memo) return memo;
  const promise = (async () => {
    const db = createDb(env);
    const rawToken = await sessionCookie.parse(request.headers.get('Cookie'));
    if (!rawToken || typeof rawToken !== 'string') return null;
    return userFromToken(db, rawToken);
  })();
  userByRequest.set(request, promise);
  return promise;
}
```

`requireUser`/`requireStaff`/`requireAdmin` (lines 129-156) and the mobile bearer path (`server/api/auth.ts` calls `userFromToken` directly) are unchanged. Check that `staff`/`students` tables are already imported in auth.ts's drizzle schema imports; add if missing.

## Step 8 — Tests

New `test/cache.test.ts` (default vitest project). The existing worker-pool tests (`test-worker/api-auth.test.js`, `test-worker/services.test.js`) exercise the auth path against miniflare D1 and validate the join rewrite.

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  cacheGet, cacheSet, invalidate, markStale, isStale, clearCache, subscribe,
} from '../src/lib/cache.js';
import { swrLoad, invalidateAfterMutation, cacheKeyForPath, K } from '../src/lib/route-cache.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => clearCache());

describe('cache staleness', () => {
  it('markStale flags only existing keys with matching prefixes', () => {
    cacheSet('route:a', 1);
    cacheSet('other:b', 2);
    markStale('route:');
    expect(isStale('route:a')).toBe(true);
    expect(isStale('other:b')).toBe(false);
    expect(cacheGet('route:a')).toBe(1); // data still served
  });

  it('cacheSet clears the stale flag', () => {
    cacheSet('route:a', 1);
    markStale('route:a');
    cacheSet('route:a', 2);
    expect(isStale('route:a')).toBe(false);
  });

  it('invalidate deletes data and stale flags', () => {
    cacheSet('route:a', 1);
    markStale('route:a');
    invalidate('route:');
    expect(cacheGet('route:a')).toBeUndefined();
    expect(isStale('route:a')).toBe(false);
  });

  it('notifies subscribers on markStale', () => {
    cacheSet('route:a', 1);
    let calls = 0;
    const unsub = subscribe('route:a', () => calls++);
    markStale('route:a');
    expect(calls).toBe(1);
    unsub();
  });
});

describe('swrLoad', () => {
  it('fetches and caches on miss', async () => {
    const data = await swrLoad('route:x', async () => 'fresh');
    expect(data).toBe('fresh');
    expect(cacheGet('route:x')).toBe('fresh');
  });

  it('returns cached data without hitting the server when fresh', async () => {
    cacheSet('route:x', 'cached');
    let called = false;
    const data = await swrLoad('route:x', async () => {
      called = true;
      return 'fresh';
    });
    expect(data).toBe('cached');
    expect(called).toBe(false);
  });

  it('returns stale data instantly and refreshes in the background', async () => {
    cacheSet('route:x', 'old');
    markStale('route:x');
    const data = await swrLoad('route:x', async () => 'new');
    expect(data).toBe('old');
    expect(isStale('route:x')).toBe(false); // refresh claimed
    await tick();
    expect(cacheGet('route:x')).toBe('new');
  });

  it('re-marks stale when the background refresh fails', async () => {
    cacheSet('route:x', 'old');
    markStale('route:x');
    await swrLoad('route:x', async () => {
      throw new Error('offline');
    });
    await tick();
    expect(cacheGet('route:x')).toBe('old');
    expect(isStale('route:x')).toBe(true);
  });
});

describe('invalidateAfterMutation', () => {
  it('hard-invalidates the mutated route and marks dependents stale', () => {
    cacheSet(K.calendar, 'c');
    cacheSet(K.dashboard, 'd');
    cacheSet(K.feedback, 'f');
    invalidateAfterMutation('calendar');
    expect(cacheGet(K.calendar)).toBeUndefined();
    expect(isStale(K.dashboard)).toBe(true);
    expect(cacheGet(K.dashboard)).toBe('d');
    expect(isStale(K.feedback)).toBe(false);
  });
});

describe('cacheKeyForPath', () => {
  it('maps route paths to cache keys', () => {
    expect(cacheKeyForPath('/dashboard')).toBe(K.dashboard);
    expect(cacheKeyForPath('/flashcards')).toBe(K.flashcards);
    expect(cacheKeyForPath('/flashcards/animals')).toBe('route:flashcards:animals');
    expect(cacheKeyForPath('/profile')).toBeNull();
    expect(cacheKeyForPath('/')).toBeNull();
  });
});
```

## Step 9 — Local verification

1. `npm run typecheck`
2. `npm run lint` (remove any now-unused imports it flags)
3. `npm test` (both vitest projects)
4. `npm run build`, then assert the materials chunk split is fixed:
   ```
   node -e "const fs=require('fs');const f=fs.readdirSync('build/client/assets').find(n=>/^manifest-/.test(n));const m=fs.readFileSync('build/client/assets/'+f,'utf8');const i=m.indexOf('\"routes/materials\":');const seg=m.slice(i,i+900);if(!seg.includes('clientLoaderModule'))throw new Error('materials split STILL broken');console.log('materials split OK');"
   ```
   If still broken: some module-scope value is still shared between `clientLoader`/`clientAction` and other exports in materials.tsx — only imports may be shared.

## Step 10 — Deploy + manual checks (workerd is broken locally; verify in prod)

`npm run deploy`, then as a staff user:

1. Load `/dashboard` → go to `/calendar` → back to `/dashboard`: instant, **no `.data` request** in DevTools Network (hydrate seeding works).
2. Hover a nav link → modulepreload requests appear (prefetch); click a cold route → sidebar item pulses and the top bar appears after ~150 ms.
3. On `/calendar`, create an event, then navigate to `/people` → instant (previously a blocking refetch); navigate to `/dashboard` → instant, with a background `.data` request that updates the today-list in place (SWR bridge works).
4. Open a calendar event, attach a material → no blocking calendar refetch; calendar updates in the background.
5. Create homework → sidebar homework badge updates (`shouldRevalidate` allowlist); create a calendar event → **no** `_app.data` request fires (layout skip works).
6. Log out / log in; change password — auth join regression check. Also verify the mobile API still authenticates (any `api/*` call with a bearer token).
7. `/materials` cold navigation → the `.data` fetch starts without waiting for the full route chunk.

## Finish (project rules)

Single commit to `main`: stage everything, run
`node scripts/changelog.mjs "Speed up navigation: SWR route cache, scoped invalidation, prefetch, pending indicators, single-query auth"`,
commit, push to `main`.

## Follow-ups (explicitly out of scope)

- Hover **data**-warming (React Router never prefetches data for clientLoader routes) — a transient fetcher-based cache warmer; only helps first visit per route. Measure need after this pass.
- Calendar/people loader slimming or defer/streaming (cold loads only after this pass).
- `home.tsx` `/` → `/dashboard` server redirect on landing.
