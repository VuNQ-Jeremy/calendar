import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  unique,
} from 'drizzle-orm/sqlite-core';

export const staff = sqliteTable('staff', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email'),
  role: text('role').notNull().default('Teacher'),
  color: text('color').notNull().default('orange'),
  phone: text('phone'),
});

export const students = sqliteTable('students', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  grade: text('grade'),
  guardian: text('guardian'),
  email: text('email'),
  color: text('color').notNull().default('blue'),
});

export const parents = sqliteTable('parents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  color: text('color').notNull().default('green'),
  relation: text('relation'),
});

/**
 * Trình độ — the second half of a class's competition cohort, alongside `gradeLevelId` (khối).
 * Managed from /config like `gradeLevels`; see migrations/0029_class_cohort.sql.
 */
/** Môn học — managed from /config; see migrations/0030_subjects.sql. */
export const subjects = sqliteTable('subjects', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const classLevels = sqliteTable('class_levels', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const classes = sqliteTable('classes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /**
   * DORMANT since 0030, like `room` below. Subjects are a managed enum now (`subjectId`); this
   * column is what that enum was seeded from and is the only record of the original free text.
   * Read by nothing, written by nothing. Delete the field, not the data.
   */
  subject: text('subject'),
  subjectId: text('subject_id').references(() => subjects.id, { onDelete: 'set null' }),
  color: text('color').notNull().default('green'),
  /** (khối, trình độ) — both set means the class competes in that cohort's rankings. */
  gradeLevelId: text('grade_level_id').references(() => gradeLevels.id, { onDelete: 'set null' }),
  classLevelId: text('class_level_id').references(() => classLevels.id, { onDelete: 'set null' }),
  /**
   * DORMANT. `room` was removed from the product (only the phone could ever set it, and the web
   * displayed it without an input). The column stays so no migration is needed and the four
   * existing values survive — nothing reads or writes it. Delete the field, not the data.
   */
  room: text('room'),
});

/**
 * DORMANT, like `classes.room`. Weekly schedules were editable only on the phone; the field was
 * removed from the product rather than built twice. Nothing reads or writes these rows — the
 * table and its seed data stay so the decision is reversible without a migration.
 */
export const classSchedule = sqliteTable(
  'class_schedule',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    day: integer('day').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
  },
  (t) => [index('idx_class_schedule_class').on(t.classId)],
);

export const classStudents = sqliteTable(
  'class_students',
  {
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.classId, t.studentId] }),
    index('idx_class_students_student').on(t.studentId),
  ],
);

export const parentStudents = sqliteTable(
  'parent_students',
  {
    parentId: text('parent_id')
      .notNull()
      .references(() => parents.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.parentId, t.studentId] }),
    index('idx_parent_students_student').on(t.studentId),
  ],
);

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    date: text('date').notNull(),
    startTime: text('start_time'),
    endTime: text('end_time'),
    color: text('color'),
    classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
    location: text('location'),
    recurrence: text('recurrence').notNull().default('none'),
    notes: text('notes'),
  },
  (t) => [index('idx_events_date').on(t.date)],
);

export const assessmentTypes = sqliteTable('assessment_types', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** The rating rows on the monthly report — a managed enum like assessment_types. */
export const remarkCriteria = sqliteTable('remark_criteria', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const materials = sqliteTable('materials', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  type: text('type').notNull().default('notes'),
  classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
  url: text('url'),
  fileName: text('file_name'),
  fileKey: text('file_key'),
  favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
  addedAt: text('added_at'),
  scope: text('scope').notNull().default('class'),
});

export const eventMaterials = sqliteTable(
  'event_materials',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    materialId: text('material_id')
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.materialId] }),
    index('idx_event_materials_material').on(t.materialId),
  ],
);

