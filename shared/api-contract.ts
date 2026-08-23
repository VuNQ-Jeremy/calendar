import { z } from 'zod';
import {
  AssessmentTypeInput,
  AttendanceStatus,
  BehaviorRecordInput,
  ClassInput,
  EventInput,
  FeedbackInput,
  GradeLevelInput,
  InviteInput,
  MaterialInput,
  MonthlyRemarkInput,
  ParentInput,
  RemarkCriterionInput,
  ScoreRecordInput,
  StaffInput,
  StudentInput,
  SubjectInput,
  VocabAssignmentInput,
} from './schemas';

/**
 * RESPONSE schemas for the JSON API — the `data` half of the `{ data }` envelope.
 *
 * `shared/schemas.ts` describes what clients may SEND; this file describes what the server
 * SENDS BACK, which nothing else had a machine-readable answer for. `server/api/docs/build-spec.ts`
 * turns these into the `components.schemas` of the OpenAPI document served at /docs/openapi.json.
 *
 * Two rules keep this file honest:
 *
 * 1. **Every exported schema carries `.meta({ id })`.** That is what puts it in Zod's global
 *    registry, which is what makes the emitted spec use `$ref` instead of inlining the same
 *    object twenty times. The id must match the export name.
 * 2. **These are checked against the client's own view.** `mobile/lib/contract-check.ts` asserts
 *    each schema is assignable to the hand-written type of the same name in `mobile/lib/types.ts`,
 *    and `test/api-contract.test.ts` does the same for the shapes that come from `shared/logic/`.
 *    Assignability, not equality: a schema here may carry fields the phone does not bother to
 *    type (it usually does — see `InviteRow`), but it may never contradict or omit one.
 *
 * Where a row is exactly "its input schema plus the server-assigned id", it is derived with
 * `rowOf` rather than retyped, so an enum tightened in schemas.ts tightens here too.
 */

/**
 * A persisted row: its input schema plus the id the server assigns. Mirrors `Row<T>` in
 * `mobile/lib/types.ts`.
 *
 * The return type is spelled out because inside a generic function TypeScript only knows `S` by
 * its constraint, so it resolves `.extend()` against `ZodRawShape` and every field type is lost —
 * which would make the assignability checks in `mobile/lib/contract-check.ts` pass vacuously.
 */
const rowOf = <S extends z.ZodObject<z.ZodRawShape>>(
  input: S,
  id: string,
): z.ZodObject<S['shape'] & { id: z.ZodString }> =>
  input.extend({ id: z.string() }).meta({ id }) as unknown as z.ZodObject<
    S['shape'] & { id: z.ZodString }
  >;

const Nullable = <S extends z.ZodType>(s: S) => s.nullable();

/* ── Envelope ──────────────────────────────────────────────────────────────────────────────── */

/**
 * The failure half of the envelope. `issues` is the Zod issue array and is present only on
 * `validation_failed`. Success responses are `{ data: <payload> }`, assembled by the builder.
 */
export const ErrorEnvelope = z
  .object({
    error: z.string(),
    issues: z.array(z.unknown()).optional(),
  })
  .meta({ id: 'ErrorEnvelope' });

/**
 * A bare id acknowledgement. Every `crud()` DELETE replies with this — the services all return
 * void and the route synthesises it — as do the garden-assignment create and update.
 */
export const IdAck = z.object({ id: z.string() }).meta({ id: 'IdAck' });

/** A bare acknowledgement, used by writes with nothing to hand back. */
export const OkAck = z.object({ ok: z.literal(true) }).meta({ id: 'OkAck' });

/* ── Collections (crud) ────────────────────────────────────────────────────────────────────── */

export const EventRow = rowOf(EventInput, 'EventRow');
export const ClassRow = rowOf(ClassInput, 'ClassRow');
export const StudentRow = rowOf(StudentInput, 'StudentRow');
export const StaffRow = rowOf(StaffInput, 'StaffRow');
export const ParentRow = rowOf(ParentInput, 'ParentRow');

/**
 * `fileKey` is the R2 object key, assigned server-side on upload and absent from the input
 * schema. It is the only way to tell "has a file to download" from "is a link".
 */
export const MaterialRow = MaterialInput.extend({
  id: z.string(),
  fileKey: z.string().nullish(),
}).meta({ id: 'MaterialRow' });

/**
 * The link columns (`studentId`/`staffId`/`parentId`) and the resolved `personName` are added by
 * the service's joins — a code minted from a person page attaches to that existing row on redeem
 * instead of creating a second one. All four are null for legacy, unlinked invites.
 */
