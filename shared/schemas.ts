import { z } from 'zod';
import {
  isValidModesCsv,
  normalizeModesCsv,
  PRONOUNCE_CURVES,
  type PronounceCurve,
} from './logic/flashcards';
import { isValidRangesCsv, normalizeRangesCsv } from './logic/vocab-batches';

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

/**
 * Which occurrences an edit or delete of a recurring event applies to. Not part of EventInput —
 * it names an operation, not a column, and pairs with an `occurrenceDate` form field. 'all' is
 * the default and the pre-scope behavior: the whole series moves or goes.
 */
export const EventEditScope = z.enum(['single', 'following', 'all']);
export type EventEditScope = z.infer<typeof EventEditScope>;

export const ClassInput = z.object({
  name: z.string().trim().min(1).max(200),
  /**
   * LEGACY free text. Kept only so an older mobile build can still save a class: the service
   * resolves it to a `subjects` row by name and never writes the column. New clients send
   * `subjectId`, which wins when both are present.
   */
  subject: z.string().max(200).nullish(),
  subjectId: z.string().nullish(),
  color: ColorId.default('green'),
  /**
   * Competition cohort (khối, trình độ). Nullish, NOT required: the mobile app posts this same
   * schema through /api/classes and older builds never send them. The web form requires both.
   */
  gradeLevelId: z.string().nullish(),
  classLevelId: z.string().nullish(),
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

/**
 * Creating a student from the People screen, where the parent is entered inline and
 * becomes a real `parents` row linked through `parent_students` — not the legacy
 * free-text `guardian` column, which the web form no longer offers.
 *
 * Web-only: `/api/students` still takes plain StudentInput, so shipped mobile builds
 * (which post `guardian`) are unaffected.
 */
export const StudentCreateInput = StudentInput.extend({
  /** An existing parent to link — a sibling's mother, say. Wins over the fields below. */
  parentId: z.string().nullish(),
  parentName: z.string().trim().max(200).nullish(),
  parentRelation: z.string().max(50).nullish(),
  parentPhone: z.string().max(50).nullish(),
});
export type StudentCreateInput = z.infer<typeof StudentCreateInput>;

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

/**
 * A material is library content only — a title, a kind, and either a file or a link. Which
 * classes and events carry it is not part of this input: those are the `class_materials` and
 * `event_materials` joins, written from the class page and the event dialog.
 */
export const MaterialInput = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.enum(['notes', 'worksheet', 'video', 'link', 'curriculum']).default('notes'),
  url: z.string().max(2000).nullish(),
  fileName: z.string().max(500).nullish(),
  favorite: FormBool.default(false),
  addedAt: z.string().nullish(),
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
  /**
   * Server-assigned, and ignored on write — `services/feedback.create` always stamps its own
   * ISO timestamp. It stays on the input schema because the API *returns* it and mobile derives
   * `FeedbackRow` from this schema (see mobile/lib/types.ts).
   */
  createdAt: z.string().nullish(),
  /** Which build the report came from, e.g. "v0.0042 · a1b2c3d". Nullish: older clients omit it. */
  appVersion: z.string().max(100).nullish(),
  /**
   * The short handle the board shows as "F-12" — server-assigned on insert and ignored on write,
   * like `createdAt`. Nullish only for rows written before migration 0041 backfilled it.
   */
  ref: z.coerce.number().int().nullish(),
  /**
   * The GitHub issue opened for this report, filled in after the fact: the issue is created in a
   * `waitUntil` and the number only exists once GitHub answers. Null when the integration was off,
   * when it failed, or for rows that predate it.
   */
  issueNumber: z.coerce.number().int().nullish(),
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

/**
 * "Preview buổi sau" for one occurrence. `date` identifies the occurrence, not the series — the
 * same (eventId, date) addressing AttendanceSaveInput uses.
 */
export const SessionPreviewInput = z.object({
  eventId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  focusText: z.string().max(2000).default(''),
  vocabTopicId: z.string().nullish(),
  /** "Bài tập về nhà" for this session — becomes the check-in homework square. */
  homeworkText: z.string().max(2000).default(''),
});
export type SessionPreviewInput = z.infer<typeof SessionPreviewInput>;

export const EventMaterialsSaveInput = z.object({
  eventId: z.string().min(1),
  materialIds: z.array(z.string().min(1)),
});
export type EventMaterialsSaveInput = z.infer<typeof EventMaterialsSaveInput>;

/** Replace-set, same as the event twin: the submitted list becomes the class's whole set. */
export const ClassMaterialsSaveInput = z.object({
  classId: z.string().min(1),
  materialIds: z.array(z.string().min(1)),
});
export type ClassMaterialsSaveInput = z.infer<typeof ClassMaterialsSaveInput>;

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

/**
 * An R2 key for a stored flashcard image: `flashcards/<uuid v4>.<jpg|png|webp>`. Both the word
 * input and the serving route validate against this shape — see 0033_flashcard_word_images.sql
 * for why images are addressed by key rather than by URL.
 */
export const FlashcardImageKey = z
  .string()
  .regex(
    /^flashcards\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/,
  );
export type FlashcardImageKey = z.infer<typeof FlashcardImageKey>;

export const FlashcardWordInput = z.object({
  word: z.string().trim().min(1).max(100),
  // Optional: the English definition auto-fills, so a manual Vietnamese meaning
  // is not required. Games fall back to the definition when this is blank.
  meaningVi: z.string().trim().max(500).default(''),
  definitionEn: z.string().max(1000).nullish(),
  ipa: z.string().max(200).nullish(),
  /** 'n', 'adj', 'phr.v' … as printed in the source textbook. Free text, deliberately not an enum. */
  partOfSpeech: z.string().trim().max(20).nullish(),
  exampleEn: z.string().max(300).nullish(),
  exampleAnswer: z.string().max(100).nullish(),
  audioUrl: z.string().max(2000).nullish(),
  // An R2 object key minted by /vocab-image-generate or /vocab-image-commit, never a
  // client-chosen string. Shape-checking it here means a crafted value cannot address another
  // prefix of the bucket (materials/, zalo/) even before the serving route's own guard, and a
  // cleared picker — which arrives as '' from a form, not as a missing key — becomes null.
  imageKey: FlashcardImageKey.nullish().or(z.literal('').transform(() => null)),
  /**
   * Global semantic tags (`vocab_topics.id`) — Food, Travel, Environment. Five is plenty for one
   * word and keeps the junction insert inside a single statement.
   *
   * Accepts a real array (JSON clients) or a comma-separated string (the web form). Ids the catalog
   * does not know are dropped in the service rather than rejected here: a CSV import with one typo'd
   * tag must still land its word.
   */
  topicIds: z
    .union([z.array(z.string()), z.string()])
    .nullish()
    .transform((v) => {
      if (v == null) return [];
      const list = typeof v === 'string' ? v.split(',') : v;
      return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
    })
    .pipe(z.array(z.string().min(1).max(60)).max(5)),
});
export type FlashcardWordInput = z.infer<typeof FlashcardWordInput>;

// ---- PvP vocab battles (F33/F34) ----

export const PvpRoomInput = z.object({
  slug: z.string().min(1),
  roundSize: z.number().int().min(4).max(20).optional(),
  secondsPerQuestion: z.number().int().min(5).max(60).optional(),
});
export type PvpRoomInput = z.infer<typeof PvpRoomInput>;

/** A finished tabletop face-off duel or race, posted once by staff to record it on the ladder. */
export const FaceoffResultInput = z.object({
  // Defaulted, not required: a tablet still running the pre-deploy bundle posts no `mode` at
  // all. Without a default the route 400s, the screen never inspects the result (it has already
  // set `posted.current = true`), and the finished match vanishes with no signal. Defaulting to
  // the duel mode records it as what an old client's result always was.
  mode: z.enum(['quiz-faceoff', 'quiz-race']).default('quiz-faceoff'),
  topicId: z.string().min(1),
  winnerStudentId: z.string().min(1),
  loserStudentId: z.string().min(1),
  winnerScore: z.number().int().min(0),
  loserScore: z.number().int().min(0),
  total: z.number().int().min(1),
});
export type FaceoffResultInput = z.infer<typeof FaceoffResultInput>;

export const FlashcardImportInput = z.object({
  words: z.array(FlashcardWordInput).min(1).max(200),
});
export type FlashcardImportInput = z.infer<typeof FlashcardImportInput>;

/**
 * A book a grade is taught from. `gradeLevelId` is nullish because a curriculum can be filed before
 * anyone decides which khối it belongs to, and because `grade_levels` rows can be deleted
 * (ON DELETE SET NULL).
 */
export const VocabCurriculumInput = z.object({
  name: z.string().trim().min(1).max(200),
  gradeLevelId: z
    .string()
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v)),
  publisher: z.string().trim().max(200).nullish(),
  description: z.string().max(1000).nullish(),
  active: FormBool.default(true),
  sortOrder: z.coerce.number().int().nullish(),
});
export type VocabCurriculumInput = z.infer<typeof VocabCurriculumInput>;

