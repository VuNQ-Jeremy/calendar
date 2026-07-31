import { z } from 'zod';

/**
 * Parse a partial update payload. Zod's `.partial()` still applies `.default()`
 * values for absent keys, which would silently overwrite existing columns
 * (e.g. toggling `favorite` resetting `type` to its default). Strip any parsed
 * key that was not actually present in the raw input.
 */
export function parsePatch<S extends z.ZodObject<z.ZodRawShape>>(
  schema: S,
  raw: Record<string, unknown>,
): z.ZodSafeParseResult<Partial<z.infer<S>>> {
  const result = schema.partial().safeParse(raw);
  if (!result.success) return result as z.ZodSafeParseError<Partial<z.infer<S>>>;
  const data = Object.fromEntries(
    Object.entries(result.data as Record<string, unknown>).filter(([k]) => Object.hasOwn(raw, k)),
  ) as Partial<z.infer<S>>;
  return { success: true, data };
}

/**
 * A boolean that survives the trip through a form post. Booleans in a FormData
 * body arrive as strings, and Zod's own boolean coercion is plain JS truthiness
 * — so the string `'false'` coerces to `true`, the exact opposite of what the
 * client sent. Toggles that send `String(value)` were therefore write-only: they could
 * turn a flag on but never off. JSON bodies (the mobile API) still send real
 * booleans, which pass straight through.
 */
export const FormBool = z.preprocess((v) => {
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'false' || s === '0' || s === 'off' || s === 'no' || s === '') return false;
    return true;
  }
  if (typeof v === 'number') return v !== 0;
  return v;
}, z.boolean());

export const ColorId = z.enum(['violet', 'green', 'blue', 'orange', 'cocoa', 'rose']);

export const EventInput = z.object({
  title: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullish(),
  end: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullish(),
  color: ColorId.nullish(),
  classId: z.string().nullish(),
  location: z.string().max(200).nullish(),
  recurrence: z.enum(['none', 'daily', 'weekly']).default('none'),
  notes: z.string().max(4000).nullish(),
});
export type EventInput = z.infer<typeof EventInput>;

export const ClassInput = z.object({
  name: z.string().trim().min(1).max(200),
  subject: z.string().max(200).nullish(),
  color: ColorId.default('green'),
  studentIds: z.array(z.string()).default([]),
});
export type ClassInput = z.infer<typeof ClassInput>;

export const StudentInput = z.object({
  name: z.string().trim().min(1).max(200),
  grade: z.string().max(20).nullish(),
  guardian: z.string().max(200).nullish(),
  email: z
    .string()
    .email()
    .nullish()
    .or(z.literal('').transform(() => null)),
  color: ColorId.default('blue'),
  classIds: z.array(z.string()).default([]),
});
export type StudentInput = z.infer<typeof StudentInput>;

export const StaffInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z
    .string()
    .email()
    .nullish()
    .or(z.literal('').transform(() => null)),
  role: z.enum(['Teacher', 'Admin', 'Assistant']).default('Teacher'),
  color: ColorId.default('orange'),
  phone: z.string().max(50).nullish(),
});
export type StaffInput = z.infer<typeof StaffInput>;

export const ParentInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z
    .string()
    .email()
    .nullish()
    .or(z.literal('').transform(() => null)),
  phone: z.string().max(50).nullish(),
  color: ColorId.default('green'),
  relation: z.string().max(50).nullish(),
  studentIds: z.array(z.string()).default([]),
});
export type ParentInput = z.infer<typeof ParentInput>;

export const HomeworkInput = z.object({
  title: z.string().trim().min(1).max(200),
  classId: z.string().nullish(),
  due: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  points: z.coerce.number().int().min(0).nullish(),
  notes: z.string().max(2000).nullish(),
  color: ColorId.nullish(),
  done: FormBool.default(false),
  assessmentTypeId: z.string().nullish(),
});
export type HomeworkInput = z.infer<typeof HomeworkInput>;

export const MaterialInput = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.enum(['notes', 'worksheet', 'video', 'link', 'curriculum']).default('notes'),
  classId: z.string().nullish(),
  url: z.string().max(2000).nullish(),
  fileName: z.string().max(500).nullish(),
  favorite: FormBool.default(false),
  addedAt: z.string().nullish(),
  scope: z.enum(['class', 'event']).default('class'),
});
export type MaterialInput = z.infer<typeof MaterialInput>;

export const InviteInput = z.object({
  code: z.string().min(7).max(7),
  role: z.enum(['Student', 'Staff', 'Parent']),
  name: z.string().max(200).nullish(),
  classId: z.string().nullish(),
  createdAt: z.string().nullish(),
  used: FormBool.default(false),
});
export type InviteInput = z.infer<typeof InviteInput>;