export const InviteRow = InviteInput.extend({
  id: z.string(),
  studentId: Nullable(z.string()),
  staffId: Nullable(z.string()),
  parentId: Nullable(z.string()),
  personName: Nullable(z.string()),
}).meta({ id: 'InviteRow' });

export const FeedbackRow = rowOf(FeedbackInput, 'FeedbackRow');
export const ScoreRecordRow = rowOf(ScoreRecordInput, 'ScoreRecordRow');
export const BehaviorRecordRow = rowOf(BehaviorRecordInput, 'BehaviorRecordRow');

/** The audit columns are server-owned; `sentAt` is when the slip last reached a family chat. */
export const MonthlyRemarkRow = MonthlyRemarkInput.extend({
  id: z.string(),
  staffId: Nullable(z.string()),
  createdAt: Nullable(z.string()),
  updatedAt: Nullable(z.string()),
  sentAt: Nullable(z.string()),
}).meta({ id: 'MonthlyRemarkRow' });

export const AssessmentTypeRow = rowOf(AssessmentTypeInput, 'AssessmentTypeRow');
export const SubjectRow = rowOf(SubjectInput, 'SubjectRow');
export const GradeLevelRow = rowOf(GradeLevelInput, 'GradeLevelRow');
export const RemarkCriterionRow = rowOf(RemarkCriterionInput, 'RemarkCriterionRow');

/** Denormalised: the class and topic are joined in so a chip can render without a second call. */
export const VocabAssignmentRow = VocabAssignmentInput.extend({
  id: z.string(),
  className: z.string(),
  classColor: z.string(),
  topicName: z.string(),
  topicSlug: Nullable(z.string()),
  createdAt: z.string(),
}).meta({ id: 'VocabAssignmentRow' });

/* ── Auth ──────────────────────────────────────────────────────────────────────────────────── */

/** The signed-in person. `kind` is the discriminator the API folds in over the session row. */
export const AuthUser = z
  .object({
    id: z.string(),
    name: z.string(),
    email: Nullable(z.string()),
    /** 'Teacher' | 'Admin' | 'Assistant' for staff; 'Student' / 'Parent' otherwise. */
    role: z.string(),
    color: z.string(),
    phone: Nullable(z.string()),
    kind: z.enum(['staff', 'student', 'parent']),
  })
  .meta({ id: 'AuthUser' });

export const AuthAccount = z
  .object({ id: z.string(), email: z.string() })
  .meta({ id: 'AuthAccount' });

export const MeResponse = z.object({ user: AuthUser, account: AuthAccount }).meta({
  id: 'MeResponse',
});

/** The raw bearer token. Only its SHA-256 hash is stored, so this value is never recoverable. */
export const LoginResponse = z
  .object({ token: z.string(), expiresAt: z.string() })
  .meta({ id: 'LoginResponse' });

/** Always this shape, whether or not the phone matched anything real — see login-otp.ts. */
export const OtpRequestResult = z
  .object({ challengeId: z.string() })
  .meta({ id: 'OtpRequestResult' });

/** setPasswordViaOtp never mints a session — the caller signs in afterward with the new password. */
export const OtpSetPasswordResult = z.object({ ok: z.literal(true) }).meta({
  id: 'OtpSetPasswordResult',
});

/** One account a phone number resolved to, shown only after the code has been proven correct.
 * `schoolName` is the user-facing disambiguator; internal ids beyond `accountId` stay server-side. */
export const OtpCandidate = z
  .object({
    accountId: z.string(),
    name: z.string(),
    kind: z.enum(['staff', 'student', 'parent']),
    schoolName: z.string(),
  })
  .meta({ id: 'OtpCandidate' });

export const OtpPickList = z.object({ pick: z.array(OtpCandidate) }).meta({ id: 'OtpPickList' });

/** Either a session (one account matched) or a list to disambiguate (several did). */
export const OtpVerifyResult = z
  .union([LoginResponse, OtpPickList])
  .meta({ id: 'OtpVerifyResult' });

/** `homeworkDue` is always 0 — the homework feature is gone, the key is kept for old builds. */
export const BadgeCounts = z
  .object({
    homeworkDue: z.number().int(),
    unusedInvites: z.number().int(),
    newFeedback: z.number().int(),
  })
  .meta({ id: 'BadgeCounts' });

/**
 * Settings responses are the SETTLED value, so every field is present — unlike the matching
 * `*Input` schemas in schemas.ts, where an absent key means "leave this one alone".
 */