/**
 * File a deck as unit N of a curriculum, or unfile it. Both fields clear together: a unit number
 * without a curriculum means nothing, so `curriculumId: null` drops `unitNo` too in the service.
 */
export const VocabUnitInput = z.object({
  curriculumId: z
    .string()
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v)),
  unitNo: z.coerce.number().int().min(1).max(200).nullish(),
});
export type VocabUnitInput = z.infer<typeof VocabUnitInput>;

/** One unit of a workbook import: its number, its title, and the words parsed out of its table. */
export const VocabImportUnit = z.object({
  unitNo: z.coerce.number().int().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  words: z.array(FlashcardWordInput).min(1).max(200),
});
export type VocabImportUnit = z.infer<typeof VocabImportUnit>;

/**
 * A whole book in one request. The per-unit 200-word cap is the one `FlashcardImportInput` already
 * uses, so both import paths agree; 20 units bounds the request. The English 9 Global Success book
 * is 6 units and ~451 words, so both leave room.
 */
export const VocabImportInput = z.object({
  curriculumId: z.string().min(1),
  units: z.array(VocabImportUnit).min(1).max(20),
});
export type VocabImportInput = z.infer<typeof VocabImportInput>;

/** Backfill payload for the "Generate sentences" button: per-word example fields only. */
export const FlashcardExampleFillInput = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        exampleEn: z.string().trim().min(1).max(300),
        exampleAnswer: z.string().trim().min(1).max(100),
      }),
    )
    .min(1)
    .max(200),
});
export type FlashcardExampleFillInput = z.infer<typeof FlashcardExampleFillInput>;

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

/**
 * Which model tier fills the fields in.
 *
 * A tier name rather than a model id: the id stays server-side (a client must not be able to name
 * an arbitrary model, and swapping ids should not be a client change).
 *
 * `fast` is the interactive default — the word dialog's debounced auto-fill and the paste importer,
 * where latency is felt and a teacher reviews every row before saving. `best` is for bulk backfills
 * of material that ships as-is: ~15x the cost per word, so it is opt-in per request, never a default.
 */
export const VocabEnrichQuality = z.enum(['fast', 'best']);
export type VocabEnrichQuality = z.infer<typeof VocabEnrichQuality>;

