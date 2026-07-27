import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './endpoints';
import { qk } from './query';
import type {
  AttendanceRow,
  ClassRow,
  DashboardResponse,
  EventRow,
  GradeRow,
  HomeworkRow,
  MaterialRow,
  StudentRow,
  ThemeRow,
} from './types';
import type { EventInput } from '@mochi/shared/schemas';

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
 * round trip and cannot silently rot the way a hand-maintained dependency graph does. The two
 * exceptions are attendance and grades, which are per-occurrence and per-assignment and are
 * written straight back into their own cache entry.
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

export function useHomework() {
  return useQuery({ queryKey: qk.homework, queryFn: api.homework.list });
}

export function useMaterials() {
  return useQuery({ queryKey: qk.materials, queryFn: api.materials.list });
}

export function useAssessmentTypes() {
  return useQuery({ queryKey: qk.assessmentTypes, queryFn: api.assessmentTypes.list });
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

export function useHomeworkGrades(homeworkId: string | undefined) {
  return useQuery({
    queryKey: qk.homeworkGrades(homeworkId ?? ''),
    queryFn: () => api.listHomeworkGrades(homeworkId!),
    enabled: !!homeworkId,
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

/** Same shape for grades: the reply replaces this assignment's grade set. */
export function useSaveGrades(homeworkId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (records: { studentId: string; score: number | null; comment: string | null }[]) =>
      api.saveHomeworkGrades(homeworkId, { homeworkId, records }),
    onSuccess: (rows) => {
      qc.setQueryData(qk.homeworkGrades(homeworkId), rows);
      // A score may have created a score_records row for the Assessment screen.
      void qc.invalidateQueries({ queryKey: qk.assessments });
    },
  });
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
  GradeRow,
  HomeworkRow,
  MaterialRow,
  StudentRow,
  ThemeRow,
};