export const UiPrefs = z
  .object({
    scrollbar: z.enum(['slim', 'inset', 'brand', 'ghost']),
    mobileTabBar: z.enum(['pill', 'dock', 'indicator']),
    vocabCard: z.enum(['band', 'full', 'tint']),
  })
  .meta({ id: 'UiPrefs' });

export const ThemeRow = z
  .object({
    bg: z.string(),
    gridLine: z.string(),
    today: z.string(),
    header: z.string(),
    /** '' when no background image is set — never null. */
    bgImage: z.string(),
    bgOpacity: z.number(),
  })
  .meta({ id: 'ThemeRow' });

export const NotifPrefs = z
  .object({
    classReminders: z.boolean(),
    /** Floored at 15 and capped at 120: the class sweep only runs every 15 minutes. */
    classLeadMinutes: z.number().int(),
    studyNudges: z.boolean(),
    previewEvening: z.boolean(),
    gardenAlerts: z.boolean(),
  })
  .meta({ id: 'NotifPrefs' });

/**
 * One cold-start round trip. The roster fields are absent for students by design — they must
 * never be sent the school's student list — hence the optionals.
 */
export const Bootstrap = MeResponse.extend({
  uiPrefs: UiPrefs,
  badgeCounts: BadgeCounts,
  classes: z.array(ClassRow).optional(),
  students: z.array(StudentRow).optional(),
  assessmentTypes: z.array(AssessmentTypeRow).optional(),
  theme: ThemeRow.optional(),
}).meta({ id: 'Bootstrap' });

export const ProfileRow = AuthUser.extend({
  /** The account email, which may differ from the person record's contact email. */
  email: Nullable(z.string()),
}).meta({ id: 'ProfileRow' });

/**
 * `PATCH /api/profile` answers with the updated PERSON row, whose shape depends on which kind
 * of account the caller is — it is not the `ProfileRow` the GET returns.
 */
export const ProfilePatchResult = z
  .union([StaffRow, ParentRow, StudentRow])
  .meta({ id: 'ProfilePatchResult' });

/* ── Scheduling ────────────────────────────────────────────────────────────────────────────── */

/** No `id`: the primary key is the (eventId, date, studentId) triple, and nothing projects one. */
export const AttendanceRow = z
  .object({
    eventId: z.string(),
    date: z.string(),
    studentId: z.string(),
    status: AttendanceStatus,
  })
  .meta({ id: 'AttendanceRow' });

/** One past session as a family sees it — joined with the event so it can be named. */
export const AttendanceHistoryRow = z
  .object({
    eventId: z.string(),
    date: z.string(),
    status: z.string(),
    eventTitle: z.string(),
    startTime: Nullable(z.string()),
    endTime: Nullable(z.string()),
    classId: Nullable(z.string()),
    className: Nullable(z.string()),
  })
  .meta({ id: 'AttendanceHistoryRow' });

/** "Preview buổi sau" — the stored half, keyed per occurrence like AttendanceRow. */
export const SessionPreviewRow = z
  .object({
    eventId: z.string(),
    date: z.string(),
    focusText: z.string(),
    vocabTopicId: Nullable(z.string()),
    homeworkText: z.string(),
    updatedAt: Nullable(z.string()),
  })
  .meta({ id: 'SessionPreviewRow' });

export const SessionPreviewPayload = z
  .object({
    /** Null when nobody has written a preview for this (eventId, date) yet. */
    preview: Nullable(SessionPreviewRow),
    topics: z.array(z.object({ id: z.string(), name: z.string() })),
  })
  .meta({ id: 'SessionPreviewPayload' });

/** A test as it appears inside a preview: enough to name it, nothing more. */
export const PreviewTestLite = z
  .object({
    id: z.string(),
    title: z.string(),
    mode: z.string(),
    date: Nullable(z.string()),
    openAt: Nullable(z.string()),
    closeAt: Nullable(z.string()),
  })
  .meta({ id: 'PreviewTestLite' });

/** The teacher's text plus what the server worked out on its own. */
export const ComposedPreview = z
  .object({
    focusText: z.string(),
    vocabTopic: Nullable(
      z.object({
        id: z.string(),
        name: z.string(),
        slug: Nullable(z.string()),
        wordCount: z.number().int(),
      }),
    ),
    tests: z.array(PreviewTestLite),
  })
  .meta({ id: 'ComposedPreview' });