export const VocabEnrichInput = z.object({
  items: z.array(VocabEnrichItem).min(1).max(200),
  quality: VocabEnrichQuality.default('fast'),
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
  exampleEn: string | null;
  exampleAnswer: string | null;
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
 *
 * `imageQuery` is not a card field: it is stock-photo search keywords the model proposes so the
 * review screen can pre-fetch a candidate picture per word. Null when the model omitted it or on
 * rows from paths that don't generate one (enrich, manual entry) — callers fall back to the word.
 */
export type GeneratedWord = {
  word: string;
  meaningVi: string;
  definitionEn: string | null;
  ipa: string | null;
  exampleEn: string | null;
  exampleAnswer: string | null;
  imageQuery: string | null;
};

// ---- Vocabulary word images ----
// Three staff-only routes: search proposes candidates, generate draws one with Workers AI, and
// commit copies a chosen stock photo into R2. Only the latter two mint an `imageKey`.

/**
 * Where a stock candidate came from. Openverse is the default because it needs no API key and its
 * CC0/public-domain slice needs no attribution; Pixabay is used when PIXABAY_API_KEY is set and
 * its API answers (it sits behind a bot check that can reject server traffic).
 */
export const VocabImageProvider = z.enum(['openverse', 'pixabay']);
export type VocabImageProvider = z.infer<typeof VocabImageProvider>;

/**
 * The deepest result page the picker will ask for. The retry button wraps back to page 1 when it
 * gets here — walking past it used to hit this schema's own cap as a 400, which the picker showed
 * as "could not load pictures" and could never recover from, since the page number only ever grew.
 */
export const VOCAB_IMAGE_MAX_PAGE = 20;

export const VocabImageSearchInput = z.object({
  query: z.string().trim().min(1).max(200),
  /**
   * Which batch of results to return. The picker's retry button walks this forward to show a
   * different set for the same phrase, wrapping at VOCAB_IMAGE_MAX_PAGE; past the last REAL page
   * the providers return nothing, which the caller also reads as "wrap back to 1".
   */
  page: z.coerce.number().int().min(1).max(VOCAB_IMAGE_MAX_PAGE).default(1),
});
export type VocabImageSearchInput = z.infer<typeof VocabImageSearchInput>;

export const VocabImageGenerateInput = z.object({
  prompt: z.string().trim().min(1).max(300),
});
export type VocabImageGenerateInput = z.infer<typeof VocabImageGenerateInput>;

/**
 * Commit takes a provider + that provider's own id — never a URL. The server asks the provider
 * for the image's location, so the address it fetches is chosen by the provider rather than by
 * the caller, and there is no client-controlled fetch target to abuse.
 */
export const VocabImageCommitInput = z.object({
  provider: VocabImageProvider,
  id: z.string().trim().min(1).max(100),
});
export type VocabImageCommitInput = z.infer<typeof VocabImageCommitInput>;

/** One stock candidate in the picker. `thumbUrl` is display-only; commit re-resolves by id. */
export type VocabImageCandidate = {
  provider: VocabImageProvider;
  id: string;
  thumbUrl: string;
  credit: string;
};

export const FlashcardMode = z.enum([
  'flip',
  'quiz',
  'match',
  'scramble',
  'fill',
  'type',
  'picture',
  'ipa',
  'stress',
  'cloze',
  'listen',
  'pronounce',
  'mix',
]);
export type FlashcardMode = z.infer<typeof FlashcardMode>;

/** One sound of the IPA breakdown, scored on its own (PhonemeAlphabet: 'IPA'). */
export type PronouncePhoneme = {
  /** A single IPA symbol, e.g. 'ɪ'. */
  ipa: string;
  /** 0-100; colour tiers live in phonemeTier (logic/flashcards.ts). */
  accuracy: number;
};

/**
 * One syllable group with its own score (Azure emits these for en-US only). The phonemes are
 * the slice of the word's phonemes that fall inside this syllable, matched by audio offset on
 * the server — so a client can render the word syllable-by-syllable without re-deriving it.
 */
export type PronounceSyllable = {
  /** The syllable's IPA, e.g. 'bə'. */
  ipa: string;
  /** 0-100, aggregated by Azure from the syllable's phonemes. */
  accuracy: number;
  phonemes: PronouncePhoneme[];
};

/** One word of the reference (or an extra one the student inserted), with its phonemes. */
export type PronounceWord = {
  word: string;
  /** Azure's miscue tag. 'Insertion' entries are words the student added — no reference IPA. */
  errorType: 'None' | 'Omission' | 'Insertion' | 'Mispronunciation';
  accuracy: number;
  phonemes: PronouncePhoneme[];
  /**
   * Syllable groups, empty when Azure sent none (non-en-US would). Appended after phonemes so a
   * mobile build older than this field simply ignores it — read it as `syllables ?? []`.
   */
  syllables?: PronounceSyllable[];
};

/**
 * What /speech-assess returns inside `{ data }` — the Worker's mapping of Azure's
 * pronunciation assessment (server/services/speech.ts). Both game clients type against this.
 */
export type PronounceAssessment = {
  /** 0-100; drives correctness (see PRONOUNCE_PASS in logic/flashcards.ts). */
  accuracy: number;
  fluency: number;
  completeness: number;
  /** Azure's blended overall score. */
  pronScore: number;
  /** The words Azure actually heard (lowercased), for the "we heard …" line. */
  recognized: string;
  correct: boolean;
  /** True when Azure heard silence or noise — offer a re-record, don't grade. */
  noSpeech: boolean;
  /**
   * Per-word IPA breakdown, empty when noSpeech. Added after the flat scores, so a mobile
   * build older than this field simply ignores it — read it as `words ?? []`.
   */
  words: PronounceWord[];
  /**
   * The forgiveness curve that was active when this clip was scored (/config → Pronounce
   * scoring). Every number in this DTO is RAW; clients apply `forgiveScore(raw, curve)` to
   * what the kid sees (big %, colour tiers) while the details drawer shows the raw numbers.
   * `correct` is already decided server-side on the forgiven accuracy. Optional so a mobile
   * build older than this field keeps working — read it as `curve ?? 'off'`.
   */
  curve?: PronounceCurve;
};

/** /config → Pronounce scoring: which forgiveness curve the pronounce game applies. */
export const PronounceSettingsInput = z.object({
  curve: z.enum(PRONOUNCE_CURVES),
});
export type PronounceSettingsInput = z.infer<typeof PronounceSettingsInput>;

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

/**
 * Ask for a Zalo pairing code. `self` needs no id — it is the caller's own account; the other
 * two name somebody who cannot ask for themselves, which is the whole reason this is staff-only.
 */
export const ZaloPairInput = z
  .object({
    /**
     * `parent` and `student` are both a family, kept separate on purpose: a parent record can
     * cover several children, while a student link needs no parent record — which is most of
     * them. See migrations/0028.
     */
    target: z.enum(['self', 'parent', 'student', 'class']),
    parentId: z.string().min(1).optional(),
    studentId: z.string().min(1).optional(),
    classId: z.string().min(1).optional(),
  })
  .refine((v) => v.target !== 'parent' || !!v.parentId, {
    message: 'parentId is required when target is parent',
    path: ['parentId'],
  })
  .refine((v) => v.target !== 'student' || !!v.studentId, {
    message: 'studentId is required when target is student',
    path: ['studentId'],
  })
  .refine((v) => v.target !== 'class' || !!v.classId, {
    message: 'classId is required when target is class',
    path: ['classId'],
  });
export type ZaloPairInput = z.infer<typeof ZaloPairInput>;

/**
 * The rule for SETTING a password — invite redemption, self-serve reset, change-password.
 *
 * Deliberately NOT used by LoginInput: that validates a password being *presented*, and
 * tightening it there would lock out any account created before this floor existed.
 */
export const NewPassword = z.string().min(8).max(200);

export const LoginInput = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginInput>;

/**
 * `password` is optional and `phone` new: a student/parent invite may be redeemed passwordless,
 * using a Zalo-reachable phone instead — `redeemInvite` enforces "at least one working method"
 * server-side (a valid password, OR a phone with a reachable Zalo chat). Staff invites still
 * require a password; the service, not this schema, knows which invites are staff-linked.
 */
export const RedeemInviteInput = z.object({
  code: z.string().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  email: z.string().max(320).optional(),
  password: NewPassword.optional(),
  phone: z.string().max(24).optional(),
});
export type RedeemInviteInput = z.infer<typeof RedeemInviteInput>;

/**
 * `currentPassword` may be empty: a passwordless (Zalo-only) account is SETTING its first
 * password, not changing one, and `changePassword` skips the current-password check entirely for
 * that case (server/services/auth.ts). An account that already has a real password still gets
 * refused with `wrong_current_password` if this is blank, same as any other wrong value.
 */
export const ChangePasswordInput = z.object({
  currentPassword: z.string().max(200),
  newPassword: NewPassword,
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

export const RequestResetInput = z.object({
  email: z.string().min(1).max(320),
});
export type RequestResetInput = z.infer<typeof RequestResetInput>;

/**
 * Zalo OTP login/recovery. `phone` is un-normalized user input (normalizePhone runs server-side);
 * the loose bounds just keep a pasted essay or an empty body from reaching the service.
 */
export const OtpPurpose = z.enum(['login', 'set-password']);
export type OtpPurpose = z.infer<typeof OtpPurpose>;

export const OtpRequestInput = z.object({
  phone: z.string().min(1).max(24),
  purpose: OtpPurpose.default('login'),
});
export type OtpRequestInput = z.infer<typeof OtpRequestInput>;

export const OtpSetPasswordInput = z.object({
  challengeId: z.string().min(1).max(100),
  accountId: z.string().min(1),
  newPassword: NewPassword,
});
export type OtpSetPasswordInput = z.infer<typeof OtpSetPasswordInput>;

export const OtpVerifyInput = z.object({
  challengeId: z.string().min(1).max(100),
  code: z.string().regex(/^\d{6}$/, 'Expected a 6-digit code'),
});
export type OtpVerifyInput = z.infer<typeof OtpVerifyInput>;

export const OtpPickInput = z.object({
  challengeId: z.string().min(1).max(100),
  accountId: z.string().min(1),
});
export type OtpPickInput = z.infer<typeof OtpPickInput>;

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

/**
 * The web calendar's four view modes. Mobile's calendar has no week view, so its own enum stays
 * separate — this one names what `src/calendar/index.tsx` can actually render.
 */
export const CALENDAR_VIEWS = ['day', 'week', 'month', 'agenda'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

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
  defaultView: z.enum(CALENDAR_VIEWS).nullish(),
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

/**
 * How a deck reads in the /vocabulary grid — where its colour goes, now that the colour is the
 * card rather than a 12px dot beside the title.
 *
 * `band` a colour bar across the top of the card holding the title; `full` the whole card in the
 * colour; `tint` the whole card in the pale soft shade. Web-only for now: these are ids the
 * `html[data-vocab-card]` rules in src/styles/app.css key off, and the phone's vocabulary screen
 * does not read them. It receives the key regardless (the schemas here are non-strict) rather
 * than 400ing on it, which is what keeps an older app build working against a newer server.
 *
 * `band` is the default because it is the only one of the three that leaves the rest of the card
 * alone: `full` needs white inks for the description and the staff icons, since --text-muted grey
 * does not survive a mid-tone background.
 */
export const VOCAB_CARD_STYLES = ['band', 'full', 'tint'] as const;
export type VocabCardStyle = (typeof VOCAB_CARD_STYLES)[number];

export const UiPrefsInput = z.object({
  scrollbar: z.enum(SCROLLBAR_STYLES).optional(),
  mobileTabBar: z.enum(TAB_BAR_STYLES).optional(),
  vocabCard: z.enum(VOCAB_CARD_STYLES).optional(),
});
export type UiPrefsInput = z.infer<typeof UiPrefsInput>;

/**
 * What the cron jobs are allowed to send.
 *
 * `classLeadMinutes` is capped at 120 and floored at 15 because the class sweep runs every 15
 * minutes: a 5-minute lead cannot be honoured, and pretending otherwise would silently drop
 * reminders rather than send them late.
 */
// `homeworkReminders` went away with the homework feature. Zod objects here are non-strict, so a
// stale mobile build still posting that key is ignored rather than rejected.
export const NotifPrefsInput = z.object({
  classReminders: FormBool.default(true),
  classLeadMinutes: z.coerce.number().int().min(15).max(120).default(30),
  studyNudges: FormBool.default(false),
  /** The evening "here is tomorrow's session" push. On by default: it is the point of previews. */
  previewEvening: FormBool.default(true),
  /**
   * "Your plant is wilting" / "it drops a stage tomorrow". On by default: a garden nobody is told
   * about is a garden that quietly dies, which is the opposite of the point.
   */
  gardenAlerts: FormBool.default(true),
});
export type NotifPrefsInput = z.infer<typeof NotifPrefsInput>;

/**
 * Whether a signed-in parent sees the children screens. Off by default: the portal ships dark
 * and an admin opens it. Never gates login — a parent can always reach /profile.
 */
export const ParentPortalInput = z.object({
  enabled: FormBool.default(false),
});
export type ParentPortalInput = z.infer<typeof ParentPortalInput>;

/* ── Tests module: grade levels, question bank, tests, attempts ─────────────────────────── */

export const GradeLevelInput = z.object({
  name: z.string().trim().min(1).max(100),
  active: FormBool.default(true),
  sortOrder: z.coerce.number().int().nullish(),
});
export type GradeLevelInput = z.infer<typeof GradeLevelInput>;

export const GradeLevelReorder = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type GradeLevelReorder = z.infer<typeof GradeLevelReorder>;

/** Môn học — the managed enum a class's subject is picked from. */
export const SubjectInput = z.object({
  name: z.string().trim().min(1).max(100),
  active: FormBool.default(true),
  sortOrder: z.coerce.number().int().nullish(),
});
export type SubjectInput = z.infer<typeof SubjectInput>;

export const SubjectReorder = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type SubjectReorder = z.infer<typeof SubjectReorder>;

/** Trình độ — the managed enum pairing with grade level to form a class's ranking cohort. */
export const ClassLevelInput = z.object({
  name: z.string().trim().min(1).max(100),
  active: FormBool.default(true),
  sortOrder: z.coerce.number().int().nullish(),
});
export type ClassLevelInput = z.infer<typeof ClassLevelInput>;

export const ClassLevelReorder = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type ClassLevelReorder = z.infer<typeof ClassLevelReorder>;

export const QuestionType = z.enum(['mcq', 'multi', 'text', 'essay']);
export type QuestionType = z.infer<typeof QuestionType>;

export const QuestionDifficulty = z.enum(['easy', 'medium', 'hard']);
export type QuestionDifficulty = z.infer<typeof QuestionDifficulty>;

export const QuestionOption = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1).max(500),
});
export type QuestionOption = z.infer<typeof QuestionOption>;

/**
 * The field shape of a question, WITHOUT the per-type answer-key rules.
 *
 * Two schemas exist because `parsePatch` calls `.partial()`, and Zod v4 refuses that on an object
 * carrying refinements ("`.partial()` cannot be used on object schemas containing refinements").
 * Creates parse `QuestionInput` — the refined schema, so a bad answer key can never be stored.
 * Patches parse `QuestionInputBase`: a patch may legitimately carry only `prompt`, so the
 * cross-field rules cannot apply anyway, and the service re-validates the whole row when the
 * answer-shaping fields are among the keys being changed.
 */
export const QuestionInputBase = z.object({
  type: QuestionType,
  prompt: z.string().trim().min(1).max(4000),
  /** Shared passage / section instruction shown above the prompt. Longer cap: it holds prose. */
  context: z.string().max(8000).nullish(),
  gradeLevelId: z.string().nullish(),
  difficulty: QuestionDifficulty.nullish(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  options: z.array(QuestionOption).max(10).default([]),
  answerKey: z.union([z.string(), z.array(z.string())]).nullish(),
  explanation: z.string().max(2000).nullish(),
});
export type QuestionInputBase = z.infer<typeof QuestionInputBase>;

export const QuestionInput = QuestionInputBase.superRefine((q, ctx) => {
  const ids = new Set(q.options.map((o) => o.id));
  const key = q.answerKey;

  if (q.type === 'mcq' || q.type === 'multi') {
    if (q.options.length < 2) {
      ctx.addIssue({
        code: 'custom',
        message: 'A choice question needs at least two options',
        path: ['options'],
      });
    }
  } else if (q.options.length > 0) {
    ctx.addIssue({
      code: 'custom',
      message: `A ${q.type} question cannot have options`,
      path: ['options'],
    });
  }

  if (q.type === 'mcq') {
    if (typeof key !== 'string' || key === '') {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick the correct option',
        path: ['answerKey'],
      });
    } else if (!ids.has(key)) {
      ctx.addIssue({
        code: 'custom',
        message: 'The correct answer must be one of the options',
        path: ['answerKey'],
      });
    }
  }

  if (q.type === 'multi') {
    if (!Array.isArray(key) || key.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick at least one correct option',
        path: ['answerKey'],
      });
    } else {
      if (new Set(key).size !== key.length) {
        ctx.addIssue({
          code: 'custom',
          message: 'The correct answers must not repeat',
          path: ['answerKey'],
        });
      }
      key.forEach((k, i) => {
        if (!ids.has(k)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Every correct answer must be one of the options',
            path: ['answerKey', i],
          });
        }
      });
    }
  }

  if (q.type === 'text') {
    if (!Array.isArray(key) || key.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Give at least one accepted answer',
        path: ['answerKey'],
      });
    } else {
      key.forEach((k, i) => {
        if (k.trim() === '') {
          ctx.addIssue({
            code: 'custom',
            message: 'An accepted answer cannot be blank',
            path: ['answerKey', i],
          });
        }
      });
    }
  }

  if (q.type === 'essay' && key != null) {
    ctx.addIssue({
      code: 'custom',
      message: 'An essay question is graded by hand and has no answer key',
      path: ['answerKey'],
    });
  }
});
export type QuestionInput = z.infer<typeof QuestionInput>;

