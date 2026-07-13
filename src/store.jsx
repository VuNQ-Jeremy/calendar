// src/store.js — global data store.
//
// D1 is the single source of truth. On mount the store loads the full snapshot
// from the Worker API (GET /api/state); every mutation is sent to the API
// (POST/PATCH/DELETE /api/:collection, PUT /api/theme) and mirrored into local
// React state. There is no seed data and no localStorage persistence of app
// data — what you see is what's in the database.
//
// Local dev note: the API is served by the Worker, so run `npm run cf:dev`
// (wrangler + local D1). Plain `vite` has no /api and will show an empty app.

import React from 'react';

const DEFAULT_THEME = {
  bg: '#FFFCF8',
  gridLine: '#ECE0CF',
  today: '#FFE7D1',
  header: '#FDF6EC',
  bgImage: '',
  bgOpacity: 0.12,
};

// Shape rendered before the first load resolves (keeps screens crash-free).
const EMPTY = {
  classes: [],
  students: [],
  users: [],
  parents: [],
  events: [],
  homework: [],
  materials: [],
  invites: [],
  feedback: [],
  theme: DEFAULT_THEME,
};

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${method} ${path} → ${res.status}`);
  return res.json();
}

const uid = (p) => p + Math.random().toString(36).slice(2, 8);

/** @type {React.Context<any>} */
const StoreCtx = React.createContext(null);

export function StoreProvider({ children }) {
  const [data, setData] = React.useState(EMPTY);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  const refresh = React.useCallback(
    () =>
      api('/state')
        .then((s) => {
          setData(s);
          setError(null);
        })
        .catch((e) => {
          console.error('Failed to load /api/state:', e);
          setError(e);
        }),
    [],
  );

  React.useEffect(() => {
    let alive = true;
    api('/state')
      .then((s) => {
        if (alive) setData(s);
      })
      .catch((e) => {
        if (alive) {
          console.error('Failed to load /api/state:', e);
          setError(e);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const apiMethods = React.useMemo(() => {
    // Each mutation updates local state optimistically, then persists to D1.
    // If the request fails we re-sync from the source of truth.
    const fail = (e) => {
      console.error(e);
      refresh();
    };
    return {
      add(key, item) {
        const optimistic = { id: uid(key[0]), ...item };
        setData((d) => ({ ...d, [key]: [...d[key], optimistic] }));
        api('/' + key, 'POST', optimistic)
          .then((saved) =>
            setData((d) => ({
              ...d,
              [key]: d[key].map((x) => (x.id === optimistic.id ? saved : x)),
            })),
          )
          .catch(fail);
        return optimistic;
      },
      update(key, id, patch) {
        setData((d) => ({
          ...d,
          [key]: d[key].map((x) => (x.id === id ? { ...x, ...patch } : x)),
        }));
        api('/' + key + '/' + id, 'PATCH', patch)
          .then((saved) =>
            setData((d) => ({ ...d, [key]: d[key].map((x) => (x.id === id ? saved : x)) })),
          )
          .catch(fail);
      },
      remove(key, id) {
        setData((d) => ({ ...d, [key]: d[key].filter((x) => x.id !== id) }));
        api('/' + key + '/' + id, 'DELETE').catch(fail);
      },
      setTheme(patch) {
        setData((d) => ({ ...d, theme: { ...d.theme, ...patch } }));
        api('/theme', 'PUT', patch)
          .then((theme) => setData((d) => ({ ...d, theme })))
          .catch(fail);
      },
      refresh,
      uid,
    };
  }, [refresh]);

  return (
    <StoreCtx.Provider value={{ data, loading, error, ...apiMethods }}>
      {children}
    </StoreCtx.Provider>
  );
}

export function useStore() {
  const ctx = React.useContext(StoreCtx);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
