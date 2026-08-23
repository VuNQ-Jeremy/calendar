import type {
  AssessmentTypeInput,
  SubjectInput,
  AttendanceStatus,
  BehaviorRecordInput,
  ClassInput,
  ColorId,
  EventInput,
  FeedbackInput,
  FlashcardTopicInput,
  FlashcardWordInput,
  InviteInput,
  MaterialInput,
  MonthlyRemarkInput,
  ParentInput,
  RemarkCriterionInput,
  ScoreRecordInput,
  StaffInput,
  StudentInput,
  ThemeInput,
  UiPrefsInput,
} from '@mochi/shared/schemas';
import type { GardenSettings, GardenSnapshotData, PlantView } from '@mochi/shared/logic/garden';
import type { StudentFee } from '@mochi/shared/logic/fees';
import type { z } from 'zod';

/**
 * The CLIENT's view of what the API returns.
 *
 * Deliberately not imported from `server/` — that would drag Drizzle and the Workers types
 * into the mobile graph. Instead each row is its Zod input schema plus the server-assigned
 * `id`, which is exactly what the service layer returns: every `*Input` in shared/schemas.ts
 * mirrors its table's columns one-for-one.
 *
 * If a row and its input schema ever diverge, that is a bug in the API, not in this file.
 */
type Row<T> = T & { id: string };

export type ColorIdValue = z.infer<typeof ColorId>;

/**
 * `until` and `exdates` are server-computed series bounds, not user input, so they live outside
 * EventInput: the web app writes them when a recurring event is split or an occurrence detached,
 * and `expandEvents` reads them. Mobile only ever passes them through.
 */
export type EventRow = Row<z.infer<typeof EventInput>> & {
  until?: string | null;
  exdates?: string[];
};
export type ClassRow = Row<z.infer<typeof ClassInput>>;
export type StudentRow = Row<z.infer<typeof StudentInput>>;
export type StaffRow = Row<z.infer<typeof StaffInput>>;
export type ParentRow = Row<z.infer<typeof ParentInput>>;
export type InviteRow = Row<z.infer<typeof InviteInput>>;
/**
 * The one row the API returns with a field its input schema does not have: `fileKey` is the R2
 * object key, assigned server-side on upload. It is the only way to tell "this material has a
 * file to download" apart from "this material is a link", so the list screen needs it.
 */
export type MaterialRow = Row<z.infer<typeof MaterialInput>> & { fileKey?: string | null };
export type FeedbackRow = Row<z.infer<typeof FeedbackInput>>;
export type ScoreRecordRow = Row<z.infer<typeof ScoreRecordInput>>;
export type BehaviorRecordRow = Row<z.infer<typeof BehaviorRecordInput>>;
export type MonthlyRemarkRow = Row<z.infer<typeof MonthlyRemarkInput>>;
export type AssessmentTypeRow = Row<z.infer<typeof AssessmentTypeInput>>;
export type SubjectRow = Row<z.infer<typeof SubjectInput>>;
export type RemarkCriterionRow = Row<z.infer<typeof RemarkCriterionInput>>;
/**
 * The flashcard rows are spelled out rather than derived from their input schemas, because the
 * server adds fields the schemas don't have and `slug` really is nullable — see the exported
 * types in `server/services/flashcards.ts`, which these mirror exactly.
 */
export interface FlashcardTopicRow {
  id: string;
  name: string;
  /** Null on topics created before migration 0011. Fall back to `id` when routing. */
  slug: string | null;
  description: string | null;
  color: string;
  createdAt: string | null;
  wordCount: number;
}

export interface FlashcardWordRow {
  id: string;
  topicId: string;
  word: string;
  /** May be empty — games fall back to `definitionEn`, then the word itself. */
  meaningVi: string;
  definitionEn: string | null;
  ipa: string | null;
  /** One example sentence containing the word, or null. Powers the cloze/listen games. */
  exampleEn: string | null;
  /** The exact form of the word as used in exampleEn (may be inflected), or null. */
  exampleAnswer: string | null;
  audioUrl: string | null;
  createdAt: string | null;
}

/** One completed game. Exactly one of the players is staff; `isStaff` says which. */
export interface FlashcardResultRow {
  id: string;
  playerId: string;
  playerName: string;
  playerColor: string;
  isStaff: boolean;
  topicId: string;
  mode: string;
  score: number;
  total: number;
  durationMs: number | null;
  playedAt: string;
}

/**
 * One student's flashcard activity, aggregated across every topic. Shown on the student detail
 * screen — the mobile home of the block the web puts inside its Student modal.
 */
export interface StudentFlashcardStats {
  studentId: string;
  rounds: number;
  avgPct: number;
  lastPlayedAt: string | null;
}

