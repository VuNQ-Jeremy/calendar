import React from 'react';
import { useFetcher } from 'react-router';
import { cacheGet, cacheSet, subscribe } from './cache.js';

/**
 * Cache-first fetcher load. Returns cached data immediately when present;
 * otherwise fires fetcher.load(url) once and caches the response under `key`.
 */
export function useCachedLoad<T>(key: string, url: string) {
  const fetcher = useFetcher<T>();
  const inFlightKey = React.useRef<string | null>(null);

  const data = React.useSyncExternalStore(
    (cb) => subscribe(key, cb),
    () => cacheGet<T>(key),
  );

  React.useEffect(() => {
    if (cacheGet(key) === undefined) {
      inFlightKey.current = key;
      fetcher.load(url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url]);

  React.useEffect(() => {
    if (fetcher.data !== undefined && inFlightKey.current) {
      cacheSet(inFlightKey.current, fetcher.data);
      inFlightKey.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  return { data, loading: data === undefined && fetcher.state !== 'idle' };
}
