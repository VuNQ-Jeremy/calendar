import type { z } from 'zod';
import type * as c from '@mochi/shared/api-contract';
import type * as t from './types';

/**
 * Compile-time drift check between the API's published response contract
 * (`shared/api-contract.ts`, which the OpenAPI document at /docs/openapi.json is generated from)
 * and this app's hand-written view of the same responses (`./types`).
 *
 * There is no runtime here — every line below is a type alias that fails to compile if the two
 * disagree. It exists because the contract is what the docs promise and `types.ts` is what the
 * screens actually consume; nothing else connects them.
 *
 * IMPORTANT: `mobile/` has its own tsconfig and is excluded from the repo root's, so the root
 * `npm run typecheck` does NOT see this file. It is only checked by `cd mobile && npx tsc
 * --noEmit`. Run that after touching either side. The shapes that come from `shared/logic/*`
 * instead of this file are checked in `test/api-contract.test.ts`, which the root run does cover.
 *
 * The assertion is ASSIGNABILITY, not equality: the contract may describe fields this app does
 * not bother to type (it often does — the server returns more than the phone draws), but it may
 * never contradict one or leave one out.
 */
type Extends<A, B> = A extends B ? true : false;
type Expect<T extends true> = T;

type Infer<S> = S extends z.ZodType ? z.infer<S> : never;

/* ── Collections ───────────────────────────────────────────────────────────────────────────── */
type _EventRow = Expect<Extends<Infer<typeof c.EventRow>, t.EventRow>>;
type _ClassRow = Expect<Extends<Infer<typeof c.ClassRow>, t.ClassRow>>;
type _StudentRow = Expect<Extends<Infer<typeof c.StudentRow>, t.StudentRow>>;
type _StaffRow = Expect<Extends<Infer<typeof c.StaffRow>, t.StaffRow>>;
type _ParentRow = Expect<Extends<Infer<typeof c.ParentRow>, t.ParentRow>>;
type _InviteRow = Expect<Extends<Infer<typeof c.InviteRow>, t.InviteRow>>;
type _MaterialRow = Expect<Extends<Infer<typeof c.MaterialRow>, t.MaterialRow>>;
type _FeedbackRow = Expect<Extends<Infer<typeof c.FeedbackRow>, t.FeedbackRow>>;
type _ScoreRecordRow = Expect<Extends<Infer<typeof c.ScoreRecordRow>, t.ScoreRecordRow>>;
type _BehaviorRecordRow = Expect<Extends<Infer<typeof c.BehaviorRecordRow>, t.BehaviorRecordRow>>;
type _MonthlyRemarkRow = Expect<Extends<Infer<typeof c.MonthlyRemarkRow>, t.MonthlyRemarkRow>>;
type _AssessmentTypeRow = Expect<Extends<Infer<typeof c.AssessmentTypeRow>, t.AssessmentTypeRow>>;
type _SubjectRow = Expect<Extends<Infer<typeof c.SubjectRow>, t.SubjectRow>>;
type _RemarkCriterionRow = Expect<
  Extends<Infer<typeof c.RemarkCriterionRow>, t.RemarkCriterionRow>
>;

/* ── Auth / bootstrap ──────────────────────────────────────────────────────────────────────── */
type _AuthUser = Expect<Extends<Infer<typeof c.AuthUser>, t.AuthUser>>;
type _AuthAccount = Expect<Extends<Infer<typeof c.AuthAccount>, t.AuthAccount>>;
type _MeResponse = Expect<Extends<Infer<typeof c.MeResponse>, t.MeResponse>>;
type _LoginResponse = Expect<Extends<Infer<typeof c.LoginResponse>, t.LoginResponse>>;
type _OtpRequestResult = Expect<Extends<Infer<typeof c.OtpRequestResult>, t.OtpRequestResult>>;
type _OtpCandidate = Expect<Extends<Infer<typeof c.OtpCandidate>, t.OtpCandidate>>;
type _OtpVerifyResult = Expect<Extends<Infer<typeof c.OtpVerifyResult>, t.OtpVerifyResult>>;
type _BadgeCounts = Expect<Extends<Infer<typeof c.BadgeCounts>, t.BadgeCounts>>;
type _Bootstrap = Expect<Extends<Infer<typeof c.Bootstrap>, t.Bootstrap>>;
type _ProfileRow = Expect<Extends<Infer<typeof c.ProfileRow>, t.ProfileRow>>;
type _UiPrefs = Expect<Extends<Infer<typeof c.UiPrefs>, t.UiPrefs>>;
type _ThemeRow = Expect<Extends<Infer<typeof c.ThemeRow>, t.ThemeRow>>;

