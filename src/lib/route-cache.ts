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
  tuition: 'route:tuition',
  rankings: 'route:rankings',
  garden: 'route:garden',
} as const;

export const flashcardTopicKey = (slug: string) => `route:flashcards:${slug}`;

/**
 * Same trick as flashcardTopicKey: K.tests ('route:tests') is a PREFIX of every
 * detail key, and invalidate/markStale match by prefix — so any test mutation
 * (which hard-invalidates K.tests) also drops every cached test detail page.
 */
export const testDetailKey = (id: string) => `route:tests:${id}`;

/** Same prefix trick again: K.tuition drops every cached month at once. */
export const tuitionMonthKey = (month: string) => `route:tuition:${month}`;

/** And again for the leaderboard: K.rankings stales every cached month in one go. */
export const rankingsMonthKey = (month: string) => `route:rankings:${month}`;

/** One more: K.garden stales every class's garden and every album month at once. */
export const gardenClassKey = (classId: string) => `route:garden:${classId}`;
export const gardenAlbumKey = (classId: string, month: string) =>
  `route:garden:${classId}:${month}`;

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
 *   assessments: scores, behavior, remarks, students, classesLite, assessment types,
 *                remark criteria
 *   flashcards:  topics (list) / topic+words+results+mastery (slug pages)
 *   config:      assessment types, remark criteria, uiPrefs, grade levels
 *   feedback:    feedback
 *   questions:   questions, grade levels, per-question test-usage counts
 *   tests:       tests, their questions, attempts, classes, students, assessment types, grade levels
 *   my-tests:    the student's own open/published tests plus their own attempts
 *   tuition:     one month's fee lines (live from attendance, or the close snapshot), class
 *                prices, payments, students, classes, the billable-status setting
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
    stale: [K.dashboard, K.calendar, K.people, K.materials, K.assessments, K.rankings, K.garden],
  },
  people: {
    hard: [K.people],
    stale: [K.dashboard, K.calendar, K.classes, K.assessments, K.rankings, K.garden],
  },
  // routes/materials patches its own cache in its clientAction; 'evmat:' rows
  // (event-material joins shown in the calendar event modal) must be hard.
  materials: { hard: ['evmat:'], stale: [K.dashboard, K.calendar, K.classes] },
  // K.rankings ('route:rankings') is a prefix of every 'route:rankings:<month>' key, so one
  // stale-mark covers every month the leaderboard has cached. Scores, behaviour records and
  // monthly remarks are all ý thức or điểm inputs.
  assessments: { hard: [K.assessments], stale: [K.tests, K.rankings] },
  // 'route:flashcards' is a prefix of every 'route:flashcards:<slug>' key, so
  // topic CRUD also drops all cached topic pages (slug may have changed).
  // K.garden goes stale too, and not only for topic edits: finishing a round is a
  // 'flashcards' mutation, and a round is exactly what grows the plant.
  flashcards: { hard: [K.flashcards], stale: [K.people, K.garden] },
  // Editing a question changes what the test builder lists, so /tests goes stale.
  questions: { hard: [K.questions], stale: [K.tests] },
  // A test writes score_records when graded, is scoped to a class, appears on the
  // student's own list, and feeds the dashboard's open-tests card and needs-grading
  // stat — all four surfaces must refresh.
  tests: {
    hard: [K.tests],
    stale: [K.assessments, K.classes, K.myTests, K.dashboard, K.rankings],
  },
  // Grade-level and assessment-type edits surface on the question bank and the
  // test pages as well as on assessments; the billable-status setting changes
  // every open month's fee amounts.
  config: {
    hard: [K.config],
    // K.classes: renaming or deactivating a grade/class level changes the cohort tags on the
    // class cards and the options in the class form's dropdowns, both fed by the classes loader.
    stale: [K.assessments, K.questions, K.tests, K.tuition, K.rankings, K.classes],
  },
  feedback: { hard: [K.feedback], stale: [] },
  // profile edits change name/color which surface in many lists; profile has
  // no cache of its own, so mark everything stale (still served instantly).
  profile: { hard: [], stale: ['route:'] },
  // Attendance rows live under 'att:<eventId>:<date>' and are read by
  // useCachedLoad in the calendar event modal, not by a route loader. Stale
  // rather than hard: the modal is usually open on the very key being marked,
  // and deleting it would blank the roster mid-edit. K.tuition goes with it —
  // an open month's fee is computed from exactly these rows.
  attendance: { hard: [], stale: ['att:', K.tuition, K.rankings] },
  // K.tuition is a prefix of every 'route:tuition:<month>' key, so any fee
  // mutation drops all cached months (closing one changes what the others can
  // show, and a payment is recorded from the month page itself).
  tuition: { hard: [K.tuition], stale: [] },
  // Session previews live under 'prev:<eventId>:<date>', read by useCachedLoad
  // in the calendar event modal — same arrangement as attendance above, and
  // stale for the same reason: the modal is usually open on the very key being
  // marked, and deleting it would blank the textarea mid-edit. Nothing else
  // caches previews; the student schedule screens skip the cache entirely.
  previews: { hard: [], stale: ['prev:'] },
  // K.garden is a prefix of every 'route:garden:<classId>' and album key, so watering one
  // student, assigning vocabulary or writing an album drops them all. K.flashcards goes with
  // it because the student's own plant is rendered at the top of /vocabulary.
  garden: { hard: [K.garden], stale: [K.flashcards] },
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

/**
 * Record a local write WITHOUT invalidating anything, for callers that already
 * put the server's response straight into the cache (the attendance tab in
 * src/calendar/event-modal.tsx). Without this the server's own broadcast comes
 * back as an echo and the saving tab refetches data it just wrote.
 */
export function noteLocalMutation(domain: MutationDomain): void {
  lastLocalMutationAt.set(domain, Date.now());
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
  // Months only, so `/tuition/:month/:studentId/print` (a document, uncached) does not match.
  const tm = pathname.match(/^\/tuition\/(\d{4}-\d{2})\/?$/);
  if (tm) return tuitionMonthKey(tm[1]);
  // Months only again. This function only ever sees a pathname, which is why the leaderboard's
  // month lives in the path: a `?month=` would give every month the same cache entry.
  const rm = pathname.match(/^\/rankings\/(\d{4}-\d{2})\/?$/);
  if (rm) return rankingsMonthKey(rm[1]);
  // Album first: it is the longer path, and gardenClassKey is a prefix of it.
  const ga = pathname.match(/^\/garden\/([^/]+)\/album\/(\d{4}-\d{2})\/?$/);
  if (ga) return gardenAlbumKey(decodeURIComponent(ga[1]), ga[2]);
  const gc = pathname.match(/^\/garden\/([^/]+)\/?$/);
  if (gc) return gardenClassKey(decodeURIComponent(gc[1]));
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
    '/tuition': K.tuition,
    '/rankings': K.rankings,
    '/garden': K.garden,
  };
  return map[clean] ?? null;
}