/**
 * Per-(student, word) counters. Staff plays produce NO mastery row — a teacher testing a topic
 * must not pollute student stats — so this array is always empty for staff.
 */
export interface MasteryRow {
  wordId: string;
  correct: number;
  wrong: number;
  lastSeen: string | null;
  /**
   * Spaced-repetition state, carried in the bundle so a future review screen can filter offline
   * with no new endpoint. Nothing on the phone reads these yet — see docs/mobile-parity.md.
   */
  level: number;
  dueDay: string | null;
}

/** A topic without its word count — what a create call replies with. */
export interface TopicInfo {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  color: string;
}

/** The whole payload for one topic. This exact object is what gets cached for offline use. */
export interface TopicBundle {
  topic: FlashcardTopicRow;
  words: FlashcardWordRow[];
  results: FlashcardResultRow[];
  mastery: MasteryRow[];
}
export type ThemeRow = z.infer<typeof ThemeInput>;
export type UiPrefs = z.infer<typeof UiPrefsInput>;

/** `SessionUser['user']` plus the `kind` discriminator the API folds in. See docs/api.md. */
export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  /** 'Teacher' | 'Admin' | 'Assistant' for staff; 'Student' / 'Parent' otherwise. */
  role: string;
  color: string;
  phone: string | null;
  /**
   * A parent gets Profile always, and the Children tab once an admin switches the portal on —
   * see mobile/lib/use-parent-portal.ts and the tab options in app/(app)/_layout.tsx.
   */
  kind: 'staff' | 'student' | 'parent';
}

export interface AuthAccount {
  id: string;
  email: string;
}

export interface MeResponse {
  user: AuthUser;
  account: AuthAccount;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
}

/** Always this shape, whether or not the phone matched anything real — see login-otp.ts. */
export interface OtpRequestResult {
  challengeId: string;
}

/** One account a phone number resolved to, shown only after the code has been proven correct. */
export interface OtpCandidate {
  accountId: string;
  name: string;
  kind: 'staff' | 'student' | 'parent';
  schoolName: string;
}

/** Either a session (one account matched) or a list to disambiguate (several did). */
export type OtpVerifyResult = LoginResponse | { pick: OtpCandidate[] };

export interface BadgeCounts {
  unusedInvites: number;
  newFeedback: number;
}

/**
 * One cold-start round trip. The roster fields are absent for students by design — they must
 * never be sent the school's student list — hence the optionals.
 */
export interface Bootstrap extends MeResponse {
  uiPrefs: UiPrefs;
  badgeCounts: BadgeCounts;
  classes?: ClassRow[];
  students?: StudentRow[];
  assessmentTypes?: AssessmentTypeRow[];
  theme?: ThemeRow;
}

/**
 * No `id`: the table's primary key is the (event_id, date, student_id) triple and the service
 * does not project a surrogate — see `server/services/attendance.ts`.
 */
export interface AttendanceRow {
  eventId: string;
  date: string;
  studentId: string;
  status: AttendanceStatus;
}

/**
 * "Preview buổi sau" — the stored half, keyed per occurrence like AttendanceRow above.
 * `null` from the API means nobody has written one for this (eventId, date) yet.
 */
export interface SessionPreviewRow {
  eventId: string;
  date: string;
  focusText: string;
  vocabTopicId: string | null;
  homeworkText: string;
  updatedAt: string | null;
}

/** `/api/event-previews` GET — the row plus the topics the picker offers. */
export interface SessionPreviewPayload {
  preview: SessionPreviewRow | null;
  topics: { id: string; name: string }[];
}

/** A test as it appears inside a preview: enough to name it, nothing more. */
export interface PreviewTestLite {
  id: string;
  title: string;
  mode: string;
  date: string | null;
  openAt: string | null;
  closeAt: string | null;
}

/** The composed preview — the teacher's text, plus what the server worked out on its own. */
export interface ComposedPreview {
  focusText: string;
  vocabTopic: { id: string; name: string; slug: string | null; wordCount: number } | null;
  tests: PreviewTestLite[];
}

export interface UpcomingSession {
  eventId: string;
  date: string;
  start: string | null;
  end: string | null;
  title: string;
  location: string | null;
  classId: string;
  className: string;
  classColor: string;
  preview: ComposedPreview;
}

/** `/api/my-sessions` — computed against the server clock, hence `serverNow`. */
export interface MySessionsResponse {
  serverNow: string;
  items: UpcomingSession[];
}

/* ── Parent portal ─────────────────────────────────────────────────────────────────────────── */

/** `/api/settings/parent-portal` — the school-wide switch, readable by every signed-in kind. */
export interface ParentPortalSettings {
  enabled: boolean;
}

