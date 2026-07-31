import { apiFetch, apiUpload } from './api';
import type {
  AssessmentTypeInput,
  AttendanceSaveInput,
  BehaviorRecordInput,
  ChangePasswordInput,
  ClassInput,
  EventInput,
  EventMaterialsSaveInput,
  FeedbackInput,
  FlashcardImportInput,
  FlashcardResultBatch,
  FlashcardTopicInput,
  FlashcardTopicWithWordsInput,
  FlashcardWordInput,
  GeneratedWord,
  HomeworkGradesSaveInput,
  HomeworkInput,
  InviteInput,
  LoginInput,
  MaterialInput,
  NotifPrefsInput,
  ParentInput,
  ProfileInput,
  PushRegisterInput,
  RedeemInviteInput,
  ScoreRecordInput,
  StaffInput,
  StudentInput,
  ThemeInput,
  UiPrefsInput,
  VocabGenerateInput,
} from '@mochi/shared/schemas';
import type {
  AssessmentTypeRow,
  AttendanceRow,
  DashboardResponse,
  GradeRow,
  BehaviorRecordRow,
  Bootstrap,
  ClassRow,
  EventRow,
  FeedbackRow,
  FlashcardTopicRow,
  FlashcardWordRow,
  FlashcardResultRow,
  TopicBundle,
  TopicInfo,
  HomeworkRow,
  InviteRow,
  LoginResponse,
  MaterialRow,
  MeResponse,
  ParentRow,
  ProfileRow,
  ScoreRecordRow,
  StaffRow,
  StudentRow,
  ThemeRow,
  UiPrefs,
} from './types';

/**
 * One function per endpoint in docs/api.md. Screens call these; nothing outside this file
 * calls `apiFetch` directly, so a path or verb only ever appears once.
 *
 * Inputs are the Zod-inferred types from shared/schemas.ts — the exact same types the server
 * validates against, which is what stops the two clients drifting.
 *
 * Phase 2 only uses the auth, bootstrap, and profile calls. The rest are here because the
 * endpoints exist and phases 3-5 are pure-JS OTA updates that should not have to add plumbing.
 */

// ---- Auth ----

export const login = (input: LoginInput) =>
  apiFetch<LoginResponse>('/api/auth/login', { method: 'POST', body: input, auth: false });

export const redeemInvite = (input: RedeemInviteInput) =>
  apiFetch<LoginResponse>('/api/auth/redeem-invite', { method: 'POST', body: input, auth: false });

export const requestReset = (email: string) =>
  apiFetch<{ ok: true; devUrl?: string | null }>('/api/auth/request-reset', {
    method: 'POST',
    body: { email },
    auth: false,
  });

export const me = () => apiFetch<MeResponse>('/api/auth/me');

export const logout = () => apiFetch<{ ok: true }>('/api/auth/logout', { method: 'POST' });

export const changePassword = (input: ChangePasswordInput) =>
  apiFetch<{ ok: true }>('/api/auth/change-password', { method: 'POST', body: input });

// ---- Bootstrap and dashboard ----

export const bootstrap = () => apiFetch<Bootstrap>('/api/bootstrap');

export const dashboard = () => apiFetch<DashboardResponse>('/api/dashboard');

// ---- Collections ----
//
// `id` may be a path segment or ?id= — docs/api.md. These use the query form so one function
// covers every verb without string interpolation.

function collection<Row, Input>(path: string) {
  return {
    list: () => apiFetch<Row[]>(path),
    create: (input: Input) => apiFetch<Row>(path, { method: 'POST', body: input }),
    /** PATCH is a true partial: keys you omit are left alone, not reset to Zod defaults. */
    update: (id: string, patch: Partial<Input>) =>
      apiFetch<Row>(path, { method: 'PATCH', query: { id }, body: patch }),
    remove: (id: string) => apiFetch<{ ok: true }>(path, { method: 'DELETE', query: { id } }),
  };
}

export const events = collection<EventRow, EventInput>('/api/events');
export const classes = collection<ClassRow, ClassInput>('/api/classes');
export const students = collection<StudentRow, StudentInput>('/api/students');
export const staff = collection<StaffRow, StaffInput>('/api/staff');
export const parents = collection<ParentRow, ParentInput>('/api/parents');
export const homework = collection<HomeworkRow, HomeworkInput>('/api/homework');
export const materials = collection<MaterialRow, MaterialInput>('/api/materials');
export const feedback = collection<FeedbackRow, FeedbackInput>('/api/feedback');
export const scores = collection<ScoreRecordRow, ScoreRecordInput>('/api/assessments/scores');
export const behavior = collection<BehaviorRecordRow, BehaviorRecordInput>(
  '/api/assessments/behavior',
);
export const assessmentTypes = collection<AssessmentTypeRow, AssessmentTypeInput>(
  '/api/assessment-types',
);