export const UpcomingSession = z
  .object({
    eventId: z.string(),
    date: z.string(),
    start: Nullable(z.string()),
    end: Nullable(z.string()),
    title: z.string(),
    location: Nullable(z.string()),
    classId: z.string(),
    className: z.string(),
    classColor: z.string(),
    preview: ComposedPreview,
  })
  .meta({ id: 'UpcomingSession' });

/** Computed against the server clock, hence `serverNow` — the phone must not use its own. */
export const MySessionsResponse = z
  .object({ serverNow: z.string(), items: z.array(UpcomingSession) })
  .meta({ id: 'MySessionsResponse' });

/** A class reduced to what a picker needs. */
export const ClassLite = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    subjectId: Nullable(z.string()),
    gradeLevelId: Nullable(z.string()),
    classLevelId: Nullable(z.string()),
  })
  .meta({ id: 'ClassLite' });

export const DashboardResponse = z
  .object({
    /** The server's idea of today, as `YYYY-MM-DD` (ICT, not UTC). */
    today: z.string(),
    todayEvents: z.array(EventRow),
    classes: z.array(ClassLite),
  })
  .meta({ id: 'DashboardResponse' });

/* ── Flashcards ────────────────────────────────────────────────────────────────────────────── */

export const FlashcardTopicRow = z
  .object({
    id: z.string(),
    name: z.string(),
    /** Null on topics created before migration 0011. Fall back to `id` when routing. */
    slug: Nullable(z.string()),
    description: Nullable(z.string()),
    color: z.string(),
    createdAt: Nullable(z.string()),
    wordCount: z.number().int(),
  })
  .meta({ id: 'FlashcardTopicRow' });

/** A topic without its word count — what a create call replies with. */
export const TopicInfo = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: Nullable(z.string()),
    description: Nullable(z.string()),
    color: z.string(),
  })
  .meta({ id: 'TopicInfo' });

export const FlashcardWordRow = z
  .object({
    id: z.string(),
    topicId: z.string(),
    word: z.string(),
    /** May be empty — games fall back to `definitionEn`, then the word itself. */
    meaningVi: z.string(),
    definitionEn: Nullable(z.string()),
    ipa: Nullable(z.string()),
    exampleEn: Nullable(z.string()),
    /** The exact form of the word as used in `exampleEn` (may be inflected). */
    exampleAnswer: Nullable(z.string()),
    audioUrl: Nullable(z.string()),
    /** R2 object key for the word's picture. Serve it from `/flashcard-images/:key`. */
    imageKey: Nullable(z.string()),
    createdAt: Nullable(z.string()),
  })
  .meta({ id: 'FlashcardWordRow' });

/** One completed game. Exactly one of the players is staff; `isStaff` says which. */
export const FlashcardResultRow = z
  .object({
    id: z.string(),
    playerId: z.string(),
    playerName: z.string(),
    playerColor: z.string(),
    isStaff: z.boolean(),
    topicId: z.string(),
    mode: z.string(),
    score: z.number().int(),
    total: z.number().int(),
    durationMs: Nullable(z.number().int()),
    playedAt: z.string(),
  })
  .meta({ id: 'FlashcardResultRow' });

/**
 * Per-(student, word) counters. Staff plays produce NO mastery row — a teacher testing a topic
 * must not pollute student stats — so this array is always empty for staff.
 */
export const MasteryRow = z
  .object({
    wordId: z.string(),
    correct: z.number().int(),
    wrong: z.number().int(),
    lastSeen: Nullable(z.string()),
    /** Spaced-repetition rung; see shared/logic/review.ts. */
    level: z.number().int(),
    /** ICT day the word next falls due, or null when it is out of the review cycle. */
    dueDay: Nullable(z.string()),
  })
  .meta({ id: 'MasteryRow' });

/** The whole payload for one topic. This exact object is what gets cached for offline use. */
export const TopicBundle = z
  .object({
    topic: FlashcardTopicRow,
    words: z.array(FlashcardWordRow),
    results: z.array(FlashcardResultRow),
    mastery: z.array(MasteryRow),
  })
  .meta({ id: 'TopicBundle' });

/** One student's flashcard activity, aggregated across every topic. */
export const StudentFlashcardStats = z
  .object({
    studentId: z.string(),
    rounds: z.number().int(),
    avgPct: z.number(),
    lastPlayedAt: Nullable(z.string()),
  })
  .meta({ id: 'StudentFlashcardStats' });

export const FlashcardImportResult = z
  .object({ imported: z.number().int() })
  .meta({ id: 'FlashcardImportResult' });

/* ── The garden ────────────────────────────────────────────────────────────────────────────── */

