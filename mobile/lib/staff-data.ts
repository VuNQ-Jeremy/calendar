import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './endpoints';
import { qk } from './query';
import type {
  AttendanceRow,
  ClassRow,
  DashboardResponse,
  EventRow,
  MaterialRow,
  SessionPreviewPayload,
  StudentRow,
  ThemeRow,
} from './types';
import type { EventInput, MaterialInput } from '@mochi/shared/schemas';

/**
 * The staff screens' reads and writes, in one place.
 *
 * The web gets all of this from route loaders that fetch six tables at once and cache the lot
 * under `route:calendar`. On the phone each table is its own query, which is what lets the
 * calendar, the class list and a register share the same `['classes']` result instead of three
 * copies of it.
 *
 * Invalidation follows the web's coarse rule (`invalidate('route:')` after nearly every
 * mutation): classes and students appear in almost every screen, so a blanket refresh costs one
 * round trip and cannot silently rot the way a hand-maintained dependency graph does. The one
 * exception is attendance, which is per-occurrence and is written straight back into its own
 * cache entry.
 */

// ---- Reads ----

export function useEvents() {
  return useQuery({ queryKey: qk.events, queryFn: api.events.list });
}

export function useClasses() {
  return useQuery({ queryKey: qk.classes, queryFn: api.classes.list });
}

export function useStudents() {
  return useQuery({ queryKey: qk.students, queryFn: api.students.list });
}

export function useMaterials() {
  return useQuery({ queryKey: qk.materials, queryFn: api.materials.list });
}

export function useAssessmentTypes() {
  return useQuery({ queryKey: qk.assessmentTypes, queryFn: api.assessmentTypes.list });
}

export function useSubjects() {
  return useQuery({ queryKey: qk.subjects, queryFn: api.subjects.list });
}

// ---- Phase 5 reads: the rest of People, Assessments and Feedback ----

export function useStaff() {
  return useQuery({ queryKey: qk.staff, queryFn: api.staff.list });
}

export function useParents() {
  return useQuery({ queryKey: qk.parents, queryFn: api.parents.list });
}

export function useInvites() {
  return useQuery({ queryKey: qk.invites, queryFn: api.invites.list });
}

export function useScores() {
  return useQuery({ queryKey: qk.scores, queryFn: api.scores.list });
}

export function useBehavior() {
  return useQuery({ queryKey: qk.behavior, queryFn: api.behavior.list });
}

export function useRemarks() {
  return useQuery({ queryKey: qk.remarks, queryFn: api.remarks.list });
}

/** The rating rows the monthly remark form shows — config-managed, so fetched, not hardcoded. */
export function useRemarkCriteria() {
  return useQuery({ queryKey: qk.remarkCriteria, queryFn: api.remarkCriteria.list });
}

export function useFeedback() {
  return useQuery({ queryKey: qk.feedback, queryFn: api.feedback.list });
}

/**
 * Per-student flashcard aggregates. STAFF-only on the server, so this is never mounted on a
 * student's device — the student detail screen it feeds is behind the More menu.
 */
export function useStudentFlashcardStats() {
  return useQuery({ queryKey: qk.flashcardStudentStats, queryFn: api.flashcards.studentStats });
}

export function useDashboard() {
  return useQuery({ queryKey: qk.dashboard, queryFn: api.dashboard });
}

/** The calendar's colours, configured on the web's Customize drawer. */
export function useCalTheme() {
  return useQuery({ queryKey: qk.calTheme, queryFn: api.settings.getTheme });
}

export function useEventMaterials(eventId: string | undefined) {
  return useQuery({
    queryKey: qk.eventMaterials(eventId ?? ''),
    queryFn: () => api.listEventMaterials(eventId!),
    enabled: !!eventId,
  });
}

/**
 * One occurrence's register. Both parts of the key matter: a weekly class has one row set per
 * (eventId, date), so caching by event alone would show Monday's register on Tuesday.
 */
export function useAttendance(eventId: string | undefined, date: string | undefined) {
  return useQuery({
    queryKey: qk.attendance(eventId ?? '', date ?? ''),
    queryFn: () => api.listAttendance(eventId!, date!),
    enabled: !!eventId && !!date,
  });
}

/**
 * One occurrence's "preview buổi sau". Keyed per occurrence for the same reason attendance is:
 * a weekly class is one event row, and next Monday is not this Monday.
 */
export function useEventPreview(eventId: string | undefined, date: string | undefined) {
  return useQuery({
    queryKey: qk.eventPreview(eventId ?? '', date ?? ''),
    queryFn: () => api.eventPreviews.get(eventId!, date!),
    enabled: !!eventId && !!date,
  });
}

// ---- Writes ----

/** The coarse post-mutation refresh, matching the web's `invalidate('route:')`. */
export function useInvalidateStaff() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useEventMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries();

  const create = useMutation({
    mutationFn: (input: EventInput) => api.events.create(input),
    onSuccess: done,
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<EventInput> }) =>
      api.events.update(id, patch),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.events.remove(id),
    onSuccess: done,
  });

  return { create, update, remove };
}

