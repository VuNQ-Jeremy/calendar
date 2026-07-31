import type {
  AssessmentTypeInput,
  AttendanceStatus,
  BehaviorRecordInput,
  ClassInput,
  ColorId,
  EventInput,
  FeedbackInput,
  FlashcardTopicInput,
  FlashcardWordInput,
  HomeworkInput,
  InviteInput,
  MaterialInput,
  ParentInput,
  ScoreRecordInput,
  StaffInput,
  StudentInput,
  ThemeInput,
  UiPrefsInput,
} from '@mochi/shared/schemas';
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

export type EventRow = Row<z.infer<typeof EventInput>>;
export type ClassRow = Row<z.infer<typeof ClassInput>>;
export type StudentRow = Row<z.infer<typeof StudentInput>>;
export type StaffRow = Row<z.infer<typeof StaffInput>>;
export type ParentRow = Row<z.infer<typeof ParentInput>>;
export type InviteRow = Row<z.infer<typeof InviteInput>>;
export type HomeworkRow = Row<z.infer<typeof HomeworkInput>>;
/**
 * The one row the API returns with a field its input schema does not have: `fileKey` is the R2
 * object key, assigned server-side on upload. It is the only way to tell "this material has a
 * file to download" apart from "this material is a link", so the list screen needs it.
 */
export type MaterialRow = Row<z.infer<typeof MaterialInput>> & { fileKey?: string | null };
export type FeedbackRow = Row<z.infer<typeof FeedbackInput>>;
export type ScoreRecordRow = Row<z.infer<typeof ScoreRecordInput>>;
export type BehaviorRecordRow = Row<z.infer<typeof BehaviorRecordInput>>;
export type AssessmentTypeRow = Row<z.infer<typeof AssessmentTypeInput>>;
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
  /** 'Teacher' | 'Admin' | 'Assistant' for staff; 'Student' for students. */
  role: string;
  color: string;
  phone: string | null;
  kind: 'staff' | 'student';
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

export interface BadgeCounts {
  homeworkDue: number;
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
 * One homework grade. `scoreRecordId` is set when the grade also produced a `score_records` row
 * for the Assessment charts — the invariant is that one exists iff `score != null`
 * (`server/services/homework.ts`). The phone never writes it directly.
 */
export interface GradeRow {
  id: string;
  homeworkId: string;
  studentId: string;
  score: number | null;
  comment: string | null;
  gradedAt: string | null;
  scoreRecordId: string | null;
}

/** `/api/dashboard` — the mirror of the web's /dashboard loader. */
export interface DashboardResponse {
  /** The server's idea of today, as `YYYY-MM-DD`. */
  today: string;
  todayEvents: EventRow[];
  homeworkDueToday: HomeworkRow[];
  classes: { id: string; name: string; color: string }[];
}

export interface ProfileRow extends AuthUser {
  /** The account email, which may differ from the person record's contact email. */
  email: string | null;
}