/** 0 empty soil / dead pot, 1 hạt mầm, 2 nảy mầm, 3 cây non, 4 nở hoa, 5 ra quả. */
export const PlantStage = z
  .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
  .meta({ id: 'PlantStage' });

export const FruitTitleId = z
  .enum(['gardener5', 'gardener10', 'gardener25'])
  .meta({ id: 'FruitTitleId' });

/** What the UI renders: the settled plant plus the derived bits nothing needs to store. */
export const PlantView = z
  .object({
    stage: PlantStage,
    /** Either from neglect, or from a missed assignment deadline. */
    wilted: z.boolean(),
    dead: z.boolean(),
    /** 0 when the run has lapsed, so a stale streak never shows. */
    streak: z.number().int(),
    fruitsTotal: z.number().int(),
    /** ICT days since the last care event. */
    daysIdle: z.number().int(),
    wiltStartDate: Nullable(z.string()),
    /** ICT day the next stage drop falls due, or null when dead. */
    nextDropDate: Nullable(z.string()),
    harvestReady: z.boolean(),
    /** Stages still available today under the daily cap. */
    growthLeftToday: z.number().int(),
    titleId: Nullable(FruitTitleId),
  })
  .meta({ id: 'PlantView' });

export const GardenSettings = z
  .object({
    /** Score % a round must reach to count. Assignments may set a lower bar of their own. */
    freeMinScorePct: z.number(),
    /** ICT days of no qualifying play before the plant looks wilted. */
    wiltAfterDays: z.number().int(),
    /** Further ICT days per stage drop, repeating, once wilted. */
    dropAfterDays: z.number().int(),
    /** Stages a student can gain from playing in one ICT day. Watering is exempt. */
    dailyGrowthCap: z.number().int(),
  })
  .meta({ id: 'GardenSettings' });

/** What one finished round did to the plant — the end screen's whole story. */
export const GardenOutcome = z
  .object({
    qualified: z.boolean(),
    /** False when the daily cap was already spent. */
    grew: z.boolean(),
    stage: z.number().int(),
    harvestReady: z.boolean(),
    streak: z.number().int(),
    /** The bar this round had to clear, so a near miss can be explained. */
    thresholdPct: z.number(),
  })
  .meta({ id: 'GardenOutcome' });

/** One open vocabulary assignment as the student sees it. */
export const StudentAssignmentChip = z
  .object({
    id: z.string(),
    topicId: z.string(),
    topicName: z.string(),
    topicSlug: Nullable(z.string()),
    className: z.string(),
    deadline: z.string(),
    /** ICT 'HH:MM' the deadline expires at, or null for end of day. */
    deadlineTime: Nullable(z.string()),
    requiredCount: z.number().int(),
    minScorePct: z.number(),
    questionCount: Nullable(z.number().int()).optional(),
    /** CSV of the game modes that count; null/absent = any. */
    modes: Nullable(z.string()).optional(),
    done: z.number().int(),
  })
  .meta({ id: 'StudentAssignmentChip' });

/**
 * The student's own plant, already settled by the server. `today` is the server's ICT day —
 * every date comparison the client renders measures against it, never the device clock.
 */
export const GardenPlantResponse = PlantView.extend({
  studentId: z.string(),
  today: z.string(),
  /** False when nothing has been planted yet. */
  hasPlant: z.boolean(),
  plantName: Nullable(z.string()),
  potColor: z.string(),
  /** Species id — see shared/garden-art.ts. 'classic' for a pot nothing has been planted in. */
  species: z.string(),
  /** Harvests in the current ICT month, derived from the event log. */
  fruitMonth: z.number().int(),
  assignments: z.array(StudentAssignmentChip),
  classes: z.array(z.object({ id: z.string(), name: z.string() })),
  settings: GardenSettings,
}).meta({ id: 'GardenPlantResponse' });

export const GardenMemberRow = PlantView.extend({
  studentId: z.string(),
  name: z.string(),
  color: z.string(),
  plantName: Nullable(z.string()),
  potColor: z.string(),
  /** Species id — see shared/garden-art.ts. */
  species: z.string(),
  fruitMonth: z.number().int(),
}).meta({ id: 'GardenMemberRow' });

export const ClassGardenResponse = z
  .object({
    classId: z.string(),
    className: z.string(),
    /** Ordered by name by the server. Never re-sort: this is a garden, not a leaderboard. */
    members: z.array(GardenMemberRow),
    tree: z.object({ points: z.number().int(), level: z.number().int() }),
  })
  .meta({ id: 'ClassGardenResponse' });