/**
 * Saving a register. The reply IS the new truth for that occurrence, so it goes straight into
 * the cache — no invalidate, no refetch, no window where the screen shows stale marks.
 */
export function useSaveAttendance(eventId: string, date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (records: { studentId: string; status: AttendanceRow['status'] }[]) =>
      api.saveAttendance({ eventId, date, records }),
    onSuccess: (rows) => qc.setQueryData(qk.attendance(eventId, date), rows),
  });
}

/**
 * Saving a preview. The reply is the stored row, so it goes straight into this occurrence's cache
 * — but the student-facing list has to be refetched, since it carries composed data (the tests
 * falling on that day) this reply knows nothing about.
 *
 * No offline outbox: the outbox exists for flashcard results, which are generated while playing
 * with no network. A teacher writing next week's lesson plan can be told to try again.
 */
export function useSavePreview(eventId: string, date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { focusText: string; vocabTopicId: string | null }) =>
      api.eventPreviews.save({ eventId, date, ...input }),
    onSuccess: (row) => {
      qc.setQueryData(qk.eventPreview(eventId, date), (old: SessionPreviewPayload | undefined) => ({
        preview: row,
        topics: old?.topics ?? [],
      }));
      qc.invalidateQueries({ queryKey: qk.mySessions });
    },
  });
}

/**
 * Create / update / delete for one of the `collection()` endpoints, with the coarse refresh.
 *
 * People, assessments and feedback are all the same three verbs over the same envelope, and
 * writing that out five times was the bulk of the web's 1049-line people.tsx. One hook, five
 * call sites.
 */
export function useCollectionMutations<Row, Input>(coll: {
  create: (input: Input) => Promise<Row>;
  update: (id: string, patch: Partial<Input>) => Promise<Row>;
  remove: (id: string) => Promise<{ ok: true }>;
}) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries();

  const create = useMutation({ mutationFn: coll.create, onSuccess: done });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Input> }) => coll.update(id, patch),
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: coll.remove, onSuccess: done });

  return { create, update, remove };
}

/**
 * Materials, with the one optimisation the web made deliberately.
 *
 * `app/routes/materials.tsx:90-120` writes the mutated row straight back into the route cache so
 * the post-action revalidation is a cache hit rather than a second round trip — the note there
 * says the download button depends on the fresh `fileKey`. `setQueryData` in `onSuccess` is the
 * React Query spelling of exactly that, and it matters more here than on the web: a 20 MB upload
 * over Vietnamese mobile data should not be followed by a refetch of the whole list.
 *
 * The blanket invalidate still runs alongside it, because a material can be attached to an event
 * and `['eventMaterials']` would otherwise go stale — the web invalidates `evmat:` for the same
 * reason.
 */
export function useMaterialMutations() {
  const qc = useQueryClient();

  const writeRow = (row: MaterialRow) => {
    qc.setQueryData<MaterialRow[]>(qk.materials, (prev) => {
      if (!prev) return [row];
      return prev.some((m) => m.id === row.id)
        ? prev.map((m) => (m.id === row.id ? row : m))
        : [...prev, row];
    });
    void qc.invalidateQueries({ queryKey: ['eventMaterials'] });
  };

  const save = useMutation({
    mutationFn: (args: {
      id?: string;
      input: MaterialInput;
      form?: FormData;
      onProgress?: (pct: number) => void;
    }) =>
      args.form
        ? args.id
          ? api.updateMaterialForm(args.id, args.form, args.onProgress)
          : api.uploadMaterial(args.form, args.onProgress)
        : args.id
          ? api.materials.update(args.id, args.input)
          : api.materials.create(args.input),
    onSuccess: writeRow,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.materials.remove(id),
    onSuccess: (_res, id) => {
      qc.setQueryData<MaterialRow[]>(qk.materials, (prev) => prev?.filter((m) => m.id !== id));
      void qc.invalidateQueries({ queryKey: ['eventMaterials'] });
    },
  });

  /** The star toggle. Optimistic, because a favourite that waits for a round trip feels broken. */
  const toggleFavorite = useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) =>
      api.materials.update(id, { favorite }),
    onMutate: async ({ id, favorite }) => {
      await qc.cancelQueries({ queryKey: qk.materials });
      const prev = qc.getQueryData<MaterialRow[]>(qk.materials);
      qc.setQueryData<MaterialRow[]>(qk.materials, (rows) =>
        rows?.map((m) => (m.id === id ? { ...m, favorite } : m)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.materials, ctx.prev);
    },
    onSuccess: writeRow,
  });

  return { save, remove, toggleFavorite };
}

// ---- Derivations every screen needs ----

/** The students in a class, in the class's own roster order. */
export function rosterOf(
  cls: ClassRow | undefined,
  students: StudentRow[] | undefined,
): StudentRow[] {
  if (!cls || !students) return [];
  return cls.studentIds
    .map((sid) => students.find((s) => s.id === sid))
    .filter((s): s is StudentRow => !!s);
}

export type {
  AttendanceRow,
  ClassRow,
  DashboardResponse,
  EventRow,
  MaterialRow,
  StudentRow,
  ThemeRow,
};
