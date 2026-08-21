import { apiFetch, apiUpload, BASE } from './api';
import type {
  AssessmentTypeInput,
  SubjectInput,
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
  EnrichedWord,
  GeneratedWord,
  InviteInput,
  LoginInput,
  MaterialInput,
  MonthlyRemarkInput,
  NotifPrefsInput,
  OtpPickInput,
  OtpRequestInput,
  OtpVerifyInput,
  ParentInput,
  ProfileInput,
  PlantPatchInput,
  PushRegisterInput,
  RedeemInviteInput,
  RemarkCriterionInput,
  ScoreRecordInput,
  SessionPreviewInput,
  StaffInput,
  StudentInput,
  ThemeInput,
  UiPrefsInput,
  VocabEnrichItem,
  VocabGenerateInput,
  PronounceAssessment,
} from '@mochi/shared/schemas';
import type { GardenOutcome } from '@mochi/shared/logic/garden';
import type {
  AssessmentTypeRow,
  SubjectRow,
  AttendanceRow,
  DashboardResponse,
  BehaviorRecordRow,
  Bootstrap,
  ClassGardenResponse,
  ClassRow,
  EventRow,
  GardenPlantResponse,
  GardenSnapshotResponse,
  FeedbackRow,
  FlashcardTopicRow,
  FlashcardWordRow,
  FlashcardResultRow,
  TopicBundle,
  TopicInfo,
  InviteRow,
  LoginResponse,
  MaterialRow,
  MeResponse,
  MonthlyRemarkRow,
  MySessionsResponse,
  OtpRequestResult,
  OtpVerifyResult,
  ParentRow,
  ParentAttendanceResponse,
  ParentHomeResponse,
  ParentPortalSettings,
  ParentReportResponse,
  ParentTuitionResponse,
  ProfileRow,
  RemarkCriterionRow,
  ScoreRecordRow,
  SessionPreviewPayload,
  SessionPreviewRow,
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

/**
 * Zalo OTP login. `otpRequest` always answers `{ challengeId }` — a real one or a decoy, see
 * server/services/login-otp.ts — so the caller can never tell from this response alone whether
 * the phone matched anything. `otpVerify` replies with a session when exactly one account
 * matched, or `{ pick }` to disambiguate when it matched more than one; `otpPick` finishes that
 * second case by naming which candidate to sign into.
 */
export const otpRequest = (input: OtpRequestInput) =>
  apiFetch<OtpRequestResult>('/api/auth/otp-request', { method: 'POST', body: input, auth: false });

export const otpVerify = (input: OtpVerifyInput) =>
  apiFetch<OtpVerifyResult>('/api/auth/otp-verify', { method: 'POST', body: input, auth: false });

export const otpPick = (input: OtpPickInput) =>
  apiFetch<LoginResponse>('/api/auth/otp-pick', { method: 'POST', body: input, auth: false });

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
export const materials = collection<MaterialRow, MaterialInput>('/api/materials');
export const feedback = collection<FeedbackRow, FeedbackInput>('/api/feedback');
export const scores = collection<ScoreRecordRow, ScoreRecordInput>('/api/assessments/scores');
export const behavior = collection<BehaviorRecordRow, BehaviorRecordInput>(
  '/api/assessments/behavior',
);
/** POST upserts on (studentId, month) — one report per student per month. */
export const remarks = collection<MonthlyRemarkRow, MonthlyRemarkInput>('/api/assessments/remarks');
/** The monthly report's rating rows. Writes are admin (config screen, web); reads are staff. */
export const remarkCriteria = collection<RemarkCriterionRow, RemarkCriterionInput>(
  '/api/remark-criteria',
);
export const assessmentTypes = collection<AssessmentTypeRow, AssessmentTypeInput>(
  '/api/assessment-types',
);
/** The subject list the class editor picks from. Writes are admin (web /config); reads are staff. */
export const subjects = collection<SubjectRow, SubjectInput>('/api/subjects');

/** Invites have no PATCH — a code is issued or revoked, never edited. */
export const invites = {
  list: () => apiFetch<InviteRow[]>('/api/invites'),
  create: (input: InviteInput) =>
    apiFetch<InviteRow>('/api/invites', { method: 'POST', body: input }),
  remove: (id: string) =>
    apiFetch<{ ok: true }>('/api/invites', { method: 'DELETE', query: { id } }),
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

/**
 * Class↔material links, same two shapes as the event pair above. Read-only from the phone:
 * attaching is done on the web's class page, which is where the picker lives.
 */
export const listClassMaterials = (classId: string) =>
  apiFetch<string[]>('/api/class-materials', { query: { classId } });

export const listAllClassMaterials = () =>
  apiFetch<{ classId: string; materialId: string }[]>('/api/class-materials');

/**
 * "Preview buổi sau" for one occurrence. GET brings the vocabulary topics along so the picker
 * does not need a request of its own.
 */
export const eventPreviews = {
  get: (eventId: string, date: string) =>
    apiFetch<SessionPreviewPayload>('/api/event-previews', { query: { eventId, date } }),
  save: (input: SessionPreviewInput) =>
    apiFetch<SessionPreviewRow>('/api/event-previews', { method: 'POST', body: input }),
};

/** The signed-in user's upcoming sessions with previews — a student's own classes, or all of them. */
export const mySessions = () => apiFetch<MySessionsResponse>('/api/my-sessions');

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
    apiFetch<{
      received: number;
      recorded: number;
      duplicates: number;
      /**
       * What each round did to the garden, matched back by the `clientId` the device generated.
       *
       * OPTIONAL on purpose: an OTA update can reach a phone minutes before the Worker deploy
       * that added this field lands. Absent means "no note to show", never a crash. `garden` is
       * null for a staff play, a replayed result, and a garden write that was skipped.
       */
      outcomes?: { clientId: string | null; garden: GardenOutcome | null }[];
    }>('/api/flashcards/results', { method: 'POST', body: input }),

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

  /**
   * Score one spoken word (the pronounce game). Multipart — the WAV clip rides as a file part —
   * hence apiUpload, not apiFetch. NOT under /api: the route also serves the web game's cookie
   * fetch (the enrich-vocab split); bearer auth works there all the same. 429 means the free
   * Azure tier is busy with another student — retryable; 503 means scoring is not configured.
   */
  assessPronunciation: (form: FormData) => apiUpload<PronounceAssessment>('/speech-assess', form),
};

/**
 * AI vocabulary generation. STAFF only. Note the path is NOT under /api — like `/enrich-vocab`,
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

/**
 * Fill in the Vietnamese meaning, English definition and IPA for words the user already has.
 * STAFF only, and again NOT under /api. This replaced the web's browser-side dictionaryapi.dev
 * lookup, which never existed on mobile — so the import screen and word editor could not offer
 * auto-fill at all before this.
 *
 * Prefer `enrichInChunks` (lib/enrich.ts) over calling this directly: the route accepts 200 words
 * but a batch that large runs past even the 60s timeout.
 */
export const enrichVocab = (items: VocabEnrichItem[]) =>
  apiFetch<{ words: EnrichedWord[] }>('/enrich-vocab', {
    method: 'POST',
    body: { items },
    timeoutMs: 60_000,
  });

// ---- The garden ----
//
// Student-facing only, deliberately. Watering, assignments, the event history and the admin dev
// tools are all staff work and live on the web — see docs/mobile-parity.md. The endpoints exist
// server-side either way; nothing here is a capability gap, it is a scope decision.

export const garden = {
  /**
   * The caller's own plant, settled to today by the server.
   *
   * Never cache this across an ICT day boundary: the plant wilts and drops stages at midnight
   * whether or not anything ran. `qk.gardenPlant` bakes the day into the key for exactly this.
   */
  plant: () => apiFetch<GardenPlantResponse>('/api/garden/plant'),
  /** Rename the plant / repaint the pot. Students only — the server 403s staff. */
  updatePlant: (patch: PlantPatchInput) =>
    apiFetch<GardenPlantResponse>('/api/garden/plant', { method: 'PATCH', body: patch }),
  /**
   * Bank a fruit and replant a seed. Throws `ApiError` 409 (`not_ripe` / `dead`) when the plant is
   * not at the fruit stage — including on a double tap, which is the point.
   */
  harvest: () =>
    apiFetch<{ ok: true; fruitsTotal: number }>('/api/garden/harvest', { method: 'POST' }),
  /** One class's garden plus its cooperative tree. 403 for a class the student is not in. */
  classGarden: (classId: string) =>
    apiFetch<ClassGardenResponse>(`/api/garden/class/${encodeURIComponent(classId)}`),
  /** Which months the album has. */
  listSnapshots: (classId: string) =>
    apiFetch<{ month: string; createdAt: string }[]>('/api/garden/snapshots', {
      query: { classId },
    }),
  /** One frozen month. A month that was never saved is a 404, not an empty garden. */
  getSnapshot: (classId: string, month: string) =>
    apiFetch<GardenSnapshotResponse>('/api/garden/snapshots', { query: { classId, month } }),
};

// ---- Profile and settings ----

export const profile = {
  get: () => apiFetch<ProfileRow>('/api/profile'),
  /** Cannot change `role` — ProfileInput has no such field, on purpose. */
  update: (patch: Partial<ProfileInput>) =>
    apiFetch<ProfileRow>('/api/profile', { method: 'PATCH', body: patch }),
};

/**
 * The parent portal. Every one of these 403s unless the caller is a parent AND an admin has the
 * portal switched on AND the child in the path is theirs — see server/services/parent-portal.ts.
 */
export const parent = {
  /** Every child plus their week, in one round trip. */
  home: () => apiFetch<ParentHomeResponse>('/api/parent/home'),
  attendance: (studentId: string, month: string) =>
    apiFetch<ParentAttendanceResponse>(
      `/api/parent/attendance/${encodeURIComponent(studentId)}?month=${month}`,
    ),
  report: (studentId: string, month: string) =>
    apiFetch<ParentReportResponse>(`/api/parent/report/${encodeURIComponent(studentId)}/${month}`),
  /** The one tuition read that exists on mobile; see the route file on why it is parent-only. */
  tuition: (studentId: string, month: string) =>
    apiFetch<ParentTuitionResponse>(
      `/api/parent/tuition/${encodeURIComponent(studentId)}/${month}`,
    ),
};

export const settings = {
  getTheme: () => apiFetch<ThemeRow>('/api/settings/theme'),
  updateTheme: (patch: Partial<ThemeInput>) =>
    apiFetch<ThemeRow>('/api/settings/theme', { method: 'PATCH', body: patch }),
  getUiPrefs: () => apiFetch<UiPrefs>('/api/settings/ui-prefs'),
  /** `any` level on GET: a parent's own tab bar depends on it. Admin-only to write. */
  getParentPortal: () => apiFetch<ParentPortalSettings>('/api/settings/parent-portal'),
  updateParentPortal: (patch: Partial<ParentPortalSettings>) =>
    apiFetch<ParentPortalSettings>('/api/settings/parent-portal', {
      method: 'PATCH',
      body: patch,
    }),
  updateUiPrefs: (patch: Partial<UiPrefsInput>) =>
    apiFetch<UiPrefs>('/api/settings/ui-prefs', { method: 'PATCH', body: patch }),
  /**
   * What the cron jobs may send YOU. Per account since migration 0043; `classLeadMinutes` is
   * still school-wide — see server/services/notif-prefs.ts.
   */
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