/* ── Question import (a pre-formatted CSV of questions, parsed in the browser) ───────────── */

/**
 * Hard cap on how many questions one imported file may yield. `parseQuestionRows` in
 * shared/logic/question-csv.ts stops here and reports the file as truncated, so an oversized file
 * still produces a batch a teacher can read through row by row on the review screen instead of one
 * nobody can check before saving it into the bank.
 */
export const MAX_IMPORT_QUESTIONS = 50;

/**
 * The confirmed rows from the review screen. Each item goes through the FULL refined
 * `QuestionInput`, so a question the teacher never fixed up cannot slip into the bank.
 */
export const QuestionsImportInput = z.object({
  questions: z.array(QuestionInput).min(1).max(100),
});
export type QuestionsImportInput = z.infer<typeof QuestionsImportInput>;

/* ── Question bank bulk actions (multi-select on the bank screen) ─────────────────────────── */

/**
 * A selection of questions to act on. The cap is generous rather than meaningful — the screen can
 * only select what it has rendered — but an unbounded id array is an unbounded number of bound
 * parameters, and the service chunks against a 100-parameter ceiling.
 */
const QuestionIds = z.array(z.string().min(1)).min(1).max(1000);

export const QuestionsBulkDeleteInput = z.object({ ids: QuestionIds });
export type QuestionsBulkDeleteInput = z.infer<typeof QuestionsBulkDeleteInput>;