export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  role: text('role').notNull(),
  name: text('name'),
  classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
  createdAt: text('created_at'),
  used: integer('used', { mode: 'boolean' }).notNull().default(false),
  usedBy: text('used_by').references(() => accounts.id, { onDelete: 'set null' }),
  usedAt: text('used_at'),
  /**
   * The person this code belongs to — exactly one is set for codes minted by the People
   * screen, which generates them right after creating the row. Redeeming a linked code
   * attaches an account to that row instead of inserting a second one.
   *
   * All three NULL = legacy invite (still minted by the mobile app); redeem falls back to
   * creating the person. CASCADE so a deleted person's unused code dies with them rather
   * than silently demoting to the legacy path. See migrations/0030_invite_links.sql.
   */
  studentId: text('student_id').references(() => students.id, { onDelete: 'cascade' }),
  staffId: text('staff_id').references(() => staff.id, { onDelete: 'cascade' }),
  parentId: text('parent_id').references(() => parents.id, { onDelete: 'cascade' }),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  staffId: text('staff_id').references(() => staff.id, { onDelete: 'set null' }),
  studentId: text('student_id').references(() => students.id, { onDelete: 'set null' }),
  parentId: text('parent_id').references(() => parents.id, { onDelete: 'set null' }),
  createdAt: text('created_at'),
});

export const sessions = sqliteTable(
  'sessions',
  {
    token: text('token').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    // Added in migration 0035, for the activity log's security view. Nullable: rows written
    // before that migration have none, and the view must render that rather than treat it as
    // suspicious.
    createdAt: text('created_at'),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('idx_sessions_account').on(t.accountId)],
);

export const passwordResets = sqliteTable('password_resets', {
  tokenHash: text('token_hash').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  used: integer('used').notNull().default(0),
});

export const feedback = sqliteTable(
  'feedback',
  {
    id: text('id').primaryKey(),
    message: text('message').notNull(),
    category: text('category').notNull().default('idea'),
    author: text('author'),
    status: text('status').notNull().default('new'),
    createdAt: text('created_at'),
    appVersion: text('app_version'),
  },
  (t) => [index('idx_feedback_status').on(t.status)],
);

export const scoreRecords = sqliteTable(
  'score_records',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
    date: text('date').notNull(),
    score: real('score').notNull(),
    assessmentTypeId: text('assessment_type_id').references(() => assessmentTypes.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
  },
  (t) => [
    index('idx_score_records_student').on(t.studentId, t.date),
    index('idx_score_records_class').on(t.classId),
    index('idx_score_records_type').on(t.assessmentTypeId),
  ],
);

export const behaviorRecords = sqliteTable(
  'behavior_records',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
    date: text('date').notNull(),
    type: text('type').notNull(),
    notes: text('notes'),
  },
  (t) => [
    index('idx_behavior_records_student').on(t.studentId, t.date),
    index('idx_behavior_records_class').on(t.classId),
  ],
);

/**
 * One teacher-written monthly report per student. The ratings are 1-5; the stats a report shows
 * next to them are computed from scoreRecords/behaviorRecords at read time, never stored.
 */
export const monthlyRemarks = sqliteTable(
  'monthly_remarks',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    /** JSON object: remark_criteria id -> 1-5 rating. */
    ratings: text('ratings').notNull().default('{}'),
    comment: text('comment'),
    /** Author of the last save; see migrations/0032_remark_meta.sql. */
    staffId: text('staff_id').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
    /** When the slip image last reached a family chat via /zalo-send-card. */
    sentAt: text('sent_at'),
  },
  (t) => [
    unique('uq_monthly_remarks_student_month').on(t.studentId, t.month),
    index('idx_monthly_remarks_month').on(t.month),
    index('idx_monthly_remarks_staff').on(t.staffId),
  ],
);

export const attendanceRecords = sqliteTable(
  'attendance_records',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    status: text('status').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.date, t.studentId] }),
    index('idx_attendance_student').on(t.studentId, t.date),
  ],
);

/**
 * "Preview buổi sau" — what one occurrence of a class will cover. Keyed like attendanceRecords
 * above, and for the same reason: a weekly class is one `events` row, so anything that differs
 * week to week cannot live on the event. See migrations/0024_session_previews.sql.
 *
 * The `vocabTopicId` reference resolves lazily, so declaring this above flashcardTopics is fine.
 */
export const sessionPreviews = sqliteTable(
  'session_previews',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    focusText: text('focus_text').notNull().default(''),
    vocabTopicId: text('vocab_topic_id').references(() => flashcardTopics.id, {
      onDelete: 'set null',
    }),
    updatedAt: text('updated_at'),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.date] }),
    index('idx_session_previews_date').on(t.date),
  ],
);

