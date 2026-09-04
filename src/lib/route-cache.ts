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
  logs: 'route:logs',
  /**
   * The /logs Notifications tab. Deliberately UNDER the 'route:logs' prefix: invalidate/markStale
   * match by prefix, so anything that already stales K.logs stales this too — which is what the
   * flashcards domain needs, since a finished round changes the digest and garden forecasts.
   */
  logsNotifications: 'route:logs:notifications',
  tuiMu: 'route:tui-mu',
  /**
   * Practice. A PREFIX of nothing else, and every /practice/* page caches under it, so one
   * invalidation drops the landing page, every week grid and every ledger month together —
   * which is right, because a single task edit changes all three.
   */
  practice: 'route:practice',
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

/**
 * The admin log, filtered to one student. Same prefix trick: K.logs drops every filter at once,
 * which is what a vocabulary round needs — it can reschedule any student's words, not just the
 * one on screen.
 *
 * The UNFILTERED view uses K.logs itself, not this. That is not a shortcut: `cacheKeyForPath`
 * maps a bare `/logs` to K.logs, and useStaleRouteRefresh compares against that, so a clientLoader
 * caching the same page under a different key would simply never be refreshed.
 */
export const logsStudentKey = (studentId: string) => `route:logs:${studentId}`;

/** One more: K.garden stales every class's garden and every album month at once. */
export const gardenClassKey = (classId: string) => `route:garden:${classId}`;
export const gardenAlbumKey = (classId: string, month: string) =>
  `route:garden:${classId}:${month}`;

/**
 * Practice sheet key. Same prefix trick as tuition/garden — K.practice ('route:practice') is a
 * prefix of it, so one `invalidate(K.practice)` after any practice mutation drops the landing page
 * and every cached class-month together.
 *
 * ONLY the pathname is in the key: the student tab lives in `?student=` and every tab of a
 * class-month renders from the same loader payload, so sharing one entry is correct here.
 */
export const practiceMonthKey = (classId: string, month: string) =>
  `route:practice:${classId}:${month}`;

