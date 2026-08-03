import React from 'react';
import { useFetcher } from 'react-router';
import { cacheGet, cacheSet, isStale, markFresh, markStaleQuiet, subscribe } from './cache.js';

/**
 * Cache-first fetcher load with stale-while-revalidate, for data that lives
 * outside the route cache (attendance and event-material rows, loaded by the
 * calendar event modal from resource routes).
 *
 * - miss:       fires fetcher.load(url) and caches the response under `key`;
 * - fresh hit:  returns instantly, no network;
 * - stale hit:  returns the stale value instantly and refreshes underneath.
 *
 * The stale branch is what lets a live update reach these keys: markStale from
 * a broadcast (see src/lib/live.ts) notifies this hook, which refetches. Without
 * it, markStale on an `att:` key was a silent no-op, and invalidate would have
 * blanked the open modal instead of refreshing it.
 */
export function useCachedLoad<T>(key: string, url: string) {
  const fetcher = useFetcher<T>();
  const inFlightKey = React.useRef<string | null>(null);
  /**
   * 'requested' means load() has been called but the fetcher has not reported
   * a non-idle state yet. Distinguishing it from 'loading' matters: a fetcher
   * still reads 'idle' on the commit that starts the load, so treating that as
   * a finished-and-empty response would abandon the request that is about to
   * deliver.
   */
  const phase = React.useRef<'idle' | 'requested' | 'loading'>('idle');
  const isRefresh = React.useRef(false);

  const data = React.useSyncExternalStore(
    (cb) => subscribe(key, cb),
    () => cacheGet<T>(key),
  );
  const stale = React.useSyncExternalStore(
    (cb) => subscribe(key, cb),
    () => isStale(key),
  );

  React.useEffect(() => {
    if (phase.current !== 'idle') return;

    if (cacheGet(key) === undefined) {
      inFlightKey.current = key;
      isRefresh.current = false;
      phase.current = 'requested';
      fetcher.load(url);
      return;
    }
    if (isStale(key)) {
      // Claim the refresh before starting it, so a re-render mid-flight cannot
      // queue a second identical load.
      markFresh(key);
      inFlightKey.current = key;
      isRefresh.current = true;
      phase.current = 'requested';
      fetcher.load(url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url, stale]);

  React.useEffect(() => {
    if (fetcher.state !== 'idle') {
      if (phase.current === 'requested') phase.current = 'loading';
      return;
    }
    if (fetcher.data !== undefined && inFlightKey.current) {
      cacheSet(inFlightKey.current, fetcher.data);
      inFlightKey.current = null;
      phase.current = 'idle';
      return;
    }
    // Came back with nothing after actually loading (offline, 5xx, expired
    // session). Restore the flag QUIETLY: markStale would notify, re-trigger
    // the effect above, refetch, fail, notify — an unbounded retry loop for as
    // long as the modal stays open. Same hazard swrLoad guards against in
    // src/lib/route-cache.ts.
    if (phase.current === 'loading' && inFlightKey.current) {
      if (isRefresh.current) markStaleQuiet(inFlightKey.current);
      inFlightKey.current = null;
      phase.current = 'idle';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  return { data, loading: data === undefined && fetcher.state !== 'idle' };
}
