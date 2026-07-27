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
export type MaterialRow = Row<z.infer<typeof MaterialInput>>;
export type FeedbackRow = Row<z.infer<typeof FeedbackInput>>;
export type ScoreRecordRow = Row<z.infer<typeof ScoreRecordInput>>;
export type BehaviorRecordRow = Row<z.infer<typeof BehaviorRecordInput>>;
export type AssessmentTypeRow = Row<z.infer<typeof AssessmentTypeInput>>;
export type FlashcardTopicRow = Row<z.infer<typeof FlashcardTopicInput>> & {
  slug: string;
  wordCount?: number;
};
export type FlashcardWordRow = Row<z.infer<typeof FlashcardWordInput>> & { topicId: string };
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

export interface AttendanceRow {
  id: string;
  eventId: string;
  date: string;
  studentId: string;
  status: AttendanceStatus;
}

export interface ProfileRow extends AuthUser {
  /** The account email, which may differ from the person record's contact email. */
  email: string | null;
}