/* ── Scheduling ────────────────────────────────────────────────────────────────────────────── */
type _AttendanceRow = Expect<Extends<Infer<typeof c.AttendanceRow>, t.AttendanceRow>>;
type _AttendanceHistoryRow = Expect<
  Extends<Infer<typeof c.AttendanceHistoryRow>, t.AttendanceHistoryRow>
>;
type _SessionPreviewRow = Expect<Extends<Infer<typeof c.SessionPreviewRow>, t.SessionPreviewRow>>;
type _SessionPreviewPayload = Expect<
  Extends<Infer<typeof c.SessionPreviewPayload>, t.SessionPreviewPayload>
>;
type _PreviewTestLite = Expect<Extends<Infer<typeof c.PreviewTestLite>, t.PreviewTestLite>>;
type _ComposedPreview = Expect<Extends<Infer<typeof c.ComposedPreview>, t.ComposedPreview>>;
type _UpcomingSession = Expect<Extends<Infer<typeof c.UpcomingSession>, t.UpcomingSession>>;
type _MySessionsResponse = Expect<
  Extends<Infer<typeof c.MySessionsResponse>, t.MySessionsResponse>
>;
type _DashboardResponse = Expect<Extends<Infer<typeof c.DashboardResponse>, t.DashboardResponse>>;

/* ── Flashcards ────────────────────────────────────────────────────────────────────────────── */
type _FlashcardTopicRow = Expect<Extends<Infer<typeof c.FlashcardTopicRow>, t.FlashcardTopicRow>>;
type _FlashcardWordRow = Expect<Extends<Infer<typeof c.FlashcardWordRow>, t.FlashcardWordRow>>;
type _FlashcardResultRow = Expect<
  Extends<Infer<typeof c.FlashcardResultRow>, t.FlashcardResultRow>
>;
type _MasteryRow = Expect<Extends<Infer<typeof c.MasteryRow>, t.MasteryRow>>;
type _TopicInfo = Expect<Extends<Infer<typeof c.TopicInfo>, t.TopicInfo>>;
type _TopicBundle = Expect<Extends<Infer<typeof c.TopicBundle>, t.TopicBundle>>;
type _StudentFlashcardStats = Expect<
  Extends<Infer<typeof c.StudentFlashcardStats>, t.StudentFlashcardStats>
>;

/* ── Garden ────────────────────────────────────────────────────────────────────────────────── */
type _StudentAssignmentChip = Expect<
  Extends<Infer<typeof c.StudentAssignmentChip>, t.StudentAssignmentChip>
>;
type _GardenPlantResponse = Expect<
  Extends<Infer<typeof c.GardenPlantResponse>, t.GardenPlantResponse>
>;
type _GardenMemberRow = Expect<Extends<Infer<typeof c.GardenMemberRow>, t.GardenMemberRow>>;
type _ClassGardenResponse = Expect<
  Extends<Infer<typeof c.ClassGardenResponse>, t.ClassGardenResponse>
>;
type _GardenSnapshotResponse = Expect<
  Extends<Infer<typeof c.GardenSnapshotResponse>, t.GardenSnapshotResponse>
>;

/* ── Parent portal ─────────────────────────────────────────────────────────────────────────── */
type _ParentPortalSettings = Expect<
  Extends<Infer<typeof c.ParentPortalSettings>, t.ParentPortalSettings>
>;
type _ParentChild = Expect<Extends<Infer<typeof c.ParentChild>, t.ParentChild>>;
type _ParentHomeResponse = Expect<
  Extends<Infer<typeof c.ParentHomeResponse>, t.ParentHomeResponse>
>;
type _ParentAttendanceResponse = Expect<
  Extends<Infer<typeof c.ParentAttendanceResponse>, t.ParentAttendanceResponse>
>;
type _ParentReportResponse = Expect<
  Extends<Infer<typeof c.ParentReportResponse>, t.ParentReportResponse>
>;
type _ParentTuitionResponse = Expect<
  Extends<Infer<typeof c.ParentTuitionResponse>, t.ParentTuitionResponse>
>;

export {};