/** Same prefix trick: K.tuiMu stales every cached class-month board at once. */
export const tuiMuKey = (classId: string, month: string) => `route:tui-mu:${classId}:${month}`;

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
 *   dashboard:   events(today + the next fortnight), attempts summary, classesLite, students,
 *                materials, eventMaterials, classMaterials
 *   calendar:    events, classes, students, theme, materials, eventMaterials, classMaterials
 *   classes:     classes, students, materials, classMaterials
 *   people:      students, staff, parents, invites, classesLite, flashcardStats
 *   materials:   materials, classesLite, classMaterials
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
  // K.logsNotifications here and in the five domains below: the /logs notification forecast is
  // built from events, class rosters, accounts/devices, session previews, Zalo pairings and garden
  // state, so any of them changes what the cron is going to send. Stale-only — it is an admin
  // diagnostics page served through SWR, and correct on the next visit is correct enough.
  calendar: { hard: [K.calendar], stale: [K.dashboard, K.logsNotifications] },
  classes: {
    hard: [K.classes],
    stale: [
      K.dashboard,
      K.calendar,
      K.people,
      K.materials,
      K.assessments,
      K.rankings,
      K.garden,
      K.logsNotifications,
    ],
  },
  people: {
    hard: [K.people],
    stale: [
      K.dashboard,
      K.calendar,
      K.classes,
      K.assessments,
      K.rankings,
      K.garden,
      K.logsNotifications,
    ],
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
  // 'flashcards' mutation, and a round is exactly what grows the plant. K.logs for the same
  // reason — a round reschedules the words it covered, which is what that log reports. K.logs is
  // a PREFIX of K.logsNotifications, so the notification forecast is covered by that same entry
  // (a round is what silences a study nudge and waters a wilting plant).
  flashcards: { hard: [K.flashcards], stale: [K.people, K.garden, K.logs] },
  // Editing a question changes what the test builder lists, so /tests goes stale.
  questions: { hard: [K.questions], stale: [K.tests] },
  // A test writes score_records when graded, is scoped to a class, appears on the
  // student's own list, and feeds the dashboard's needs-grading stat — all four
  // surfaces must refresh.
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
    // K.logsNotifications: Zalo pairing and unlinking are /config actions, and who is linked is
    // exactly what decides whether a forecast row can reach anybody.
    stale: [
      K.assessments,
      K.questions,
      K.tests,
      K.tuition,
      K.rankings,
      K.classes,
      K.logsNotifications,
      // Earn-mode/tier/visibility edits change what the túi mù board shows.
      K.tuiMu,
    ],
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
  // K.logsNotifications: the focus text a preview carries is quoted verbatim in both the class
  // reminder and the evening preview, so editing it changes what those messages will say.
  previews: { hard: [], stale: ['prev:', K.logsNotifications] },
  // K.garden is a prefix of every 'route:garden:<classId>' and album key, so watering one
  // student, assigning vocabulary or writing an album drops them all. K.flashcards goes with
  // it because the student's own plant is rendered at the top of /vocabulary.
  // K.logsNotifications: watering rescues a plant from tomorrow's stage drop, and a new
  // assignment deadline is a future penalty — both are garden alert rows in the forecast.
  garden: { hard: [K.garden], stale: [K.flashcards, K.logsNotifications] },
  // Checklist rows live under 'ck:<eventId>:<date>', read by useCachedLoad in the calendar
  // event modal — stale rather than hard for the same reason as attendance above: the modal
  // is usually open on the very key being marked, and deleting it would blank the editor
  // mid-edit. K.tuiMu covers the class board; K.flashcards the student's bag chip on
  // /vocabulary; K.rankings + K.assessments the tally surfaces those loaders feed.
  checkin: { hard: [], stale: ['ck:', K.tuiMu, K.rankings, K.flashcards, K.assessments] },
  // The nightly finalize writes a `missing_practice` behaviour row, so /assessments (and the
  // report card built from it) must refresh after any practice write that could excuse one.
  practice: { hard: [K.practice], stale: [K.assessments] },
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
  // Practice: the sheet is one key per class-month under the 'route:practice' prefix. The old
  // /practice/review, /week and /ledger URLs are redirects and deliberately fall through to null.
  const pm = pathname.match(/^\/practice\/([^/]+)\/(\d{4}-\d{2})\/?$/);
  if (pm) return practiceMonthKey(decodeURIComponent(pm[1]), pm[2]);
  if (pathname === '/practice' || pathname === '/practice/') return K.practice;
  // The notifications tab is a sibling PAGE, not a student filter — it must be matched before the
  // filter regex below, which would otherwise read 'notifications' as a student id. (The string it
  // would produce happens to be the same, but relying on that coincidence is how it breaks the day
  // the key changes.)
  if (pathname === '/logs/notifications' || pathname === '/logs/notifications/') {
    return K.logsNotifications;
  }
  // Same trap as /logs/notifications above, and the reason it must be checked here too:
  // /^\/logs\/([^/]+)\/?$/ below would otherwise read 'activity' as a student id and hand the
  // diagnostics page a bogus per-student cache key. Unlike every other admin page this route has
  // NO cache at all — it deliberately always hits the server (see app/routes/logs.activity.tsx) —
  // so the answer is `null`, not a key, and the shell's stale-refresh hook never subscribes to it.
  if (pathname === '/logs/activity' || pathname === '/logs/activity/') {
    return null;
  }
  // Same trap and same answer as /logs/activity: a sibling PAGE, not a student filter, and
  // deliberately uncached — the usage counters move on every scored clip and the read is one
  // tiny table (see app/routes/logs.usage.tsx).
  if (pathname === '/logs/usage' || pathname === '/logs/usage/') {
    return null;
  }
  // The student filter lives in the path for the same reason the leaderboard's month does: this
  // function only ever sees a pathname, so a `?student=` would give every student one cache entry.
  const lg = pathname.match(/^\/logs\/([^/]+)\/?$/);
  if (lg) return logsStudentKey(decodeURIComponent(lg[1]));
  // Class + month in the path for the same cache reason as tuition/rankings above.
  const tb = pathname.match(/^\/mystery-bag\/([^/]+)\/(\d{4}-\d{2})\/?$/);
  if (tb) return tuiMuKey(decodeURIComponent(tb[1]), tb[2]);
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
    '/mystery-bag': K.tuiMu,
    '/logs': K.logs,
  };
  return map[clean] ?? null;
}