export const GardenSnapshotMember = z
  .object({
    studentId: z.string(),
    name: z.string(),
    color: z.string(),
    plantName: Nullable(z.string()),
    potColor: z.string(),
    /** Absent in albums frozen before species existed — read those as 'classic'. */
    species: z.string().optional(),
    stage: PlantStage,
    wilted: z.boolean(),
    dead: z.boolean(),
    streak: z.number().int(),
    fruitMonth: z.number().int(),
    fruitTotal: z.number().int(),
    titleId: Nullable(FruitTitleId),
  })
  .meta({ id: 'GardenSnapshotMember' });

export const GardenSnapshotData = z
  .object({
    members: z.array(GardenSnapshotMember),
    classTree: z.object({ level: z.number().int(), points: z.number().int() }),
  })
  .meta({ id: 'GardenSnapshotData' });

/** One frozen month of the class album. */
export const GardenSnapshotResponse = z
  .object({ className: z.string(), month: z.string(), data: GardenSnapshotData })
  .meta({ id: 'GardenSnapshotResponse' });

/** The index of saved months, returned when `?month=` is omitted. */
export const GardenSnapshotIndex = z
  .array(z.object({ month: z.string(), createdAt: z.string() }))
  .meta({ id: 'GardenSnapshotIndex' });

/**
 * Not exported, and so not emitted as a component: it never travels on its own, only folded into
 * `GardenMonthSummary` below. Its shape is still anchored — `test/api-contract.test.ts` checks
 * that summary against `GardenMonthSummary` in shared/logic/garden.ts, which extends the same
 * tally.
 */
const GardenMonthTally = z.object({
  /** Qualifying rounds played — every grow event, capped ones included. */
  playDays: z.number().int(),
  /** Distinct ICT days with a qualifying round. The habit number, not the volume one. */
  activeDays: z.number().int(),
  /** Stages actually gained (a capped play contributes 0). */
  stagesGained: z.number().int(),
  fruits: z.number().int(),
  /** Stages lost to neglect or a missed deadline. */
  setbacks: z.number().int(),
});

/** Never null: a student with nothing gets the zeroed shape. */
export const GardenMonthSummary = GardenMonthTally.extend({
  month: z.string(),
  /** The plant as it stands today, or null when the student has never planted. */
  plant: Nullable(PlantView),
  plantName: Nullable(z.string()),
  potColor: z.string(),
  /** Species id — see shared/garden-art.ts. */
  species: z.string(),
  /** Lifetime fruit, for context beside the month's own count. */
  fruitsTotal: z.number().int(),
}).meta({ id: 'GardenMonthSummary' });

export const HarvestResult = z
  .object({ ok: z.literal(true), fruitsTotal: z.number().int() })
  .meta({ id: 'HarvestResult' });

export const WaterResult = z
  .object({ studentId: z.string(), stage: z.number().int() })
  .meta({ id: 'WaterResult' });

export const AssignmentProgress = z
  .object({
    assignment: VocabAssignmentRow,
    rows: z.array(
      z.object({
        studentId: z.string(),
        name: z.string(),
        color: z.string(),
        done: z.number().int(),
      }),
    ),
  })
  .meta({ id: 'AssignmentProgress' });

/**
 * One batch of finished rounds. Correlate by `clientId`, not by position: results the server
 * had already seen are silently skipped, so `outcomes` is not positionally aligned with the
 * request. A skipped result carries `garden: null` and never grows the plant twice.
 */
export const FlashcardResultsResponse = z
  .object({
    received: z.number().int(),
    recorded: z.number().int(),
    duplicates: z.number().int(),
    outcomes: z.array(
      z.object({ clientId: Nullable(z.string()), garden: Nullable(GardenOutcome) }),
    ),
  })
  .meta({ id: 'FlashcardResultsResponse' });

/* ── Parent portal ─────────────────────────────────────────────────────────────────────────── */

/** The school-wide switch, readable by every signed-in kind. */
export const ParentPortalSettings = z
  .object({ enabled: z.boolean() })
  .meta({ id: 'ParentPortalSettings' });

export const ParentChild = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    classNames: z.array(z.string()),
    items: z.array(UpcomingSession),
  })
  .meta({ id: 'ParentChild' });

/** Every child and their week in one round trip. */
export const ParentHomeResponse = z
  .object({ serverNow: z.string(), children: z.array(ParentChild) })
  .meta({ id: 'ParentHomeResponse' });