export const flashcardTopics = sqliteTable(
  'flashcard_topics',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug'),
    description: text('description'),
    color: text('color').notNull().default('violet'),
    createdAt: text('created_at'),
  },
  (t) => [index('idx_flashcard_topics_slug').on(t.slug)],
);

export const flashcardWords = sqliteTable(
  'flashcard_words',
  {
    id: text('id').primaryKey(),
    topicId: text('topic_id')
      .notNull()
      .references(() => flashcardTopics.id, { onDelete: 'cascade' }),
    word: text('word').notNull(),
    meaningVi: text('meaning_vi').notNull(),
    definitionEn: text('definition_en'),
    ipa: text('ipa'),
    /** One simple example sentence containing the word, or null. See 0036_vocab_examples.sql. */
    exampleEn: text('example_en'),
    /** The exact form of the word as used in exampleEn (may be inflected), or null. */
    exampleAnswer: text('example_answer'),
    audioUrl: text('audio_url'),
    /** R2 object key ("flashcards/<uuid>.<ext>"), not a URL — see 0033_flashcard_word_images.sql. */
    imageKey: text('image_key'),
    createdAt: text('created_at'),
  },
  (t) => [index('idx_flashcard_words_topic').on(t.topicId)],
);

export const flashcardResults = sqliteTable(
  'flashcard_results',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id').references(() => students.id, { onDelete: 'cascade' }),
    staffId: text('staff_id').references(() => staff.id, { onDelete: 'cascade' }),
    topicId: text('topic_id')
      .notNull()
      .references(() => flashcardTopics.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    score: integer('score').notNull(),
    total: integer('total').notNull(),
    durationMs: integer('duration_ms'),
    playedAt: text('played_at').notNull(),
    /** Device-generated UUID for offline replay. Unique where present — see 0014_mobile.sql. */
    clientId: text('client_id'),
  },
  (t) => [
    index('idx_flashcard_results_topic').on(t.topicId, t.playedAt),
    index('idx_flashcard_results_student').on(t.studentId, t.playedAt),
  ],
);

/** One row per installed mobile device. */
export const pushTokens = sqliteTable(
  'push_tokens',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    expoToken: text('expo_token').notNull().unique(),
    platform: text('platform').notNull().default('android'),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at'),
  },
  (t) => [index('idx_push_tokens_account').on(t.accountId)],
);

/**
 * Zalo Bot channel — see migrations/0027_zalo.sql.
 *
 * One row per paired Zalo conversation, keyed on Zalo's own `chat_id`. Exactly one of
 * accountId / parentId / classId is set; the invariant lives in server/services/zalo.ts because
 * SQLite cannot state it. `parentId` points at `parents` rather than `accounts` on purpose:
 * parent accounts cannot log in, so a parent has no session to pair from and reaches the bot
 * through a staff-issued code instead.
 */
export const zaloChats = sqliteTable(
  'zalo_chats',
  {
    id: text('id').primaryKey(),
    chatId: text('chat_id').notNull().unique(),
    /** 'user' | 'group' — the webhook's chat.chat_type, normalised. */
    kind: text('kind').notNull().default('user'),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references(() => parents.id, { onDelete: 'cascade' }),
    /**
     * A family reached through the student rather than a `parents` row — see 0028. Most students
     * have no parent record, and requiring one first would be data entry in service of the
     * schema. Unioned with the parent route when fanning out, never instead of it.
     */
    studentId: text('student_id').references(() => students.id, { onDelete: 'cascade' }),
    classId: text('class_id').references(() => classes.id, { onDelete: 'cascade' }),
    displayName: text('display_name'),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at'),
  },
  (t) => [
    index('idx_zalo_chats_account').on(t.accountId),
    index('idx_zalo_chats_parent').on(t.parentId),
    index('idx_zalo_chats_student').on(t.studentId),
    index('idx_zalo_chats_class').on(t.classId),
  ],
);

