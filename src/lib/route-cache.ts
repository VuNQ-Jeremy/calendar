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
import {
  cacheGet,
  cacheSet,
  cacheSetQuiet,
  invalidate,
  isStale,
  markFresh,
  markStale,
  markStaleQuiet,
} from './cache.js';
// The canonical domain list lives in shared/live.ts so the browser, the Worker
// and the Durable Object cannot drift apart. Re-exported below because route
// modules have always imported the type from here.
import type { MutationDomain } from '../../shared/live.js';

export const K = {
  dashboard: 'route:dashboard',
  calendar: 'route:calendar',
  classes: 'route:classes',
  people: 'route:people',
  materials: 'route:materials',
  assessments: 'route:assessments',
  flashcards: 'route:flashcards',
  config: 'route:config',
  feedback: 'route:feedback',
  questions: 'route:questions',
  tests: 'route:tests',
  myTests: 'route:my-tests',
} as const;

export const flashcardTopicKey = (slug: string) => `route:flashcards:${slug}`;

/**
 * Same trick as flashcardTopicKey: K.tests ('route:tests') is a PREFIX of every
 * detail key, and invalidate/markStale match by prefix — so any test mutation
 * (which hard-invalidates K.tests) also drops every cached test detail page.
 */
export const testDetailKey = (id: string) => `route:tests:${id}`;

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
        // Failed refresh (offline / 5xx / expired session): restore the flag
        // QUIETLY. markStale() here would notify -> useStaleRouteRefresh
        // revalidates -> refetch -> fail -> notify -> infinite retry loop.
        () => markStaleQuiet(key),
      );
    }
    return cached;
  }
  const data = await serverLoader();
  // Quiet: we are about to hand this same data back to React Router, and
  // notifying here would cancel its in-flight post-action revalidation of the
  // layout (see cacheSetQuiet in src/lib/cache.ts).
  cacheSetQuiet(key, data);
  return data;
}

export type { MutationDomain };

/**
 * hard  -> deleted (next load blocks on the network; used for the mutated
 *          route itself so the automatic post-action revalidation is fresh)
 * stale -> served instantly, refreshed in the background.
 *
 * Derived from what each route's loader reads:
 *   dashboard:   events(today), tests, attempts summary, classesLite, students, materials
 *   calendar:    events, classes, students, theme, materials, eventMaterials
 *   classes:     classes, students, materials
 *   people:      students, staff, parents, invites, classesLite, flashcardStats
 *   materials:   materials, classesLite
 *   assessments: scores, behavior, students, classesLite, assessment types
 *   flashcards:  topics (list) / topic+words+results+mastery (slug pages)
 *   config:      assessment types, uiPrefs, grade levels
 *   feedback:    feedback
 *   questions:   questions, grade levels, per-question test-usage counts
 *   tests:       tests, their questions, attempts, classes, students, assessment types, grade levels
 *   my-tests:    the student's own open/published tests plus their own attempts
 *
 * Note the two-way tests <-> assessments coupling:
 *   - paper score entry and attempt grading WRITE score_records
 *     (server/services/tests.ts, syncScoreRecord/savePaperScores), which is
 *     exactly what the assessments loader reads via assessSvc.listScores;
 *   - deleting a score on /assessments SET NULLs test_attempts.score_record_id,
 *     and scoreRecordId/totalScore are fields of the TestAttemptRow the tests
 *     loaders return.
 * So each domain must mark the other stale.
 */