/**
 * Bulk metadata edit. Only the two fields that cannot invalidate a graded attempt are here, which is
 * what lets the service skip the `question_locked` check entirely — see `bulkSetMeta`.
 *
 * `.nullish()` is load-bearing on both: an explicit `null` is how the UI clears a grade level or a
 * difficulty, and is different from the field being absent (leave it alone). The refine rejects a
 * patch that would change nothing, so a stray submit cannot bump `updatedAt` on a whole selection.
 */
export const QuestionsBulkMetaInput = z
  .object({
    ids: QuestionIds,
    gradeLevelId: QuestionInputBase.shape.gradeLevelId,
    difficulty: QuestionInputBase.shape.difficulty,
  })
  .refine((v) => v.gradeLevelId !== undefined || v.difficulty !== undefined, {
    message: 'nothing to change',
  });
export type QuestionsBulkMetaInput = z.infer<typeof QuestionsBulkMetaInput>;

/** Tags to merge into every selected question. Same per-tag rules as the question's own field. */
export const QuestionsBulkTagsInput = z.object({
  ids: QuestionIds,
  tags: z.array(z.string().trim().min(1).max(50)).min(1).max(20),
});
export type QuestionsBulkTagsInput = z.infer<typeof QuestionsBulkTagsInput>;

export const TestInput = z.object({
  title: z.string().trim().min(1).max(200),
  classId: z.string().nullish(),
  assessmentTypeId: z.string().nullish(),
  gradeLevelId: z.string().nullish(),
  mode: z.enum(['online', 'paper']).default('online'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  /** UTC ISO. The UI composes these from ICT date + time; see shared/logic/tests.ts. */
  openAt: z.string().nullish(),
  closeAt: z.string().nullish(),
  timeLimitMinutes: z.coerce.number().int().min(1).max(300).nullish(),
  instructions: z.string().max(4000).nullish(),
  color: ColorId.nullish(),
});
export type TestInput = z.infer<typeof TestInput>;

export const TestQuestionsSaveInput = z.object({
  testId: z.string().min(1),
  // array order is the question order (sort_order = index)
  items: z
    .array(
      z.object({
        questionId: z.string().min(1),
        points: z.coerce.number().min(0).max(100).default(1),
      }),
    )
    .max(100),
});
export type TestQuestionsSaveInput = z.infer<typeof TestQuestionsSaveInput>;

export const PaperScoresSaveInput = z.object({
  testId: z.string().min(1),
  records: z.array(
    z.object({
      studentId: z.string().min(1),
      score: z.number().min(0).max(10).nullish(),
      comment: z.string().max(2000).nullish(),
    }),
  ),
});
export type PaperScoresSaveInput = z.infer<typeof PaperScoresSaveInput>;

/** A string for mcq/text/essay, an array of option ids for multi. */
export const AnswerValueSchema = z.union([z.string().max(20000), z.array(z.string())]);
export type AnswerValueSchema = z.infer<typeof AnswerValueSchema>;

export const AttemptAnswersSaveInput = z.object({
  attemptId: z.string().min(1),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        answer: AnswerValueSchema.nullable(),
      }),
    )
    .max(100),
});
export type AttemptAnswersSaveInput = z.infer<typeof AttemptAnswersSaveInput>;