/** Invites have no PATCH — a code is issued or revoked, never edited. */
export const invites = {
  list: () => apiFetch<InviteRow[]>('/api/invites'),
  create: (input: InviteInput) =>
    apiFetch<InviteRow>('/api/invites', { method: 'POST', body: input }),
  remove: (id: string) => apiFetch<{ ok: true }>('/api/invites', { method: 'DELETE', query: { id } }),
};

export const reorderAssessmentTypes = (ids: string[]) =>
  apiFetch<AssessmentTypeRow[]>('/api/assessment-types/reorder', { method: 'POST', body: { ids } });

/**
 * A material with a file. Must be FormData, and the file part must be the
 * `{ uri, name, type }` shape React Native's FormData understands — see docs/api.md for the
 * 20 MB cap (413 over it).
 *
 * Goes through `apiUpload` rather than `apiFetch` so the screen can show real progress: a
 * 20 MB upload on mobile data takes long enough that a spinner reads as a hang.
 */
export const uploadMaterial = (form: FormData, onProgress?: (pct: number) => void) =>
  apiUpload<MaterialRow>('/api/materials', form, { onProgress });

/** The same, for editing an existing material (optionally replacing its file). */
export const updateMaterialForm = (
  id: string,
  form: FormData,
  onProgress?: (pct: number) => void,
) => apiUpload<MaterialRow>('/api/materials', form, { method: 'PATCH', query: { id }, onProgress });

// ---- Attendance, event materials, grades ----

export const listAttendance = (eventId: string, date: string) =>
  apiFetch<AttendanceRow[]>('/api/attendance', { query: { eventId, date } });

/**
 * Delete-then-insert: a student omitted from `records` is UNMARKED, not left as they were.
 * Replies with the occurrence's refreshed record set.
 */
export const saveAttendance = (input: AttendanceSaveInput) =>
  apiFetch<AttendanceRow[]>('/api/attendance', { method: 'POST', body: input });

/**
 * Two shapes, two functions: with `?eventId=` the server returns that event's material ids
 * (`listForEvent` -> `string[]`); without it, the whole join table. One function typed as the
 * join-table shape would be a lie in the common case.
 */
export const listEventMaterials = (eventId: string) =>
  apiFetch<string[]>('/api/event-materials', { query: { eventId } });

export const listAllEventMaterials = () =>
  apiFetch<{ eventId: string; materialId: string }[]>('/api/event-materials');

export const saveEventMaterials = (input: EventMaterialsSaveInput) =>
  apiFetch<{ ok: true }>('/api/event-materials', { method: 'POST', body: input });

export const listHomeworkGrades = (homeworkId: string) =>
  apiFetch<GradeRow[]>(`/api/homework/${homeworkId}/grades`);

/** Replies with the homework's refreshed grade set — save the whole roster, as the web does. */
export const saveHomeworkGrades = (homeworkId: string, input: HomeworkGradesSaveInput) =>
  apiFetch<GradeRow[]>(`/api/homework/${homeworkId}/grades`, { method: 'POST', body: input });

// ---- Flashcards ----