export const ParentAttendanceResponse = z
  .object({ month: z.string(), attendance: z.array(AttendanceHistoryRow) })
  .meta({ id: 'ParentAttendanceResponse' });

export const StudentMonthAssignment = z
  .object({
    id: z.string(),
    topicName: z.string(),
    className: z.string(),
    deadline: z.string(),
    requiredCount: z.number().int(),
    done: z.number().int(),
    /** done >= requiredCount — what the slip prints as hoàn thành. */
    completed: z.boolean(),
  })
  .meta({ id: 'StudentMonthAssignment' });

export const TuiMuMonthTally = z
  .object({
    /** Ledger count, month-scoped by ICT day — the only stored quantity here. */
    bags: z.number().int(),
    misses: z.number().int(),
    fullCheckins: z.number().int(),
    /** Consecutive trailing counted sessions (date order) with a full check-in. */
    streak: z.number().int(),
    /** Sessions counted: had a check-in, the session ran, and the student was not excused. */
    sessions: z.number().int(),
  })
  .meta({ id: 'TuiMuMonthTally' });

/**
 * The same payload the printable slip renders. The phone draws only part of it; the document
 * uses the rest. `garden` and `homework` degrade to null/[] rather than failing the request.
 */
export const ParentReportResponse = z
  .object({
    month: z.string(),
    student: z.object({ id: z.string(), name: z.string() }),
    classNames: z.array(z.string()),
    /** Null when the teacher has not written this month's remark yet. */
    remark: Nullable(MonthlyRemarkRow),
    teacher: Nullable(z.string()),
    criteria: z.array(z.object({ id: z.string(), name: z.string() })),
    stats: z.object({
      average: Nullable(z.number()),
      testCount: z.number().int(),
      /** Negative behaviour type -> count, positive counts only. Excludes late/absent. */
      incidents: z.record(z.string(), z.number().int()),
      praiseCount: z.number().int(),
    }),
    scoreLines: z.array(
      z.object({
        className: Nullable(z.string()),
        subjectName: Nullable(z.string()),
        average: Nullable(z.number()),
        count: z.number().int(),
      }),
    ),
    attendance: z.array(AttendanceHistoryRow),
    homework: z.array(StudentMonthAssignment),
    /** Null unless the student was active in the garden this month. */
    garden: Nullable(
      z.object({
        activeDays: z.number().int(),
        playDays: z.number().int(),
        stagesGained: z.number().int(),
        fruits: z.number().int(),
        /** 0 unless the requested month is the running ICT month. */
        streak: z.number().int(),
      }),
    ),
    /** Null when the túi mù module is switched off. */
    tuiMu: Nullable(TuiMuMonthTally),
  })
  .meta({ id: 'ParentReportResponse' });

export const FeeLine = z
  .object({
    studentId: z.string(),
    classId: z.string(),
    className: z.string(),
    /** Billable sessions, per the settings in force. */
    sessions: z.number().int(),
    /** Billable session dates, ascending. Empty for months closed before migration 0021. */
    dates: z.array(z.string()),
    /** Every status seen, billable or not — the slip shows the breakdown. */
    statusCounts: z.record(z.string(), z.number().int()),
    unitPriceVnd: z.number().int(),
    amountVnd: z.number().int(),
  })
  .meta({ id: 'FeeLine' });

export const StudentFee = z
  .object({
    studentId: z.string(),
    lines: z.array(FeeLine),
    /** Sum of the fee lines, before the adjustment. */
    billedVnd: z.number().int(),
    adjustmentVnd: z.number().int(),
    adjustmentNote: Nullable(z.string()),
    /** What the family owes: billed + adjustment, never below zero. */
    dueVnd: z.number().int(),
    paidVnd: z.number().int(),
    paidAt: Nullable(z.string()),
    paymentNote: Nullable(z.string()),
    outstandingVnd: z.number().int(),
    status: z.enum(['unpaid', 'partial', 'paid']),
  })
  .meta({ id: 'StudentFee' });

export const ParentTuitionResponse = z
  .object({
    month: z.string(),
    student: z.object({
      id: z.string(),
      name: z.string(),
      guardian: Nullable(z.string()),
      phone: Nullable(z.string()),
    }),
    fee: StudentFee,
    closedAt: Nullable(z.string()),
    /** True once the month is explicitly closed, which freezes the amounts. */
    isClosed: z.boolean(),
  })
  .meta({ id: 'ParentTuitionResponse' });

/* ── Check-in (túi mù) ─────────────────────────────────────────────────────────────────────── */

export const CheckinTier = z
  .object({ bags: z.number().int(), label: z.string() })
  .meta({ id: 'CheckinTier' });