export const AttemptGradeInput = z.object({
  attemptId: z.string().min(1),
  grades: z
    .array(
      z.object({
        questionId: z.string().min(1),
        manualPoints: z.number().min(0).nullish(),
        feedback: z.string().max(2000).nullish(),
      }),
    )
    .default([]),
  normalizedOverride: z.coerce.number().min(0).max(10).nullish(),
  comment: z.string().max(2000).nullish(),
});
export type AttemptGradeInput = z.infer<typeof AttemptGradeInput>;

/* ── Tuition module: class prices, month close, payments ────────────────────────────────── */

/** YYYY-MM. The unit a fee is billed in. */
export const TuitionMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a YYYY-MM month');

/**
 * Money is integer VND end-to-end — no floats, no minor unit (the đồng has none in practice).
 * The cap is a typo guard: a single session costing more than a billion đồng is a slipped
 * keyboard, not a price.
 */
const VndAmount = z.coerce.number().int().min(0).max(1_000_000_000);

export const ClassPriceInput = z.object({
  classId: z.string().min(1),
  priceVnd: VndAmount,
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type ClassPriceInput = z.infer<typeof ClassPriceInput>;

/**
 * Which attendance statuses a session must have to be billed. Configurable because centres
 * disagree: some charge for an unexcused absence (the seat was held), some do not. A student with
 * no attendance row at all is never billed, whatever this says.
 */
export const TuitionSettingsInput = z.object({
  billableStatuses: z.array(AttendanceStatus).min(1),
});
export type TuitionSettingsInput = z.infer<typeof TuitionSettingsInput>;

/**
 * Rankings: how much ý thức counts against the test average on the leaderboard. Integer percents
 * that must sum to 100 — the config form enforces the same rule before it lets you save, so a
 * failure here means the request did not come from that form.
 */
export const RankingWeightsInput = z
  .object({
    attitude: z.coerce.number().int().min(0).max(100),
    score: z.coerce.number().int().min(0).max(100),
  })
  .refine((w) => w.attitude + w.score === 100, {
    message: 'Weights must add up to 100',
  });
export type RankingWeightsInput = z.infer<typeof RankingWeightsInput>;

/* ── Vườn cây từ vựng (garden) ──────────────────────────────────────────────────────────── */

/**
 * How fast the garden grows and how fast it wilts. The bounds are the same ones
 * `GARDEN_SETTINGS_BOUNDS` documents in shared/logic/garden.ts; a plant that wilted in 0 days or
 * grew 20 stages an evening would make the whole metaphor meaningless.
 */
export const GardenSettingsInput = z.object({
  freeMinScorePct: z.coerce.number().int().min(0).max(100),
  wiltAfterDays: z.coerce.number().int().min(1).max(30),
  dropAfterDays: z.coerce.number().int().min(1).max(60),
  dailyGrowthCap: z.coerce.number().int().min(1).max(5),
});
export type GardenSettingsInput = z.infer<typeof GardenSettingsInput>;

/* ── Ôn tập (spaced-repetition review) ──────────────────────────────────────────────────── */

/**
 * The interval ladder the admin form posts, as one comma-separated field — the ladder's LENGTH is
 * the admin's to choose (add or drop a review), so it cannot be a fixed set of named fields, and a
 * `FormData` collapses repeated keys once it reaches the route as an object.
 *
 * Per-rung bounds match `REVIEW_INTERVAL_BOUNDS` and the length bounds `REVIEW_LADDER_BOUNDS` (both
 * in shared/logic/review.ts). A 0 first rung is legal on purpose — it means "due again today", the
 * only way to walk a full cycle in a test — but a ladder that shortens as it climbs would send
 * mastered words back sooner than new ones.
 */
export const ReviewSettingsInput = z
  .object({
    intervals: z.preprocess(
      (v) =>
        typeof v === 'string'
          ? v
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s !== '')
          : v,
      z.array(z.coerce.number().int().min(0).max(365)).min(1).max(12),
    ),
  })
  .refine((v) => v.intervals.every((n, i) => i === 0 || n >= v.intervals[i - 1]), {
    message: 'Intervals must not decrease',
  });
export type ReviewSettingsInput = z.infer<typeof ReviewSettingsInput>;

/** Giao bài từ vựng: one topic, one class, one deadline. */
export const VocabAssignmentInput = z.object({
  classId: z.string().min(1),
  topicId: z.string().min(1),
  requiredCount: z.coerce.number().int().min(1).max(20),
  minScorePct: z.coerce.number().int().min(0).max(100),
  /** Questions per round for every mode but flip; null = default sizes (pre-0036 rows). */
  questionCount: z.coerce.number().int().min(5).max(30).nullish(),
  /** ICT YYYY-MM-DD, inclusive. */
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /**
   * ICT 'HH:MM' the deadline day expires at. NULL and '' both mean end of day — the meaning every
   * row had before 0036, and what the dialog posts when the teacher leaves the time unset.
   */
  deadlineTime: z
    .string()
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v))
    .refine((v) => v == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), {
      message: 'Expected HH:MM',
    }),
  note: z.string().max(200).nullish(),
  /**
   * CSV of the game modes that count toward this assignment, canonicalised on the way in
   * (`normalizeModesCsv`); NULL / '' mean any mode counts, which is what every pre-existing row
   * reads as. Unknown ids are a 400, not a silent drop — a typo must not widen the filter.
   */
  modes: z
    .string()
    .max(120)
    .nullish()
    .refine((v) => v == null || isValidModesCsv(v), { message: 'Unknown game mode' })
    .transform((v) => (v == null ? null : normalizeModesCsv(v.split(',')))),
  /**
   * Which slices of the deck this covers: a canonical CSV of 1-based ranges over
   * `flashcardWords.sortOrder` — '1-10,21-30'. NULL and '' both mean the whole deck, which is what
   * every row written before 0048 means and what the dialog posts when the picker is cleared. Same
   * shape and same NULL semantics as `modes` above.
   *
   * A range that does not line up with a batch window is a 400 rather than a silent snap: every
   * count the teacher sees is computed per batch, so a misaligned range would make "70 words left to
   * assign" quietly wrong.
   */
  batches: z
    .string()
    .max(600)
    .nullish()
    .refine((v) => v == null || isValidRangesCsv(v), {
      message: 'Expected batch ranges like 1-10,21-30',
    })
    .transform((v) => (v == null ? null : normalizeRangesCsv(v))),
  /**
   * Which students this assignment applies to: a CSV of student ids, or NULL / '' for the whole
   * class — the meaning every assignment written before 0053 keeps. Stored as join rows in
   * vocab_assignment_students (zero rows = whole class), same NULL-means-everything shape as
   * `modes` above.
   */
  studentIds: z
    .string()
    .max(2000)
    .nullish()
    .transform((v) => {
      if (v == null || v === '') return null;
      const ids = v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return ids.length ? ids : null;
    }),
});
export type VocabAssignmentInput = z.infer<typeof VocabAssignmentInput>;