export const FeedbackInput = z.object({
  message: z.string().trim().min(1).max(5000),
  category: z.enum(['idea', 'bug', 'praise', 'other']).default('idea'),
  author: z.string().max(200).nullish(),
  status: z.enum(['new', 'reviewed', 'done']).default('new'),
  createdAt: z.string().nullish(),
  /** Which build the report came from, e.g. "v0.0042 · a1b2c3d". Nullish: older clients omit it. */
  appVersion: z.string().max(100).nullish(),
});
export type FeedbackInput = z.infer<typeof FeedbackInput>;

export const BehaviorType = z.enum([
  'late',
  'absent',
  'missing_homework',
  'disruptive',
  'praise',
  'other',
]);
export type BehaviorType = z.infer<typeof BehaviorType>;

export const ScoreRecordInput = z.object({
  studentId: z.string().min(1),
  classId: z.string().nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  score: z.coerce.number().min(0).max(10),
  assessmentTypeId: z.string().nullish(),
  notes: z.string().max(2000).nullish(),
});
export type ScoreRecordInput = z.infer<typeof ScoreRecordInput>;

export const AssessmentTypeInput = z.object({
  name: z.string().trim().min(1).max(100),
  active: FormBool.default(true),
  sortOrder: z.coerce.number().int().nullish(),
});
export type AssessmentTypeInput = z.infer<typeof AssessmentTypeInput>;

export const AssessmentTypeReorder = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type AssessmentTypeReorder = z.infer<typeof AssessmentTypeReorder>;

export const AttendanceStatus = z.enum(['present', 'absent', 'late', 'excused']);
export type AttendanceStatus = z.infer<typeof AttendanceStatus>;

export const AttendanceSaveInput = z.object({
  eventId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  records: z.array(z.object({ studentId: z.string().min(1), status: AttendanceStatus })),
});
export type AttendanceSaveInput = z.infer<typeof AttendanceSaveInput>;

export const EventMaterialsSaveInput = z.object({
  eventId: z.string().min(1),
  materialIds: z.array(z.string().min(1)),
});
export type EventMaterialsSaveInput = z.infer<typeof EventMaterialsSaveInput>;

export const HomeworkGradesSaveInput = z.object({
  homeworkId: z.string().min(1),
  records: z.array(
    z.object({
      studentId: z.string().min(1),
      score: z.number().min(0).max(10).nullish(),
      comment: z.string().max(2000).nullish(),
    }),
  ),
});
export type HomeworkGradesSaveInput = z.infer<typeof HomeworkGradesSaveInput>;

export const BehaviorRecordInput = z.object({
  studentId: z.string().min(1),
  classId: z.string().nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: BehaviorType,
  notes: z.string().max(2000).nullish(),
});
export type BehaviorRecordInput = z.infer<typeof BehaviorRecordInput>;

export const FlashcardTopicInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).nullish(),
  color: ColorId.default('violet'),
});
export type FlashcardTopicInput = z.infer<typeof FlashcardTopicInput>;

export const FlashcardWordInput = z.object({
  word: z.string().trim().min(1).max(100),
  // Optional: the English definition auto-fills, so a manual Vietnamese meaning
  // is not required. Games fall back to the definition when this is blank.
  meaningVi: z.string().trim().max(500).default(''),
  definitionEn: z.string().max(1000).nullish(),
  ipa: z.string().max(200).nullish(),
  audioUrl: z.string().max(2000).nullish(),
});
export type FlashcardWordInput = z.infer<typeof FlashcardWordInput>;

export const FlashcardImportInput = z.object({
  words: z.array(FlashcardWordInput).min(1).max(200),
});
export type FlashcardImportInput = z.infer<typeof FlashcardImportInput>;

/** A new topic plus its first words — what the AI generator saves in one call. */
export const FlashcardTopicWithWordsInput = FlashcardTopicInput.extend({
  words: z.array(FlashcardWordInput).min(1).max(200),
});
export type FlashcardTopicWithWordsInput = z.infer<typeof FlashcardTopicWithWordsInput>;

/**
 * One word to enrich. `definitionEn`, when present, is a sense hint the author already typed —
 * the model glosses the word in THAT sense instead of guessing the most common one.
 */
export const VocabEnrichItem = z.object({
  word: z.string().trim().min(1).max(100),
  definitionEn: z.string().max(1000).nullish(),
});
export type VocabEnrichItem = z.infer<typeof VocabEnrichItem>;

export const VocabEnrichInput = z.object({
  items: z.array(VocabEnrichItem).min(1).max(200),
});
export type VocabEnrichInput = z.infer<typeof VocabEnrichInput>;

/**
 * One enriched row: everything a flashcard needs except the word's own spelling, which the caller
 * already had. Same field set as GeneratedWord — `audioUrl` is the one card field the model cannot
 * supply, so AI-filled cards are pronounced by text-to-speech.
 */
export type EnrichedWord = {
  word: string;
  meaningVi: string;
  definitionEn: string | null;
  ipa: string | null;
};

export const VocabLevel = z.enum(['beginner', 'intermediate', 'advanced']);
export type VocabLevel = z.infer<typeof VocabLevel>;

