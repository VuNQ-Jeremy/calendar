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
  invalidate,
  isStale,
  markFresh,
  markStale,
  markStaleQuiet,
} from './cache.js';

export const K = {
  dashboard: 'route:dashboard',
  calendar: 'route:calendar',
  classes: 'route:classes',
  people: 'route:people',
  materials: 'route:materials',
  homework: 'route:homework',
  assessments: 'route:assessments',
  flashcards: 'route:flashcards',
  config: 'route:config',
  feedback: 'route:feedback',
} as const;

export const flashcardTopicKey = (slug: string) => `route:flashcards:${slug}`;

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
  cacheSet(key, data);
  return data;
}

export type MutationDomain =
  | 'calendar'
  | 'classes'
  | 'people'
  | 'materials'
  | 'homework'
  | 'assessments'
  | 'flashcards'
  | 'config'
  | 'feedback'
  | 'profile';

/**
 * hard  -> deleted (next load blocks on the network; used for the mutated
 *          route itself so the automatic post-action revalidation is fresh)
 * stale -> served instantly, refreshed in the background.
 *
 * Derived from what each route's loader reads:
 *   dashboard:   events(today), homework, classesLite, students, materials
 *   calendar:    events, classes, students, theme, materials, eventMaterials
 *   classes:     classes, students, materials, homework
 *   people:      students, staff, parents, invites, classesLite, flashcardStats
 *   materials:   materials, classesLite
 *   homework:    homework, classes, students, grades, assessment types
 *   assessments: scores, behavior, students, classesLite, assessment types
 *   flashcards:  topics (list) / topic+words+results+mastery (slug pages)
 *   config:      assessment types, uiPrefs
 *   feedback:    feedback
 *
 * Note the two-way homework <-> assessments coupling:
 *   - saving/deleting homework grades WRITES score_records
 *     (server/services/homework.ts:97-119, :176-212), which is exactly what
 *     the assessments loader reads via assessSvc.listScores;
 *   - deleting a score on /assessments SET NULLs homework_grades.score_record_id
 *     (schema.ts:293-295), and scoreRecordId/score are fields of the GradeRow
 *     the homework loader returns.
 * So each domain must mark the other stale.
 */
const MUTATION_EFFECTS: Record<MutationDomain, { hard: string[]; stale: string[] }> = {
  calendar: { hard: [K.calendar], stale: [K.dashboard] },
  classes: {
    hard: [K.classes],
    stale: [K.dashboard, K.calendar, K.people, K.materials, K.homework, K.assessments],
  },
  people: {
    hard: [K.people],
    stale: [K.dashboard, K.calendar, K.classes, K.homework, K.assessments],
  },
  // routes/materials patches its own cache in its clientAction; 'evmat:' rows
  // (event-material joins shown in the calendar event modal) must be hard.
  materials: { hard: ['evmat:'], stale: [K.dashboard, K.calendar, K.classes] },
  homework: { hard: [K.homework, 'hw:'], stale: [K.dashboard, K.classes, K.assessments] },
  assessments: { hard: [K.assessments], stale: [K.homework] },
  // 'route:flashcards' is a prefix of every 'route:flashcards:<slug>' key, so
  // topic CRUD also drops all cached topic pages (slug may have changed).
  flashcards: { hard: [K.flashcards], stale: [K.people] },
  config: { hard: [K.config], stale: [K.homework, K.assessments] },
  feedback: { hard: [K.feedback], stale: [] },
  // profile edits change name/color which surface in many lists; profile has
  // no cache of its own, so mark everything stale (still served instantly).
  profile: { hard: [], stale: ['route:'] },
};

export function invalidateAfterMutation(domain: MutationDomain): void {
  const { hard, stale } = MUTATION_EFFECTS[domain];
  if (hard.length) invalidate(...hard);
  if (stale.length) markStale(...stale);
}

/** Map a pathname to its route cache key (null when the route has no cache). */
export function cacheKeyForPath(pathname: string): string | null {
  const fc = pathname.match(/^\/flashcards\/([^/]+)\/?$/);
  if (fc) return flashcardTopicKey(decodeURIComponent(fc[1]));
  const clean = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const map: Record<string, string> = {
    '/dashboard': K.dashboard,
    '/calendar': K.calendar,
    '/classes': K.classes,
    '/people': K.people,
    '/materials': K.materials,
    '/homework': K.homework,
    '/assessments': K.assessments,
    '/flashcards': K.flashcards,
    '/config': K.config,
    '/feedback': K.feedback,
  };
  return map[clean] ?? null;
}