/** What a student may change about their own plant. An empty name means "unnamed", not "". */
export const PlantPatchInput = z.object({
  plantName: z
    .string()
    .trim()
    .max(30)
    .nullish()
    .or(z.literal('').transform(() => null)),
  potColor: z.string().min(1).max(20).optional(),
  /**
   * Species id from shared/garden-art.ts. Free-form here for the same reason `potColor` is — the
   * set of legal values belongs to the art registry, not to the wire format — and the service
   * rejects both an unknown id and one the student has not unlocked yet.
   */
  species: z.string().min(1).max(20).optional(),
});
export type PlantPatchInput = z.infer<typeof PlantPatchInput>;

/** A teacher's watering. The note is the audit trail's own words. */
export const WaterInput = z.object({
  studentId: z.string().min(1),
  note: z.string().max(200).nullish(),
});
export type WaterInput = z.infer<typeof WaterInput>;

/**
 * Admin test tool: put a plant at any stage, and optionally pretend it has been ignored for a
 * number of days.
 *
 * `idleDays` backdates the plant's last care rather than faking a wilted look, so the wilt, the
 * stage drops and the death that follow are produced by the real decay maths. That is the whole
 * value of the tool — waiting three days to see a plant droop is not a feedback loop.
 */
export const GardenDevInput = z.object({
  studentId: z.string().min(1),
  /** 0 is the dead pot; 1-5 are seed..fruit. */
  stage: z.coerce.number().int().min(0).max(5),
  idleDays: z.coerce.number().int().min(0).max(365).default(0),
});
export type GardenDevInput = z.infer<typeof GardenDevInput>;

export const TuitionPaymentInput = z.object({
  paidVnd: VndAmount,
  /**
   * The date picker is clearable, and an empty form field arrives as `''`, not as a missing key —
   * so `''` has to mean "no date" here. Without the literal branch, clearing the date failed the
   * regex and took the whole payment save down with a 400.
   */
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .or(z.literal('').transform(() => null)),
  paymentNote: z.string().max(500).nullish(),
});
export type TuitionPaymentInput = z.infer<typeof TuitionPaymentInput>;

