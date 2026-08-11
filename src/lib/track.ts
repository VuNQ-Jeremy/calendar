import React from 'react';
import { useLocation } from 'react-router';
import { cacheKeyForPath } from './route-cache.js';
import { BUILD_ID } from './build-id.js';

/**
 * Client-side page-view beacon for the activity log (server/services/audit.ts).
 *
 * Why client-side at all: the SWR route cache (route-cache.ts) means most navigations between
 * cached routes never reach the server — a cache hit renders instantly with no loader fetch — so
 * server-side view counting would be structurally incomplete. This is the one place that sees
 * every navigation regardless of whether the loader ran.
 *
 * Batched and best-effort on purpose: a view is analytics, not a fact anyone is relying on. A
 * dropped batch is a gap in a chart, not a wrong balance — so failures are swallowed, nothing
 * retries, and the whole thing must never make a navigation feel slower.
 */

type ViewEvent = { path: string; screen: string | null; at: string };

const buf: ViewEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let lastPath: string | null = null;

const FLUSH_MS = 15_000;
const MAX_BUF = 20;

/** Record one page view. Consecutive calls with the same path (React StrictMode double-effects,
 *  a router `replace` to the URL already showing) are deduped to one. */
export function trackView(path: string): void {
  if (path === lastPath) return;
  lastPath = path;
  buf.push({ path, screen: cacheKeyForPath(path) ?? null, at: new Date().toISOString() });
  if (buf.length >= MAX_BUF) void flushNow();
  else timer ??= setTimeout(() => void flushNow(), FLUSH_MS);
}

function payload(): FormData {
  const fd = new FormData(); // FormData 'payload' field = this repo's house style for JSON bodies.
  fd.set('payload', JSON.stringify({ events: buf.splice(0), appVersion: BUILD_ID }));
  return fd;
}

async function flushNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!buf.length) return;
  try {
    await fetch('/track', { method: 'POST', body: payload(), keepalive: true });
  } catch {
    // Views are best-effort; never retry-loop over a dropped batch.
  }
}

// Module init — guarded for SSR: _app.tsx (and this module, if ever imported by a route module)
// renders on the server first, where `document`/`navigator` do not exist.
if (typeof document !== 'undefined') {
  // navigator.sendBeacon is a NEW pattern in this repo (zero prior uses) — it fires the request
  // even as the tab is unloading, which a plain fetch cannot reliably do. Used only here, only on
  // the way out, so an abandoned tab's last few views are not silently lost.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && buf.length) {
      navigator.sendBeacon('/track', payload());
    }
  });
}

/**
 * Mount once in the app shell (`_app.tsx`, alongside `useStaleRouteRefresh`/`useLiveUpdates`) to
 * beacon every route change. Zero-arg, void-returning — same shape as its two siblings.
 */
export function useTrackNavigation(): void {
  const location = useLocation();
  React.useEffect(() => {
    trackView(location.pathname);
  }, [location.pathname]);
}
