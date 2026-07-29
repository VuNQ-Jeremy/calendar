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

/**
 * Store data WITHOUT notifying subscribers.
 *
 * For swrLoad's blocking cache-miss path (src/lib/route-cache.ts): the loader
 * that just filled this key is about to return the very same data to React
 * Router, so the visible route gets it either way. Notifying instead makes
 * useStaleRouteRefresh (app/routes/_app.tsx) call revalidator.revalidate()
 * while React Router's own post-action revalidation is still in flight. The
 * explicit revalidation supersedes it, and because shouldRevalidate excludes
 * the layout from non-mutation revalidations, the freshly loaded sidebar badge
 * counts are discarded — the badge then never moves until a full page load.
 *
 * Background SWR refreshes must keep using cacheSet: there nobody is awaiting
 * the data, so the notify is the only thing that surfaces it.
 */
export function cacheSetQuiet(key: string, data: unknown): void {
  store.set(key, data);
  staleKeys.delete(key);
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

/**
 * Re-flag one exact key as stale WITHOUT notifying subscribers.
 *
 * Used only when a background SWR refresh fails. markStale() would notify ->
 * useStaleRouteRefresh revalidates -> clientLoader -> swrLoad claims the stale
 * flag and refetches -> fails -> notify -> ... an unbounded retry loop for as
 * long as the server keeps failing and the user sits on the route. Restoring
 * the flag silently means the retry waits for the next visit or mutation.
 */
export function markStaleQuiet(key: string): void {
  if (store.has(key)) staleKeys.add(key);
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
