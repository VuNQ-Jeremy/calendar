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

export const classes = sqliteTable('classes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  subject: text('subject'),
  color: text('color').notNull().default('green'),
  room: text('room'),
});

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

export const homework = sqliteTable('homework', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
  due: text('due'),
  points: integer('points'),
  notes: text('notes'),
  color: text('color'),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  assessmentTypeId: text('assessment_type_id').references(() => assessmentTypes.id, {
    onDelete: 'set null',
  }),
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

export const homeworkGrades = sqliteTable(
  'homework_grades',
  {
    id: text('id').primaryKey(),
    homeworkId: text('homework_id')
      .notNull()
      .references(() => homework.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    score: real('score'),
    comment: text('comment'),
    gradedAt: text('graded_at'),
    scoreRecordId: text('score_record_id').references(() => scoreRecords.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('idx_homework_grades_hw').on(t.homeworkId),
    index('idx_homework_grades_student').on(t.studentId),
    unique('uq_homework_grades').on(t.homeworkId, t.studentId),
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
    audioUrl: text('audio_url'),
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
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.wordId] }),
    index('idx_flashcard_mastery_word').on(t.wordId),
  ],
);
