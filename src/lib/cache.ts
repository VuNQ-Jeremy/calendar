const store = new Map<string, unknown>();
const subs = new Map<string, Set<() => void>>();

function notify(key: string) {
  subs.get(key)?.forEach((cb) => cb());
}

export function cacheGet<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function cacheSet(key: string, data: unknown): void {
  store.set(key, data);
  notify(key);
}

/** Delete every key that starts with any of the given prefixes. */
export function invalidate(...prefixes: string[]): void {
  for (const key of store.keys()) {
    if (prefixes.some((p) => key.startsWith(p))) {
      store.delete(key);
      notify(key);
    }
  }
}

export function clearCache(): void {
  const keys = [...store.keys()];
  store.clear();
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