/** Single-use, expiring pairing codes. The code is the credential — see the migration. */
export const zaloPairCodes = sqliteTable(
  'zalo_pair_codes',
  {
    code: text('code').primaryKey(),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references(() => parents.id, { onDelete: 'cascade' }),
    studentId: text('student_id').references(() => students.id, { onDelete: 'cascade' }),
    classId: text('class_id').references(() => classes.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
  },
  (t) => [index('idx_zalo_pair_codes_expires').on(t.expiresAt)],
);

/**
 * What has already been pushed, so a repeating cron sweep does not repeat itself.
 *
 * Key: `{kind}:{subjectId}:{occurrenceDate}` — see migrations/0015_notifications.sql. Shared by
 * both delivery channels: Zalo keys carry a `zalo-` prefix so enabling the second channel does
 * not find every occurrence already marked done by the first.
 */
export const sentNotifications = sqliteTable(
  'sent_notifications',
  {
    key: text('key').primaryKey(),
    sentAt: text('sent_at').notNull(),
  },
  (t) => [index('idx_sent_notifications_sent_at').on(t.sentAt)],
);

export const flashcardMastery = sqliteTable(
  'flashcard_mastery',
  {
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    wordId: text('word_id')
      .notNull()
      .references(() => flashcardWords.id, { onDelete: 'cascade' }),
    correct: integer('correct').notNull().default(0),
    wrong: integer('wrong').notNull().default(0),
    lastSeen: text('last_seen'),
    /** Spaced-repetition rung: index into the review settings' intervals. See shared/logic/review.ts. */
    level: integer('level').notNull().default(0),
    /** ICT YYYY-MM-DD the word next falls due; NULL = not scheduled. */
    dueDay: text('due_day'),
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.wordId] }),
    index('idx_flashcard_mastery_word').on(t.wordId),
    index('idx_flashcard_mastery_due').on(t.studentId, t.dueDay),
  ],
);

/**
 * Tests module — see migrations/0017_tests.sql. A question bank (`questions`) is composed into
 * `tests`, which students sit as `test_attempts` holding one `test_answers` row per question.
 * `test_questions.questionId` deliberately has NO cascade: deleting a question that is still on a
 * test must fail at the service layer rather than silently reshape a published test.
 */
export const gradeLevels = sqliteTable('grade_levels', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    /** mcq | multi | text | essay */
    type: text('type').notNull(),
    prompt: text('prompt').notNull(),
    /**
     * Shared text the prompt depends on — a reading passage, a cloze paragraph, or the section
     * instruction covering a run of questions. Rendered above the prompt, and deduped when
     * consecutive questions on a test carry the same one. See migrations/0019.
     */
    context: text('context'),
    gradeLevelId: text('grade_level_id').references(() => gradeLevels.id, {
      onDelete: 'set null',
    }),
    /** easy | medium | hard | null */
    difficulty: text('difficulty'),
    /** JSON string[] */
    tags: text('tags').notNull().default('[]'),
    /** JSON [{ id, text }] — mcq/multi only */
    options: text('options').notNull().default('[]'),
    /** JSON: mcq "optId" | multi ["optId"] | text ["accepted"] | essay null */
    answerKey: text('answer_key'),
    explanation: text('explanation'),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
  },
  (t) => [index('idx_questions_grade_level').on(t.gradeLevelId)],
);

export const tests = sqliteTable(
  'tests',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
    assessmentTypeId: text('assessment_type_id').references(() => assessmentTypes.id, {
      onDelete: 'set null',
    }),
    gradeLevelId: text('grade_level_id').references(() => gradeLevels.id, {
      onDelete: 'set null',
    }),
    /** draft | published */
    status: text('status').notNull().default('draft'),
    /** online | paper */
    mode: text('mode').notNull().default('online'),
    /** ICT YYYY-MM-DD; becomes score_records.date */
    date: text('date'),
    /** UTC ISO */
    openAt: text('open_at'),
    /** UTC ISO */
    closeAt: text('close_at'),
    timeLimitMinutes: integer('time_limit_minutes'),
    instructions: text('instructions'),
    color: text('color'),
    createdAt: text('created_at'),
  },
  (t) => [index('idx_tests_class').on(t.classId)],
);