export interface ParentChild {
  id: string;
  name: string;
  color: string;
  classNames: string[];
  items: UpcomingSession[];
}

/** `/api/parent/home` — every child and their week in one round trip. */
export interface ParentHomeResponse {
  serverNow: string;
  children: ParentChild[];
}

/** One past session as a family sees it — the server type of the same name. */
export interface AttendanceHistoryRow {
  eventId: string;
  date: string;
  status: string;
  eventTitle: string;
  startTime: string | null;
  endTime: string | null;
  classId: string | null;
  className: string | null;
}

/** `/api/parent/attendance/:studentId?month=YYYY-MM`. */
export interface ParentAttendanceResponse {
  month: string;
  attendance: AttendanceHistoryRow[];
}

/**
 * `/api/parent/report/:studentId/:month` — the same payload the printable slip renders, from
 * `server/services/report-card.ts`. Only the fields the phone actually draws are typed here; the
 * document carries more (per-class score lines, homework, the garden block).
 */
export interface ParentReportResponse {
  month: string;
  student: { id: string; name: string };
  classNames: string[];
  /** null when the teacher has not written this month's remark yet. */
  remark: MonthlyRemarkRow | null;
  teacher: string | null;
  criteria: { id: string; name: string }[];
  stats: {
    average: number | null;
    testCount: number;
    incidents: Record<string, number>;
    praiseCount: number;
  };
}

/** `/api/parent/tuition/:studentId/:month` — the fee slip, `server/services/fee-slip.ts`. */
export interface ParentTuitionResponse {
  month: string;
  student: { id: string; name: string; guardian: string | null; phone: string | null };
  fee: StudentFee;
  closedAt: string | null;
  isClosed: boolean;
}

/** `/api/dashboard` — the mirror of the web's /dashboard loader. */
export interface DashboardResponse {
  /** The server's idea of today, as `YYYY-MM-DD`. */
  today: string;
  todayEvents: EventRow[];
  classes: { id: string; name: string; color: string }[];
}

export interface ProfileRow extends AuthUser {
  /** The account email, which may differ from the person record's contact email. */
  email: string | null;
}

// ---- The garden ----
//
// `PlantView`, `GardenSettings`, `GardenOutcome` and the snapshot shapes all come from
// `@mochi/shared/logic/garden` — they are the same objects the server derives, so there is nothing
// to mirror. Only the response envelopes are declared here.

/** One open vocabulary assignment as the student sees it, from `/api/garden/plant`. */
export interface StudentAssignmentChip {
  id: string;
  topicId: string;
  topicName: string;
  /** Null for a topic with no slug yet; the deep link falls back to the id. */
  topicSlug: string | null;
  className: string;
  deadline: string;
  /** ICT 'HH:MM' the deadline expires at, or null for end of day — print with `formatDmyTime`. */
  deadlineTime: string | null;
  requiredCount: number;
  minScorePct: number;
  /** CSV of the game modes that count, null/absent = any — parse with `parseModes`. */
  modes?: string | null;
  done: number;
}

/**
 * `GET`/`PATCH /api/garden/plant` — the student's own plant, already settled by the server.
 *
 * `today` is the server's ICT day. Every date comparison this app renders (deadline urgency, the
 * drop warning) measures against it, never against the device clock.
 */
export interface GardenPlantResponse extends PlantView {
  studentId: string;
  today: string;
  /** False when nothing has been planted yet — the rename editor has no row to land on. */
  hasPlant: boolean;
  plantName: string | null;
  potColor: string;
  /** Species id — see shared/garden-art.ts. 'classic' for a pot nothing has been planted in. */
  species: string;
  /** Harvests in the current ICT month, derived from the event log. */
  fruitMonth: number;
  assignments: StudentAssignmentChip[];
  classes: { id: string; name: string }[];
  settings: GardenSettings;
}

/** One classmate's plant in the shared garden. */
export interface GardenMemberRow extends PlantView {
  studentId: string;
  name: string;
  color: string;
  plantName: string | null;
  potColor: string;
  /** Species id — see shared/garden-art.ts. */
  species: string;
  fruitMonth: number;
}

/** `GET /api/garden/class/:id` — the class's plants plus the tree they grew together. */
export interface ClassGardenResponse {
  classId: string;
  className: string;
  /** Ordered by name by the server. Never re-sort: this is a garden, not a leaderboard. */
  members: GardenMemberRow[];
  tree: { points: number; level: number };
}

/** `GET /api/garden/snapshots?classId=&month=` — one frozen month of the album. */
export interface GardenSnapshotResponse {
  className: string;
  month: string;
  data: GardenSnapshotData;
}