export const flashcards = {
  /** `user` level — students play the games. */
  listTopics: () => apiFetch<FlashcardTopicRow[]>('/api/flashcards/topics'),
  createTopic: (input: FlashcardTopicInput) =>
    apiFetch<FlashcardTopicRow[]>('/api/flashcards/topics', { method: 'POST', body: input }),
  updateTopic: (id: string, patch: Partial<FlashcardTopicInput>) =>
    apiFetch<FlashcardTopicRow[]>('/api/flashcards/topics', {
      method: 'PATCH',
      query: { id },
      body: patch,
    }),
  removeTopic: (id: string) =>
    apiFetch<FlashcardTopicRow[]>('/api/flashcards/topics', { method: 'DELETE', query: { id } }),

  /**
   * Everything one topic needs, in one request — and the exact payload the offline store keeps.
   *
   * Note the SINGULAR `topic` in the path: /api/flashcards/topics is the collection, and
   * /api/flashcards/topic/:slug is the one-topic-with-words read. app/routes.ts:38-39.
   */
  topic: (slug: string) =>
    apiFetch<TopicBundle>(`/api/flashcards/topic/${encodeURIComponent(slug)}`),

  listWords: (topicId: string) =>
    apiFetch<FlashcardWordRow[]>('/api/flashcards/words', { query: { topicId } }),
  /** Replies with the topic's refreshed word list — the client needs the generated id. */
  createWord: (topicId: string, input: FlashcardWordInput) =>
    apiFetch<FlashcardWordRow[]>('/api/flashcards/words', {
      method: 'POST',
      query: { topicId },
      body: input,
    }),
  updateWord: (id: string, patch: Partial<FlashcardWordInput>) =>
    apiFetch<{ ok: true }>('/api/flashcards/words', {
      method: 'PATCH',
      query: { id },
      body: patch,
    }),
  removeWord: (id: string) =>
    apiFetch<{ id: string }>('/api/flashcards/words', { method: 'DELETE', query: { id } }),

  importWords: (topicId: string, input: FlashcardImportInput) =>
    apiFetch<{ imported: number }>('/api/flashcards/import', {
      method: 'POST',
      query: { topicId },
      body: input,
    }),

  /**
   * Create a topic and its first words together — the save step of AI generation. Returns the new
   * topic (the caller needs its slug to navigate there). Doing both writes server-side means an
   * abandoned save can't leave an empty topic behind.
   */
  createTopicWithWords: (input: FlashcardTopicWithWordsInput) =>
    apiFetch<TopicInfo>('/api/flashcards/generate-topic', { method: 'POST', body: input }),

  /**
   * Always a batch, so the phase-3 offline outbox can flush several at once. Every result
   * carries a `clientId` from the device: a retry after a dropped response is then a no-op
   * instead of double-counting the student's score.
   */
  recordResults: (input: FlashcardResultBatch) =>
    apiFetch<{ received: number; recorded: number; duplicates: number }>(
      '/api/flashcards/results',
      { method: 'POST', body: input },
    ),

  /**
   * STAFF only. With `?topicId=` it returns that topic's results; without, per-student
   * aggregates for the People screen. Students get their topic's results from `topic()`
   * instead — this endpoint would 403 for them.
   */
  topicResults: (topicId: string) =>
    apiFetch<FlashcardResultRow[]>('/api/flashcards/stats', { query: { topicId } }),
  studentStats: () =>
    apiFetch<{ studentId: string; rounds: number; avgPct: number; lastPlayedAt: string | null }[]>(
      '/api/flashcards/stats',
    ),
};

/**
 * AI vocabulary generation. STAFF only. Note the path is NOT under /api — like `/translate`,
 * this is a bearer-aware resource route (docs/api.md). It only proposes words; the ones the
 * user keeps are saved with `flashcards.importWords`.
 *
 * The 60s timeout is deliberate: the model call takes 5-20s, well past apiFetch's 15s default.
 */
export const generateVocab = (input: VocabGenerateInput) =>
  apiFetch<{ words: GeneratedWord[] }>('/generate-vocab', {
    method: 'POST',
    body: input,
    timeoutMs: 60_000,
  });

// ---- Profile and settings ----

export const profile = {
  get: () => apiFetch<ProfileRow>('/api/profile'),
  /** Cannot change `role` — ProfileInput has no such field, on purpose. */
  update: (patch: Partial<ProfileInput>) =>
    apiFetch<ProfileRow>('/api/profile', { method: 'PATCH', body: patch }),
};

export const settings = {
  getTheme: () => apiFetch<ThemeRow>('/api/settings/theme'),
  updateTheme: (patch: Partial<ThemeInput>) =>
    apiFetch<ThemeRow>('/api/settings/theme', { method: 'PATCH', body: patch }),
  getUiPrefs: () => apiFetch<UiPrefs>('/api/settings/ui-prefs'),
  updateUiPrefs: (patch: Partial<UiPrefsInput>) =>
    apiFetch<UiPrefs>('/api/settings/ui-prefs', { method: 'PATCH', body: patch }),
  /** What the cron jobs may send. School-wide today — see server/services/notif-prefs.ts. */
  getNotifPrefs: () => apiFetch<NotifPrefsInput>('/api/settings/notifications'),
  updateNotifPrefs: (patch: Partial<NotifPrefsInput>) =>
    apiFetch<NotifPrefsInput>('/api/settings/notifications', { method: 'PATCH', body: patch }),
};

// ---- Push (wired up in phase 6) ----

export const push = {
  register: (input: PushRegisterInput) =>
    apiFetch<{ ok: true }>('/api/push/register', { method: 'POST', body: input }),
  unregister: (expoToken: string) =>
    apiFetch<{ ok: true }>('/api/push/unregister', { method: 'POST', body: { expoToken } }),
};
