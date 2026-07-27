import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';

/**
 * The data layer.
 *
 * Query keys MIRROR the web's cache keys (`src/lib/cache.ts`, and the
 * `client-cache-architecture` note) rather than inventing a second scheme — one mental model
 * for both clients, and the invalidation rules transfer directly.
 *
 *   web `route:dashboard`        -> ['dashboard']
 *   web `route:calendar`         -> ['events']
 *   web `route:classes`          -> ['classes']
 *   web `route:people`           -> ['people']
 *   web `route:flashcards`       -> ['flashcards','topics']
 *   web `route:flashcards:<slug>`-> ['flashcards','topic',slug]
 *   web `att:{eventId}:{date}`   -> ['attendance',eventId,date]
 *   web `evmat:{eventId}`        -> ['eventMaterials',eventId]
 */
export const qk = {
  bootstrap: ['bootstrap'] as const,
  dashboard: ['dashboard'] as const,
  events: ['events'] as const,
  classes: ['classes'] as const,
  people: ['people'] as const,
  students: ['students'] as const,
  /**
   * The web loads students, staff, parents and invites together under `route:people`. The phone
   * splits them so the People tabs, the class roster and the assessment picker can each fetch
   * only what they show — but they all stay under the same `['people', …]` prefix, so one
   * `invalidateQueries({ queryKey: ['people'] })` still refreshes the whole screen.
   */
  staff: ['people', 'staff'] as const,
  parents: ['people', 'parents'] as const,
  invites: ['people', 'invites'] as const,
  /** Per-student flashcard aggregates, for the student detail screen. */
  flashcardStudentStats: ['flashcards', 'studentStats'] as const,
  scores: ['assessments', 'scores'] as const,
  behavior: ['assessments', 'behavior'] as const,
  homework: ['homework'] as const,
  materials: ['materials'] as const,
  /** The calendar theme (`--cal-bg` and friends), from /api/settings/theme. */
  calTheme: ['calTheme'] as const,
  assessmentTypes: ['assessmentTypes'] as const,
  /** Grades for one homework. The web holds the whole table; the phone fetches per assignment. */
  homeworkGrades: (homeworkId: string) => ['homeworkGrades', homeworkId] as const,
  feedback: ['feedback'] as const,
  assessments: ['assessments'] as const,
  profile: ['profile'] as const,
  flashcardTopics: ['flashcards', 'topics'] as const,
  flashcardTopic: (slug: string) => ['flashcards', 'topic', slug] as const,
  attendance: (eventId: string, date: string) => ['attendance', eventId, date] as const,
  eventMaterials: (eventId: string) => ['eventMaterials', eventId] as const,
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
      // React Native has no window focus. AppState drives it instead — see below.
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * The web's `clientAction` does a coarse `invalidate('route:')` after nearly every mutation,
 * because classes and students appear in almost every loader. Keep that coarseness: a blanket
 * invalidate costs one round trip on a screen the user is already looking at, and is far safer
 * than hand-maintaining a dependency graph that silently rots.
 *
 * Narrow it only where the web already narrows it (flashcards).
 */
export function invalidateAll() {
  return queryClient.invalidateQueries();
}

export function invalidateFlashcards() {
  return queryClient.invalidateQueries({ queryKey: ['flashcards'] });
}

/**
 * Survives an app restart, so a cold start on a bad connection shows last-known data instead
 * of spinners.
 *
 * NOT an offline mode. Phase 3's offline study needs a durable store of its own plus an
 * outbox — this is groundwork, and treating it as sufficient would lose a student's results.
 */
export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'mochi_query_cache_v1',
  throttleTime: 2_000,
});

/** Call once, from the root layout. Idempotent. */
export function wireAppStateToQueries(): () => void {
  const appStateSub = AppState.addEventListener('change', (state) => {
    focusManager.setFocused(state === 'active');
  });

  // onlineManager.setEventListener returns void; the unsubscribe is the one NetInfo hands back
  // from inside the callback, so capture it there.
  let unsubscribeNet: (() => void) | undefined;
  onlineManager.setEventListener((setOnline) => {
    unsubscribeNet = NetInfo.addEventListener((state) => setOnline(!!state.isConnected));
    return unsubscribeNet;
  });

  return () => {
    appStateSub.remove();
    unsubscribeNet?.();
  };
}