const MUTATION_EFFECTS: Record<MutationDomain, { hard: string[]; stale: string[] }> = {
  calendar: { hard: [K.calendar], stale: [K.dashboard] },
  classes: {
    hard: [K.classes],
    stale: [K.dashboard, K.calendar, K.people, K.materials, K.assessments],
  },
  people: {
    hard: [K.people],
    stale: [K.dashboard, K.calendar, K.classes, K.assessments],
  },
  // routes/materials patches its own cache in its clientAction; 'evmat:' rows
  // (event-material joins shown in the calendar event modal) must be hard.
  materials: { hard: ['evmat:'], stale: [K.dashboard, K.calendar, K.classes] },
  assessments: { hard: [K.assessments], stale: [K.tests] },
  // 'route:flashcards' is a prefix of every 'route:flashcards:<slug>' key, so
  // topic CRUD also drops all cached topic pages (slug may have changed).
  flashcards: { hard: [K.flashcards], stale: [K.people] },
  // Editing a question changes what the test builder lists, so /tests goes stale.
  questions: { hard: [K.questions], stale: [K.tests] },
  // A test writes score_records when graded, is scoped to a class, appears on the
  // student's own list, and feeds the dashboard's open-tests card and needs-grading
  // stat — all four surfaces must refresh.
  tests: { hard: [K.tests], stale: [K.assessments, K.classes, K.myTests, K.dashboard] },
  // Grade-level and assessment-type edits surface on the question bank and the
  // test pages as well as on assessments.
  config: { hard: [K.config], stale: [K.assessments, K.questions, K.tests] },
  feedback: { hard: [K.feedback], stale: [] },
  // profile edits change name/color which surface in many lists; profile has
  // no cache of its own, so mark everything stale (still served instantly).
  profile: { hard: [], stale: ['route:'] },
};

/**
 * When this tab last mutated each domain. src/lib/live.ts uses it to ignore the
 * server's echo of a change this tab just made — the clientAction below already
 * invalidated it.
 */
const lastLocalMutationAt = new Map<MutationDomain, number>();

export function lastLocalMutation(domain: MutationDomain): number {
  return lastLocalMutationAt.get(domain) ?? 0;
}

export function invalidateAfterMutation(domain: MutationDomain): void {
  lastLocalMutationAt.set(domain, Date.now());
  const { hard, stale } = MUTATION_EFFECTS[domain];
  if (hard.length) invalidate(...hard);
  if (stale.length) markStale(...stale);
}

/**
 * Same effects map, but for a mutation made *somewhere else* and announced over
 * the WebSocket (src/lib/live.ts).
 *
 * Everything is marked stale — nothing is hard-invalidated. That difference is
 * load-bearing: useStaleRouteRefresh (app/routes/_app.tsx) deliberately ignores
 * keys whose entry was deleted, because for a local mutation React Router's own
 * post-action revalidation refills them. A remote mutation has no such
 * revalidation in this tab, so hard-deleting here would leave the viewer
 * looking at stale data until they navigated. markStale keeps serving the old
 * value instantly, notifies the subscriber, and lets swrLoad refresh underneath.
 */
export function invalidateAfterRemoteMutation(domain: MutationDomain): void {
  const { hard, stale } = MUTATION_EFFECTS[domain];
  const keys = [...hard, ...stale];
  if (keys.length) markStale(...keys);
}

/**
 * Map a pathname to its route cache key (null when the route has no cache).
 *
 * Note the deliberate mismatch on vocabulary: the URL is `/vocabulary`, but the cache keys, the
 * `/api/flashcards/*` endpoints, and the DB tables all kept the original `flashcards` name. Only
 * the user-visible URL was renamed — the internal names are not worth a coordinated migration.
 */
export function cacheKeyForPath(pathname: string): string | null {
  const fc = pathname.match(/^\/vocabulary\/([^/]+)\/?$/);
  if (fc) return flashcardTopicKey(decodeURIComponent(fc[1]));
  // Single trailing segment only, so `/tests/:id/print` (outside the app shell,
  // uncached) does NOT match, and a bare `/tests` falls through to the map below.
  const td = pathname.match(/^\/tests\/([^/]+)\/?$/);
  if (td) return testDetailKey(decodeURIComponent(td[1]));
  const clean = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const map: Record<string, string> = {
    '/dashboard': K.dashboard,
    '/calendar': K.calendar,
    '/classes': K.classes,
    '/people': K.people,
    '/materials': K.materials,
    '/assessments': K.assessments,
    '/vocabulary': K.flashcards,
    '/config': K.config,
    '/feedback': K.feedback,
    '/questions': K.questions,
    '/tests': K.tests,
    '/my-tests': K.myTests,
  };
  return map[clean] ?? null;
}
