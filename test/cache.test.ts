import { describe, it, expect, beforeEach } from 'vitest';
import {
  cacheGet,
  cacheSet,
  invalidate,
  markStale,
  isStale,
  clearCache,
  subscribe,
} from '../src/lib/cache.js';
import {
  swrLoad,
  invalidateAfterMutation,
  cacheKeyForPath,
  testDetailKey,
  practiceMonthKey,
  K,
} from '../src/lib/route-cache.js';

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

  // Guards the retry-loop fix: a failed refresh must NOT notify, or
  // useStaleRouteRefresh revalidates -> refetch -> fail -> notify -> forever.
  it('does not notify subscribers when the background refresh fails', async () => {
    cacheSet('route:x', 'old');
    markStale('route:x');
    let calls = 0;
    const unsub = subscribe('route:x', () => calls++);
    await swrLoad('route:x', async () => {
      throw new Error('offline');
    });
    await tick();
    expect(isStale('route:x')).toBe(true);
    expect(calls).toBe(0);
    unsub();
  });

  it('only one of several parallel stale loads claims the refresh', async () => {
    cacheSet('route:x', 'old');
    markStale('route:x');
    let fetches = 0;
    const loader = async () => {
      fetches++;
      return 'new';
    };
    const [a, b, c] = await Promise.all([
      swrLoad('route:x', loader),
      swrLoad('route:x', loader),
      swrLoad('route:x', loader),
    ]);
    expect([a, b, c]).toEqual(['old', 'old', 'old']);
    expect(fetches).toBe(1);
    await tick();
    expect(cacheGet('route:x')).toBe('new');
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

  // Test scoring writes score_records and score deletion SET NULLs
  // test_attempts.score_record_id, so the two domains must stale each other.
  it('couples tests and assessments in both directions', () => {
    cacheSet(K.tests, 't');
    cacheSet(K.assessments, 'a');
    invalidateAfterMutation('tests');
    expect(isStale(K.assessments)).toBe(true);

    clearCache();
    cacheSet(K.tests, 't');
    cacheSet(K.assessments, 'a');
    invalidateAfterMutation('assessments');
    expect(isStale(K.tests)).toBe(true);
  });

  it('hard-invalidates cached test detail pages alongside the tests route', () => {
    cacheSet(K.tests, 't');
    cacheSet(testDetailKey('t1'), 'd');
    invalidateAfterMutation('tests');
    expect(cacheGet(K.tests)).toBeUndefined();
    expect(cacheGet(testDetailKey('t1'))).toBeUndefined();
  });

  it('materials keeps its own cache but drops evmat: joins', () => {
    cacheSet(K.materials, 'm');
    cacheSet('evmat:e1', 'j');
    invalidateAfterMutation('materials');
    expect(cacheGet('evmat:e1')).toBeUndefined();
    // route:materials survives so the clientAction can patch the mutated row in
    expect(cacheGet(K.materials)).toBe('m');
    expect(isStale(K.calendar)).toBe(false); // not cached, so nothing to flag
  });

  it('flashcards topic CRUD drops cached topic pages by prefix', () => {
    cacheSet(K.flashcards, 'list');
    cacheSet('route:flashcards:animals', 'topic');
    invalidateAfterMutation('flashcards');
    expect(cacheGet(K.flashcards)).toBeUndefined();
    expect(cacheGet('route:flashcards:animals')).toBeUndefined();
  });

  it('profile marks every route stale without deleting anything', () => {
    cacheSet(K.people, 'p');
    cacheSet(K.dashboard, 'd');
    invalidateAfterMutation('profile');
    expect(cacheGet(K.people)).toBe('p');
    expect(isStale(K.people)).toBe(true);
    expect(isStale(K.dashboard)).toBe(true);
  });
});

describe('cacheKeyForPath', () => {
  // The vocabulary pages live at /vocabulary; the cache keys kept the original `flashcards`
  // name (as did the API paths and DB tables), so the mismatch below is deliberate.
  it('maps route paths to cache keys', () => {
    expect(cacheKeyForPath('/dashboard')).toBe(K.dashboard);
    expect(cacheKeyForPath('/vocabulary')).toBe(K.flashcards);
    expect(cacheKeyForPath('/vocabulary/animals')).toBe('route:flashcards:animals');
    expect(cacheKeyForPath('/profile')).toBeNull();
    expect(cacheKeyForPath('/')).toBeNull();
  });

  it('no longer matches the pre-rename /flashcards paths', () => {
    expect(cacheKeyForPath('/flashcards')).toBeNull();
    expect(cacheKeyForPath('/flashcards/animals')).toBeNull();
  });

  it('gives each practice class-month its own key, and forgets the pre-sheet pages', () => {
    expect(cacheKeyForPath('/practice')).toBe(K.practice);
    expect(cacheKeyForPath('/practice/c1/2026-09')).toBe(practiceMonthKey('c1', '2026-09'));
    expect(practiceMonthKey('c1', '2026-09').startsWith(K.practice)).toBe(true);
    // The old pages are 301 redirects now; a redirect has nothing to cache.
    expect(cacheKeyForPath('/practice/review')).toBeNull();
    expect(cacheKeyForPath('/practice/c1/week/2026-09-07')).toBeNull();
    expect(cacheKeyForPath('/practice/c1/ledger/2026-09')).toBeNull();
  });

  it('/logs/activity is never cached, and is not misread as a student filter', () => {
    // Without the early return, the /^\/logs\/([^/]+)\/?$/ branch below would treat 'activity'
    // as a student id and hand the diagnostics page a bogus per-student cache key.
    expect(cacheKeyForPath('/logs/activity')).toBeNull();
    expect(cacheKeyForPath('/logs/activity/')).toBeNull();
    // A real student filter still works.
    expect(cacheKeyForPath('/logs/some-student-id')).toBe('route:logs:some-student-id');
  });

  it('/logs/usage is never cached, and is not misread as a student filter', () => {
    // Same trap as /logs/activity: usage counters move on every scored clip, so the page is
    // deliberately uncached (see app/routes/logs.usage.tsx).
    expect(cacheKeyForPath('/logs/usage')).toBeNull();
    expect(cacheKeyForPath('/logs/usage/')).toBeNull();
  });

  it('tolerates trailing slashes and encoded slugs', () => {
    expect(cacheKeyForPath('/dashboard/')).toBe(K.dashboard);
    expect(cacheKeyForPath('/vocabulary/animals/')).toBe('route:flashcards:animals');
    expect(cacheKeyForPath('/vocabulary/b%C3%A0i%201')).toBe('route:flashcards:bài 1');
  });

  it('gives each tuition month its own key, and leaves the printable slip uncached', () => {
    expect(cacheKeyForPath('/tuition')).toBe(K.tuition);
    expect(cacheKeyForPath('/tuition/2031-03')).toBe('route:tuition:2031-03');
    expect(cacheKeyForPath('/tuition/2031-03/')).toBe('route:tuition:2031-03');
    // A slip must never be served from a month's cache entry.
    expect(cacheKeyForPath('/tuition/2031-03/student-1/print')).toBeNull();
    // Not a month.
    expect(cacheKeyForPath('/tuition/march')).toBeNull();
  });
});