/**
 * Two shapes. When an admin has switched the student view off the response is just
 * `{ disabled: true }` — no month, no tally — so a client must check the flag first.
 */
export const CheckinSummary = z
  .union([
    z.object({ disabled: z.literal(true) }),
    z.object({
      disabled: z.literal(false),
      /** ICT 'YYYY-MM'. */
      month: z.string(),
      tally: TuiMuMonthTally,
      /** The highest tier the month's bags have earned, or null. */
      tier: Nullable(CheckinTier),
    }),
  ])
  .meta({ id: 'CheckinSummary' });

/* ── Event ↔ material links ────────────────────────────────────────────────────────────────── */

/**
 * `GET /api/event-materials` answers in two shapes: with `?eventId=` it is that event's material
 * ids; without, it is every link in the school.
 */
export const EventMaterialLinks = z
  .union([z.array(z.string()), z.array(z.object({ eventId: z.string(), materialId: z.string() }))])
  .meta({ id: 'EventMaterialLinks' });

/**
 * `GET /api/class-materials` answers in the same two shapes: with `?classId=` it is that class's
 * material ids; without, every link in the school. Materials are a shared library, so one id may
 * appear under several classes.
 */
export const ClassMaterialLinks = z
  .union([z.array(z.string()), z.array(z.object({ classId: z.string(), materialId: z.string() }))])
  .meta({ id: 'ClassMaterialLinks' });

/* ── Push ──────────────────────────────────────────────────────────────────────────────────── */

export const PushRunResult = z
  .object({
    job: z.enum(['class', 'digest', 'preview', 'garden']),
    /** Notifications actually dispatched. */
    sent: z.number().int(),
  })
  .meta({ id: 'PushRunResult' });

/* ── Zalo ──────────────────────────────────────────────────────────────────────────────────── */

/** One linked chat. Exactly one of the four owner columns is set. */
export const ZaloChatRow = z
  .object({
    id: z.string(),
    chatId: z.string(),
    kind: z.enum(['user', 'group']),
    accountId: Nullable(z.string()),
    parentId: Nullable(z.string()),
    studentId: Nullable(z.string()),
    classId: Nullable(z.string()),
    displayName: Nullable(z.string()),
    createdAt: z.string(),
    lastSeenAt: Nullable(z.string()),
  })
  .meta({ id: 'ZaloChatRow' });

/** A one-time pairing code. Six characters, no ambiguous glyphs, 24-hour TTL. */
export const ZaloPairCode = z
  .object({ code: z.string(), expiresAt: z.string() })
  .meta({ id: 'ZaloPairCode' });

export const ZaloPairList = z
  .object({
    links: z.array(ZaloChatRow),
    codes: z.array(
      z.object({
        code: z.string(),
        accountId: Nullable(z.string()),
        parentId: Nullable(z.string()),
        studentId: Nullable(z.string()),
        classId: Nullable(z.string()),
        expiresAt: z.string(),
      }),
    ),
  })
  .meta({ id: 'ZaloPairList' });

/** A relayed Bot API reply. Never throws: transport failures come back as `ok: false`. */
export const ZaloBotResult = z
  .object({
    ok: z.boolean(),
    result: z.unknown().optional(),
    description: z.string().optional(),
    error_code: z.number().int().optional(),
  })
  .meta({ id: 'ZaloBotResult' });

export const ZaloPollStatus = z
  .object({
    running: z.boolean(),
    startedAt: z.string(),
    lastPollAt: Nullable(z.string()),
    lastMessageAt: Nullable(z.string()),
    polls: z.number().int(),
    messages: z.number().int(),
    errors: z.number().int(),
    nextAlarm: Nullable(z.number()),
  })
  .meta({ id: 'ZaloPollStatus' });

export const ZaloSetWebhookResult = z
  .object({ url: z.string(), res: ZaloBotResult })
  .meta({ id: 'ZaloSetWebhookResult' });

export const ZaloPollStartResult = z
  .object({ ok: z.literal(true), resumed: z.boolean() })
  .meta({ id: 'ZaloPollStartResult' });

/* ── Auth acknowledgements ─────────────────────────────────────────────────────────────────── */

/**
 * Always `ok: true`, even for an address with no account — the endpoint must not confirm which
 * emails exist. `devUrl` appears only outside production, where no mail is actually sent.
 */
export const RequestResetResult = z
  .object({ ok: z.literal(true), devUrl: z.string().optional() })
  .meta({ id: 'RequestResetResult' });