export const testQuestions = sqliteTable(
  'test_questions',
  {
    testId: text('test_id')
      .notNull()
      .references(() => tests.id, { onDelete: 'cascade' }),
    /** No cascade on purpose — the service guards question deletes. */
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id),
    sortOrder: integer('sort_order').notNull().default(0),
    points: real('points').notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.testId, t.questionId] }),
    index('idx_test_questions_question').on(t.questionId),
  ],
);

export const testAttempts = sqliteTable(
  'test_attempts',
  {
    id: text('id').primaryKey(),
    testId: text('test_id')
      .notNull()
      .references(() => tests.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    /** online | paper */
    source: text('source').notNull().default('online'),
    /** in_progress | submitted | needs_grading | graded */
    status: text('status').notNull().default('in_progress'),
    startedAt: text('started_at').notNull(),
    submittedAt: text('submitted_at'),
    /** Server-computed at start: min(closeAt, startedAt + timeLimitMinutes). */
    deadlineAt: text('deadline_at'),
    autoScore: real('auto_score'),
    totalScore: real('total_score'),
    /** 0-10 — the value that syncs to score_records. */
    normalizedScore: real('normalized_score'),
    comment: text('comment'),
    scoreRecordId: text('score_record_id').references(() => scoreRecords.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('idx_test_attempts_test').on(t.testId),
    index('idx_test_attempts_student').on(t.studentId),
    unique('uq_test_attempts').on(t.testId, t.studentId),
  ],
);

export const testAnswers = sqliteTable(
  'test_answers',
  {
    attemptId: text('attempt_id')
      .notNull()
      .references(() => testAttempts.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    /** JSON: mcq "optId" | multi ["optId"] | text/essay "string" */
    answer: text('answer'),
    /** 1 | 0 | null (essay, or not yet graded) */
    autoCorrect: integer('auto_correct', { mode: 'boolean' }),
    autoPoints: real('auto_points'),
    /** Effective points = manualPoints ?? autoPoints. */
    manualPoints: real('manual_points'),
    feedback: text('feedback'),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.questionId] })],
);

/**
 * Tuition module — see migrations/0020_tuition.sql. Attendance rows become a monthly fee: each
 * class has a per-session price (effective-dated), a month is computed live until an admin closes
 * it, and closing freezes the numbers into `tuitionLines`. Every amount is integer VND.
 */