/** Signed: a discount is negative, a surcharge positive. */
export const TuitionAdjustmentInput = z.object({
  adjustmentVnd: z.coerce.number().int().min(-1_000_000_000).max(1_000_000_000),
  adjustmentNote: z.string().max(500).nullish(),
});
export type TuitionAdjustmentInput = z.infer<typeof TuitionAdjustmentInput>;

/** An empty form field arrives as '', not as a missing key — treat it as "not set". */
const OptionalSetting = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .or(z.literal('').transform(() => null));

/**
 * How a family pays: the centre's bank account, shown (with a VietQR image) on the student's
 * mobile "Học phí" screen. One school-wide settings row, admin-edited on /config. Every field is
 * optional so a half-filled form still saves; the QR only renders once bankCode + accountNumber
 * exist. `bankCode` is the VietQR bank id ('VCB', 'TCB', … or the six-digit BIN); `memoTemplate`
 * supports `{month}` and `{name}` (see shared/logic/fees.ts `resolveMemo`).
 */
export const TuitionPaymentInfoInput = z.object({
  bankName: OptionalSetting(100),
  bankCode: OptionalSetting(20),
  accountNumber: OptionalSetting(30),
  accountHolder: OptionalSetting(100),
  memoTemplate: OptionalSetting(200),
});
export type TuitionPaymentInfoInput = z.infer<typeof TuitionPaymentInfoInput>;

/* ── Monthly remark (nhận xét tháng): one report per (student, month) ───────────────────── */

/** What a monthly report rates — a managed enum, config-managed like AssessmentTypeInput. */
export const RemarkCriterionInput = z.object({
  name: z.string().trim().min(1).max(100),
  active: FormBool.default(true),
  sortOrder: z.coerce.number().int().nullish(),
});
export type RemarkCriterionInput = z.infer<typeof RemarkCriterionInput>;

export const RemarkCriteriaReorder = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type RemarkCriteriaReorder = z.infer<typeof RemarkCriteriaReorder>;

/** 1-5, the teacher's tap on one of five stars. Coerced: the web form posts FormData strings. */
const RemarkRating = z.coerce.number().int().min(1).max(5);

/**
 * remark_criteria id -> rating. The web form posts FormData, where the object arrives as a JSON
 * string — hence the preprocess. A parse failure falls through as the raw string, which the
 * record schema then rejects with a real issue instead of a thrown SyntaxError.
 */
const RemarkRatings = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  },
  z.record(z.string().min(1), RemarkRating).refine((r) => Object.keys(r).length > 0, {
    message: 'at least one rating required',
  }),
);

export const MonthlyRemarkInput = z.object({
  studentId: z.string().min(1),
  month: TuitionMonth,
  ratings: RemarkRatings,
  comment: z.string().max(4000).nullish(),
});
export type MonthlyRemarkInput = z.infer<typeof MonthlyRemarkInput>;

/**
 * The page-view beacon (`/track`, see app/routes/track.tsx and src/lib/track.ts). Web-only for
 * now — there is no mobile beacon in v1 — but schemas live here regardless of client, same as
 * everything else in this file.
 */
export const TrackEvent = z.object({
  path: z.string().min(1).max(512),
  screen: z.string().max(64).nullish(),
  at: z.string().datetime({ offset: true }).optional(),
});
export type TrackEvent = z.infer<typeof TrackEvent>;

export const TrackBeaconInput = z.object({
  events: z.array(TrackEvent).max(50),
  appVersion: z.string().max(200).optional(),
});
export type TrackBeaconInput = z.infer<typeof TrackBeaconInput>;

/* ── Check-in / check-out kiosk + túi mù ──────────────────────────────────────────────── */

/** Managed enum row (subjects pattern) plus the icon and color a kiosk cell renders with. */
export const CheckinActivityTypeInput = z.object({
  name: z.string().trim().min(1).max(100),
  icon: z.string().trim().min(1).max(40),
  color: ColorId,
  active: FormBool.default(true),
  sortOrder: z.coerce.number().int().nullish(),
});
export type CheckinActivityTypeInput = z.infer<typeof CheckinActivityTypeInput>;

export const CheckinActivityTypeReorder = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type CheckinActivityTypeReorder = z.infer<typeof CheckinActivityTypeReorder>;

export const ChecklistItemInput = z.object({
  eventId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phase: z.enum(['checkin', 'checkout']),
  /**
   * The kiosk cell's managed type. Checkout lines are free text and a freshly added check-in row
   * starts unset, so absent, NULL and '' all mean "no type" — the picker's own "not chosen yet"
   * option posts the empty string, and that has to clear the column rather than 400.
   */
  activityTypeId: z
    .string()
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v)),
  label: z.string().trim().max(300).default(''),
  sortOrder: z.coerce.number().int().nullish(),
});
export type ChecklistItemInput = z.infer<typeof ChecklistItemInput>;

/** One kiosk tap: check or uncheck a cell for a student. */
export const CheckInput = z.object({
  itemId: z.string().min(1),
  studentId: z.string().min(1),
  checked: FormBool,
});
export type CheckInput = z.infer<typeof CheckInput>;

export const CheckinTierInput = z.object({
  bags: z.coerce.number().int().min(1).max(60),
  label: z.string().trim().min(1).max(100),
});

export const CheckinSettingsInput = z.object({
  earnMode: z.enum(['perfect_day', 'per_phase']),
  /** Posted as a JSON string from the config form; the action parses before validating. */
  tiers: z.array(CheckinTierInput).max(5),
  showClassBoard: FormBool.default(true),
  showParentReport: FormBool.default(false),
  showRankings: FormBool.default(false),
  showStudentView: FormBool.default(true),
});
export type CheckinSettingsInput = z.infer<typeof CheckinSettingsInput>;

export const GiftRedeemInput = z.object({
  studentId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  tierBags: z.coerce.number().int().min(1),
  note: z.string().trim().max(300).nullish(),
});
export type GiftRedeemInput = z.infer<typeof GiftRedeemInput>;