export const VocabGenerateInput = z.object({
  // Usually one of VOCAB_TOPICS (shared/logic/vocab-topics.ts) by English name, but free text
  // is accepted — the curated catalog is a UI concern only.
  topic: z.string().trim().min(1).max(200),
  count: z.coerce.number().int().min(1).max(50).default(20),
  /** Null/omitted means mixed levels. */
  level: VocabLevel.nullish(),
  /** Words already in the deck, so the model does not repeat them. Matched case-insensitively. */
  exclude: z.array(z.string().trim().min(1).max(100)).max(500).default([]),
});
export type VocabGenerateInput = z.infer<typeof VocabGenerateInput>;

/**
 * One generated row — a subset of FlashcardWordInput, so the review UI can hand rows straight
 * to the existing import pipeline. `audioUrl` is the one card field the model cannot supply.
 */
export type GeneratedWord = {
  word: string;
  meaningVi: string;
  definitionEn: string | null;
  ipa: string | null;
};

export const FlashcardMode = z.enum(['flip', 'quiz', 'match']);
export type FlashcardMode = z.infer<typeof FlashcardMode>;

export const FlashcardResultInput = z.object({
  /**
   * Device-generated UUID, sent by the mobile offline outbox so a replayed flush is a no-op.
   * Optional: the web path omits it and is unaffected.
   */
  clientId: z.string().uuid().optional(),
  topicId: z.string().min(1),
  mode: FlashcardMode,
  score: z.coerce.number().int().min(0),
  total: z.coerce.number().int().min(1),
  durationMs: z.coerce.number().int().min(0).nullish(),
  answers: z
    .array(z.object({ wordId: z.string().min(1), correct: z.boolean() }))
    .max(500)
    .default([]),
});
export type FlashcardResultInput = z.infer<typeof FlashcardResultInput>;

/** Batch envelope for the mobile offline outbox flush. */
export const FlashcardResultBatch = z.object({
  results: z.array(FlashcardResultInput).min(1).max(50),
});
export type FlashcardResultBatch = z.infer<typeof FlashcardResultBatch>;

export const PushRegisterInput = z.object({
  expoToken: z.string().min(1).max(500),
  platform: z.enum(['android', 'ios']).default('android'),
});
export type PushRegisterInput = z.infer<typeof PushRegisterInput>;

export const LoginInput = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const RedeemInviteInput = z.object({
  code: z.string().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  email: z.string().max(320).optional(),
  password: z.string().min(6).max(200),
});
export type RedeemInviteInput = z.infer<typeof RedeemInviteInput>;

export const ChangePasswordInput = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(6).max(200),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

export const RequestResetInput = z.object({
  email: z.string().min(1).max(320),
});
export type RequestResetInput = z.infer<typeof RequestResetInput>;

/** Self-service profile edit. Deliberately narrower than StaffInput — no role, no id. */
export const ProfileInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z
    .string()
    .email()
    .nullish()
    .or(z.literal('').transform(() => null)),
  phone: z.string().max(50).nullish(),
  color: ColorId,
});
export type ProfileInput = z.infer<typeof ProfileInput>;

export const ThemeInput = z.object({
  bg: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullish(),
  gridLine: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullish(),
  today: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullish(),
  header: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullish(),
  bgImage: z.string().nullish(),
  bgOpacity: z.coerce.number().min(0).max(1).nullish(),
});
export type ThemeInput = z.infer<typeof ThemeInput>;

export const SCROLLBAR_STYLES = ['slim', 'inset', 'brand', 'ghost'] as const;
export type ScrollbarStyle = (typeof SCROLLBAR_STYLES)[number];

/**
 * How the phone's bottom tab bar looks. The mirror image of `SCROLLBAR_STYLES`: that one is
 * meaningless on Android, this one is meaningless on the web — the web shell has a sidebar, not
 * a tab bar. Both live in `ui-prefs` anyway, because one settings row per client would mean two
 * places to look for "how does this school's UI behave".
 *
 * The variants are rendered by mobile/components/TabBar.tsx; these ids are its `variant` prop.
 */
export const TAB_BAR_STYLES = ['pill', 'dock', 'indicator'] as const;
export type TabBarStyle = (typeof TAB_BAR_STYLES)[number];

export const UiPrefsInput = z.object({
  scrollbar: z.enum(SCROLLBAR_STYLES).optional(),
  mobileTabBar: z.enum(TAB_BAR_STYLES).optional(),
});
export type UiPrefsInput = z.infer<typeof UiPrefsInput>;

/**
 * What the cron jobs are allowed to send.
 *
 * `classLeadMinutes` is capped at 120 and floored at 15 because the class sweep runs every 15
 * minutes: a 5-minute lead cannot be honoured, and pretending otherwise would silently drop
 * reminders rather than send them late.
 */
export const NotifPrefsInput = z.object({
  classReminders: FormBool.default(true),
  classLeadMinutes: z.coerce.number().int().min(15).max(120).default(30),
  homeworkReminders: FormBool.default(true),
  studyNudges: FormBool.default(false),
});
export type NotifPrefsInput = z.infer<typeof NotifPrefsInput>;