export const classPrices = sqliteTable(
  'class_prices',
  {
    id: text('id').primaryKey(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    /** Per session. */
    priceVnd: integer('price_vnd').notNull(),
    /** YYYY-MM-DD; applies to months whose 1st is >= this date. */
    effectiveFrom: text('effective_from').notNull(),
    createdAt: text('created_at'),
  },
  (t) => [unique('uq_class_prices').on(t.classId, t.effectiveFrom)],
);

/** No row for a month means that month is open. */
export const tuitionMonths = sqliteTable('tuition_months', {
  /** YYYY-MM */
  month: text('month').primaryKey(),
  /** open | closed */
  status: text('status').notNull().default('open'),
  /** UTC ISO */
  closedAt: text('closed_at'),
  closedBy: text('closed_by'),
  /** JSON snapshot of the billable-status setting used at close, for audit. */
  billableStatuses: text('billable_statuses'),
});

export const tuitionLines = sqliteTable(
  'tuition_lines',
  {
    id: text('id').primaryKey(),
    month: text('month')
      .notNull()
      .references(() => tuitionMonths.month, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    /**
     * No reference to classes on purpose, and `className` is denormalized: a closed month is a
     * financial record and must survive the class being renamed or deleted.
     */
    classId: text('class_id').notNull(),
    className: text('class_name').notNull(),
    /** Billable session count. */
    sessions: integer('sessions').notNull(),
    /**
     * JSON ["YYYY-MM-DD", ...] — one entry per billed session, so the Minimal slip can print the
     * session list on a closed month. Empty for lines frozen before migration 0021.
     */
    dates: text('dates').notNull().default('[]'),
    /** JSON {"present":10,"late":1,...} — all statuses, so the slip can show the breakdown. */
    statusCounts: text('status_counts').notNull().default('{}'),
    unitPriceVnd: integer('unit_price_vnd').notNull(),
    amountVnd: integer('amount_vnd').notNull(),
  },
  (t) => [
    unique('uq_tuition_lines').on(t.month, t.studentId, t.classId),
    index('idx_tuition_lines_student').on(t.studentId, t.month),
  ],
);

/**
 * Payment and one-off adjustment for a student-month. Deliberately outside the close snapshot:
 * money is collected after the month is closed, so these stay editable either way.
 */
export const tuitionStudentMonths = sqliteTable(
  'tuition_student_months',
  {
    month: text('month').notNull(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    /** Signed. */
    adjustmentVnd: integer('adjustment_vnd').notNull().default(0),
    adjustmentNote: text('adjustment_note'),
    paidVnd: integer('paid_vnd').notNull().default(0),
    /** YYYY-MM-DD, last payment date. */
    paidAt: text('paid_at'),
    paymentNote: text('payment_note'),
  },
  (t) => [primaryKey({ columns: [t.month, t.studentId] })],
);

/**
 * Vườn cây từ vựng (vocabulary garden) — see migrations/0026_garden.sql.
 *
 * One plant per student, school-wide. Wilt and stage drops are DERIVED from elapsed time by
 * `settlePlant` in shared/logic/garden.ts, fenced by `dropsTaken`. Readers settle in memory and
 * never write, which is what keeps the student's own view, the class garden and the notification
 * sweep from ever disagreeing.
 */
export const gardenPlants = sqliteTable('garden_plants', {
  studentId: text('student_id')
    .primaryKey()
    .references(() => students.id, { onDelete: 'cascade' }),
  plantName: text('plant_name'),
  /** App palette key, same vocabulary as students.color. */
  potColor: text('pot_color').notNull().default('orange'),
  /** 0..5 — 0 empty/dead, 1 seed, 2 sprout, 3 young plant, 4 purple flower, 5 fruit. */
  stage: integer('stage').notNull(),
  isDead: integer('is_dead', { mode: 'boolean' }).notNull().default(false),
  /** ICT day the wilt began, or null. Also set by a missed-deadline penalty. */
  wiltedSince: text('wilted_since'),
  /** ICT day of the last care event — the wilt/drop clock counts from here. */
  lastCareDay: text('last_care_day').notNull(),
  /** ICT day `growCount` refers to, so the daily cap resets at ICT midnight. */
  growDay: text('grow_day'),
  growCount: integer('grow_count').notNull().default(0),
  /** Stages already lost to neglect since the last care event. The decay fence. */
  dropsTaken: integer('drops_taken').notNull().default(0),
  /** Lifetime harvested fruit; never decreases. Per-month counts come from harvest events. */
  fruitsTotal: integer('fruits_total').notNull().default(0),
  streakDays: integer('streak_days').notNull().default(0),
  streakLastDay: text('streak_last_day'),
  /** UTC ISO. Doubles as the optimistic-concurrency token. */
  updatedAt: text('updated_at').notNull(),
});

/**
 * Append-only audit log, and the qualifying-play ledger: a `grow` row exists for EVERY qualifying
 * play, with `stageAfter === stageBefore` when the daily cap was hit.
 *
 * `refId` is a natural idempotency key per type (result id / fruit ordinal / due ICT day /
 * assignment id). A UNIQUE violation aborts the whole `db.batch`, which is how concurrent plays,
 * double-tapped harvests and re-run deadline sweeps are all made harmless. The index is partial
 * (`WHERE ref_id IS NOT NULL`) so plain watering, which has no natural key, can repeat — Drizzle
 * cannot express that, so it lives in the migration only.
 */
export const gardenEvents = sqliteTable(
  'garden_events',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    /** grow | revive | harvest | wilt | decay_drop | die | deadline_drop | water */
    type: text('type').notNull(),
    stageBefore: integer('stage_before').notNull(),
    stageAfter: integer('stage_after').notNull(),
    /** The ICT day the event is attributed to — for decay, the day the drop was due. */
    vnDay: text('vn_day').notNull(),
    refId: text('ref_id'),
    actorStaffId: text('actor_staff_id').references(() => staff.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_garden_events_student').on(t.studentId, t.createdAt),
    index('idx_garden_events_day').on(t.vnDay, t.type),
  ],
);

/**
 * Teacher-assigned vocabulary: one topic, one class, one deadline. Progress is deliberately NOT
 * stored — it is counted from `flashcardResults` at read time, so editing the threshold re-reads
 * honestly instead of leaving a stale tally behind.
 */
export const vocabAssignments = sqliteTable(
  'vocab_assignments',
  {
    id: text('id').primaryKey(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    topicId: text('topic_id')
      .notNull()
      .references(() => flashcardTopics.id, { onDelete: 'cascade' }),
    staffId: text('staff_id').references(() => staff.id, { onDelete: 'set null' }),
    requiredCount: integer('required_count').notNull().default(3),
    minScorePct: integer('min_score_pct').notNull().default(70),
    /** Questions per round (5-30) for every mode but flip; NULL = default round sizes. */
    questionCount: integer('question_count'),
    /** ICT YYYY-MM-DD, inclusive. */
    deadline: text('deadline').notNull(),
    /**
     * ICT 'HH:MM' the deadline day expires at, or NULL for end of day — see
     * 0036_vocab_assignment_deadline_time.sql. Every day-level comparison still reads `deadline`
     * alone; this only sharpens the qualifying window (`deadlineEndUtc`).
     */
    deadlineTime: text('deadline_time'),
    note: text('note'),
    /**
     * CSV of game-mode ids that count toward this assignment, canonicalised by
     * VocabAssignmentInput; NULL / '' mean any mode — see 0034_vocab_assignment_modes.sql.
     */
    modes: text('modes'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_vocab_assignments_class').on(t.classId, t.deadline),
    index('idx_vocab_assignments_topic').on(t.topicId),
  ],
);

/**
 * Cooperative class tree: +1 point per qualifying play by any member, counted even when that
 * student's own plant was capped, already at fruit, or dead. Effort always counts for the class.
 */
export const classTrees = sqliteTable('class_trees', {
  classId: text('class_id')
    .primaryKey()
    .references(() => classes.id, { onDelete: 'cascade' }),
  points: integer('points').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Month-end album. Names and plant state are denormalized into `data` because the album is a
 * keepsake: it must survive students leaving, classes being renamed, and plants growing on.
 */
export const gardenSnapshots = sqliteTable(
  'garden_snapshots',
  {
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    /** YYYY-MM */
    month: text('month').notNull(),
    className: text('class_name').notNull(),
    /** JSON — see shared/logic/garden.ts `GardenSnapshotData`. */
    data: text('data').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.classId, t.month] })],
);

/**
 * Append-only audit log — every mutation (with full before/after JSON), page view, and auth event,
 * across every actor (web sessions, the mobile API, crons, Zalo). See migrations/0035_activity_log.sql
 * for the full column-by-column rationale and server/services/audit.ts for how rows are built.
 *
 * `id` is autoincrement (the `classSchedule.id` precedent) rather than this repo's usual
 * `crypto.randomUUID()` — a monotonic int is what makes cursor pagination and the retention purge
 * cheap. No foreign keys: the log must outlive the accounts, sessions and records it describes.
 */
export const activityLog = sqliteTable(
  'activity_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    occurredAt: text('occurred_at').notNull(),
    recordedAt: text('recorded_at').notNull(),
    /** 'web' | 'api' | 'beacon' | 'cron' | 'zalo' */
    source: text('source').notNull(),
    /** 'staff' | 'student' | 'parent' | 'system' | 'anon' */
    actorKind: text('actor_kind').notNull(),
    actorId: text('actor_id'),
    actorName: text('actor_name'),
    accountId: text('account_id'),
    sessionRef: text('session_ref'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    action: text('action').notNull(),
    domain: text('domain'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    route: text('route'),
    intent: text('intent'),
    status: integer('status'),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    metaJson: text('meta_json'),
  },
  (t) => [
    index('idx_activity_entity').on(t.entityType, t.entityId, t.id),
    index('idx_activity_account').on(t.accountId, t.id),
    index('idx_activity_action').on(t.action, t.id),
    index('idx_activity_time').on(t.recordedAt),
  ],
);
