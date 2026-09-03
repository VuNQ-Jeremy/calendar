import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * A school. Every table below that is ever read without already being fenced by a scoped
 * parent id carries a `tenantId` pointing here — see migrations/0045_tenants.sql for which
 * tables do not, and why.
 *
 * `tenantId` is deliberately NOT given a drizzle `.default()`, even though the SQL columns
 * added by ALTER carry one: leaving it required means a raw insert that forgets the school
 * fails to compile. The sanctioned way to insert is `TenantDb.insert`, which supplies it.
 */
export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  /** Generated from the name at signup. Internal — there is no subdomain routing. */
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  /** 'active' | 'suspended' — suspension is enforced in userFromToken, so it kills sessions. */
  status: text('status').notNull().default('active'),
  /** Reviewed by a platform admin on /platform. Informational until there is an email provider. */
  verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  /** Per-school meta (plan, limits, integration tokens) until any of it earns a column. */
  settingsJson: text('settings_json'),
});

export const staff = sqliteTable(
  'staff',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    email: text('email'),
    role: text('role').notNull().default('Teacher'),
    color: text('color').notNull().default('orange'),
    phone: text('phone'),
  },
  (t) => [index('idx_staff_tenant').on(t.tenantId)],
);

export const students = sqliteTable(
  'students',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    grade: text('grade'),
    guardian: text('guardian'),
    email: text('email'),
    color: text('color').notNull().default('blue'),
  },
  (t) => [index('idx_students_tenant').on(t.tenantId)],
);

export const parents = sqliteTable(
  'parents',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    /** Canonical E.164 mirror of `phone`, kept in sync by server/services/people.ts on every
     * write — see migrations/0051_login_methods.sql. What the Zalo OTP resolution algorithm
     * actually matches against; `phone` stays the free-text display value. */
    phoneE164: text('phone_e164'),
    color: text('color').notNull().default('green'),
    relation: text('relation'),
  },
  (t) => [index('idx_parents_tenant').on(t.tenantId), index('idx_parents_phone').on(t.phoneE164)],
);

/**
 * Trình độ — the second half of a class's competition cohort, alongside `gradeLevelId` (khối).
 * Managed from /config like `gradeLevels`; see migrations/0029_class_cohort.sql.
 */
/**
 * Môn học — managed from /config; see migrations/0030_subjects.sql.
 *
 * The name is unique per school, not globally: two schools both teaching "Toán" is the normal
 * case, and the original global UNIQUE(name) was the single-school assumption made structural.
 * Rebuilt by 0045, which is also where the real FK to `tenants` comes from.
 */
export const subjects = sqliteTable(
  'subjects',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [unique().on(t.tenantId, t.name)],
);

export const classLevels = sqliteTable(
  'class_levels',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [unique().on(t.tenantId, t.name)],
);

export const classes = sqliteTable(
  'classes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
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
  },
  (t) => [index('idx_classes_tenant').on(t.tenantId)],
);

/**
 * DORMANT, like `classes.room`. Weekly schedules were editable only on the phone; the field was
 * removed from the product rather than built twice. Nothing reads or writes these rows — the
 * table and its seed data stay so the decision is reversible without a migration.
 *
 * No `tenantId`: nothing queries it at all, and it is reachable only through a scoped class.
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

/**
 * Junction tables carry a denormalized `tenantId` rather than reaching their parent, because the
 * repo's read pattern is "fetch the whole junction, assemble in JS" (see `classes.list`).
 * Rewriting those scans as correlated subqueries would be a far larger diff than one column the
 * insert wrapper keeps honest.
 */
export const classStudents = sqliteTable(
  'class_students',
  {
    tenantId: text('tenant_id').notNull(),
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
    index('idx_class_students_tenant').on(t.tenantId),
  ],
);

export const parentStudents = sqliteTable(
  'parent_students',
  {
    tenantId: text('tenant_id').notNull(),
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
    index('idx_parent_students_tenant').on(t.tenantId),
  ],
);

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    title: text('title').notNull(),
    date: text('date').notNull(),
    startTime: text('start_time'),
    endTime: text('end_time'),
    color: text('color'),
    classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
    location: text('location'),
    recurrence: text('recurrence').notNull().default('none'),
    /** Inclusive last ICT day (YYYY-MM-DD) the series generates occurrences; NULL = open-ended. */
    until: text('until'),
    /** JSON ["YYYY-MM-DD", ...] — occurrences detached or removed by a "this event only" edit. */
    exdates: text('exdates').notNull().default('[]'),
    notes: text('notes'),
  },
  (t) => [index('idx_events_tenant_date').on(t.tenantId, t.date)],
);

export const assessmentTypes = sqliteTable(
  'assessment_types',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [unique().on(t.tenantId, t.name)],
);

/** The rating rows on the monthly report — a managed enum like assessment_types. */
export const remarkCriteria = sqliteTable(
  'remark_criteria',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [unique().on(t.tenantId, t.name)],
);

/**
 * The file library. Deliberately free of any owner column: which classes and which events carry
 * a material lives in the `class_materials` / `event_materials` joins, so one file can be shared
 * by any number of both. `tenantId` is the one exception — a school never shares files.
 */
export const materials = sqliteTable(
  'materials',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    title: text('title').notNull(),
    type: text('type').notNull().default('notes'),
    url: text('url'),
    fileName: text('file_name'),
    fileKey: text('file_key'),
    favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
    addedAt: text('added_at'),
  },
  (t) => [index('idx_materials_tenant').on(t.tenantId)],
);

export const eventMaterials = sqliteTable(
  'event_materials',
  {
    tenantId: text('tenant_id').notNull(),
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
    index('idx_event_materials_tenant').on(t.tenantId),
  ],
);

/** Class ↔ material links. Many-to-many both ways: classes share materials, materials span classes. */
export const classMaterials = sqliteTable(
  'class_materials',
  {
    tenantId: text('tenant_id').notNull(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    materialId: text('material_id')
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.classId, t.materialId] }),
    index('idx_class_materials_material').on(t.materialId),
    index('idx_class_materials_tenant').on(t.tenantId),
  ],
);

/**
 * `code` stays globally unique on purpose. Redemption is unauthenticated — the visitor has no
 * session, so the code itself is what selects the school. `redeemInvite` reads `tenantId` from
 * the row it finds and stamps the new account with it.
 */
export const invites = sqliteTable(
  'invites',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
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
  },
  (t) => [index('idx_invites_tenant').on(t.tenantId)],
);

/**
 * School-wide preferences, one JSON blob per key. The primary key is `(tenantId, key)` because
 * the bare `key` was the single-school assumption at its most literal: one theme, one parent
 * portal switch, one tuition config for the whole deployment.
 */
export const settings = sqliteTable(
  'settings',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

/**
 * Monthly usage counters for metered external services (/logs/usage). `count` is calls;
 * `quantity` is the metric's own unit — audio seconds for speech-assess, tokens for a future
 * AI metric. Blind upserts: the month is the whole time axis.
 *
 * Counted per school, but note the physical quota (e.g. Azure F0) is platform-wide, so the
 * quota check sums across schools rather than reading one row.
 */
export const usageCounters = sqliteTable(
  'usage_counters',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    metric: text('metric').notNull(),
    count: integer('count').notNull().default(0),
    quantity: real('quantity').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.month, t.metric] })],
);

/**
 * `email` stays globally unique: an account belongs to exactly one school, so the same person
 * teaching at two of them holds two accounts. `isPlatformAdmin` is a column rather than a
 * hardcoded email list so a third platform admin needs no deploy.
 */
export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    email: text('email').notNull().unique(),
    /**
     * NOT NULL on purpose — a passwordless account (Zalo-only login) stores the `NO_PASSWORD`
     * sentinel from server/services/crypto.ts rather than a nullable column, so this table never
     * needs the rebuild migration 0045 needed for `tenants` (a DROP TABLE fires FK actions on D1).
     * `login()`/`changePassword()` route the sentinel to the same DUMMY_HASH path as a missing
     * account, so a passwordless account fails a password attempt with identical timing.
     */
    passwordHash: text('password_hash').notNull(),
    isPlatformAdmin: integer('is_platform_admin', { mode: 'boolean' }).notNull().default(false),
    staffId: text('staff_id').references(() => staff.id, { onDelete: 'set null' }),
    studentId: text('student_id').references(() => students.id, { onDelete: 'set null' }),
    parentId: text('parent_id').references(() => parents.id, { onDelete: 'set null' }),
    createdAt: text('created_at'),
    /** Canonical E.164 login phone for the Zalo OTP flow — see migrations/0051_login_methods.sql. */
    phoneE164: text('phone_e164'),
    /** Google's stable subject id, pinned on first successful Google sign-in. */
    googleSub: text('google_sub'),
    /** Set only by the pull-based /verify-email flow; cleared whenever `email` changes. Gates
     * the email-match branch of Google sign-in — see server/services/google-auth.ts. */
    emailVerifiedAt: text('email_verified_at'),
  },
  (t) => [
    index('idx_accounts_tenant').on(t.tenantId),
    index('idx_accounts_phone').on(t.phoneE164),
    uniqueIndex('idx_accounts_google_sub').on(t.googleSub),
  ],
);

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
    /**
     * The school a platform admin has "entered" from /platform, or NULL for their own. Honored
     * only when the account is a platform admin, so a stray value on a normal account is inert.
     * Lives on the session rather than in a second cookie so the mobile bearer path gets it for
     * free, and so each device switches independently.
     */
    activeTenantId: text('active_tenant_id'),
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

/**
 * Pull-based email verification — see migrations/0052_email_verifications.sql and
 * server/services/email.ts. `email` is a snapshot of the address the token was actually mailed
 * to, since `accounts.email` may change (and clear `emailVerifiedAt`) before the link is clicked.
 */
export const emailVerifications = sqliteTable('email_verifications', {
  tokenHash: text('token_hash').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  expiresAt: text('expires_at').notNull(),
  used: integer('used').notNull().default(0),
});

/**
 * Zalo OTP login/recovery challenges — see migrations/0051_login_methods.sql and
 * server/services/login-otp.ts, which is the only reader/writer of this table.
 *
 * `id` salts `codeHash` (SHA-256(id + ':' + code)) so a rainbow table cannot be precomputed once
 * for the whole table. `attempts` is a hard DB-backed ceiling independent of the DO rate limiter,
 * which fails open by design — this is the real backstop against guessing a 6-digit code.
 */
export const loginCodes = sqliteTable(
  'login_codes',
  {
    id: text('id').primaryKey(),
    phoneE164: text('phone_e164').notNull(),
    codeHash: text('code_hash').notNull(),
    /** 'login' | 'set-password'. A 'set-password' challenge never mints a session on its own —
     * see the otp-set-password intent (Phase 4). */
    purpose: text('purpose').notNull().default('login'),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    /** JSON array of the zalo_chats.chatId values the code was sent to — audit only. */
    chatIds: text('chat_ids').notNull().default('[]'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    verifiedAt: text('verified_at'),
    consumedAt: text('consumed_at'),
  },
  (t) => [
    index('idx_login_codes_phone').on(t.phoneE164),
    index('idx_login_codes_expires').on(t.expiresAt),
  ],
);

/**
 * `ref` stays globally unique: it is the handle on an issue in one GitHub repo, so "F-12" must
 * mean one thing there. Only the listing is per-school.
 */
export const feedback = sqliteTable(
  'feedback',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    message: text('message').notNull(),
    category: text('category').notNull().default('idea'),
    author: text('author'),
    status: text('status').notNull().default('new'),
    createdAt: text('created_at'),
    appVersion: text('app_version'),
    /** Short human handle, shown as "F-12". Assigned on insert, backfilled by 0041. */
    ref: integer('ref'),
    /** The GitHub issue `notifyFeedbackIssue` opened for this row, once it answers. */
    issueNumber: integer('issue_number'),
  },
  (t) => [
    index('idx_feedback_tenant_status').on(t.tenantId, t.status),
    uniqueIndex('idx_feedback_ref').on(t.ref),
  ],
);

export const scoreRecords = sqliteTable(
  'score_records',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
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
    index('idx_score_records_tenant_date').on(t.tenantId, t.date),
  ],
);

export const behaviorRecords = sqliteTable(
  'behavior_records',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
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
    index('idx_behavior_records_tenant_date').on(t.tenantId, t.date),
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
    tenantId: text('tenant_id').notNull(),
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
    index('idx_monthly_remarks_tenant_month').on(t.tenantId, t.month),
    index('idx_monthly_remarks_staff').on(t.staffId),
  ],
);

export const attendanceRecords = sqliteTable(
  'attendance_records',
  {
    tenantId: text('tenant_id').notNull(),
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
    index('idx_attendance_tenant_date').on(t.tenantId, t.date),
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
    tenantId: text('tenant_id').notNull(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    focusText: text('focus_text').notNull().default(''),
    vocabTopicId: text('vocab_topic_id').references(() => flashcardTopics.id, {
      onDelete: 'set null',
    }),
    /** "Bài tập về nhà" for THIS session — the check-in homework square's text. */
    homeworkText: text('homework_text').notNull().default(''),
    updatedAt: text('updated_at'),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.date] }),
    index('idx_session_previews_tenant_date').on(t.tenantId, t.date),
  ],
);

/**
 * A two-tier content pool, and the only kind of table where `tenantId` is nullable.
 *
 * NULL means the platform library: readable by every school, writable only by a platform admin.
 * A non-null value means the topic belongs to that school alone. Reads use `TenantDb.pool`,
 * which is the union; writes check ownership in the service.
 */
export const flashcardTopics = sqliteTable(
  'flashcard_topics',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id'),
    name: text('name').notNull(),
    slug: text('slug'),
    description: text('description'),
    color: text('color').notNull().default('violet'),
    /**
     * The book this deck is a unit of, or NULL for a free-standing deck — which is every row that
     * predates 0047. The deck IS the curriculum unit; there is no separate units table, because
     * everything downstream (games, assignments, garden, mastery, the mobile bundle) keys on this
     * row's id and inserting a level above it would repoint all of them for no visible gain.
     */
    curriculumId: text('curriculum_id').references(() => vocabCurricula.id, {
      onDelete: 'set null',
    }),
    /** Unit number within `curriculumId`. Meaningless without it, hence both nullable together. */
    unitNo: integer('unit_no'),
    createdAt: text('created_at'),
  },
  (t) => [
    index('idx_flashcard_topics_slug').on(t.slug),
    index('idx_flashcard_topics_tenant').on(t.tenantId),
    index('idx_flashcard_topics_curriculum').on(t.curriculumId, t.unitNo),
  ],
);

/**
 * A book a grade is taught from — "Tiếng Anh 9 Global Success", "i-Learn Smart World 9".
 *
 * Two-tier like `flashcardTopics`: `tenantId` NULL is the platform library that every school reads
 * through `db.pool()`, and a non-null value is that school's own private book. Writes to a library
 * row are refused in the service unless the caller is a platform admin — "can see it" and "may edit
 * it" are different questions.
 *
 * No `subjectId`: `subjects` is a per-school managed enum, so a platform-library row could not
 * point at one. Vocabulary is English here by construction.
 */
export const vocabCurricula = sqliteTable(
  'vocab_curricula',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id'),
    gradeLevelId: text('grade_level_id').references(() => gradeLevels.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    publisher: text('publisher'),
    description: text('description'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at'),
  },
  (t) => [
    index('idx_vocab_curricula_tenant').on(t.tenantId),
    index('idx_vocab_curricula_grade').on(t.gradeLevelId),
    index('idx_vocab_curricula_slug').on(t.slug),
  ],
);

/**
 * No `tenantId`: a word is reachable only through its topic, whose id is a UUID. Duplicating the
 * two-tier flag here would create an invariant that silently breaks the first time a platform
 * topic is cloned into a school.
 */
export const flashcardWords = sqliteTable(
  'flashcard_words',
  {
    id: text('id').primaryKey(),
    topicId: text('topic_id')
      .notNull()
      .references(() => flashcardTopics.id, { onDelete: 'cascade' }),
    /**
     * 1-based position inside its topic — the deck's numbering, and the only input to a batch label
     * ("1-10"). Written once by the INSERT (see `nextIndex` in services/flashcards.ts) and never
     * rewritten: a delete leaves a hole on purpose, so an assignment's "11-20" keeps meaning the
     * same words for as long as it exists. See migrations/0048_vocab_batches.sql.
     *
     * Do NOT order by `createdAt` instead — `insertWords` stamps one timestamp for a whole import,
     * so it is not an order. And do not tiebreak on `rowid`: VACUUM may renumber it.
     */
    sortOrder: integer('sort_order').notNull().default(0),
    word: text('word').notNull(),
    meaningVi: text('meaning_vi').notNull(),
    definitionEn: text('definition_en'),
    ipa: text('ipa'),
    /** 'n', 'adj', 'phr.v' … — as printed in the source textbook. Free text, not an enum. */
    partOfSpeech: text('part_of_speech'),
    /** One simple example sentence containing the word, or null. See 0036_vocab_examples.sql. */
    exampleEn: text('example_en'),
    /** The exact form of the word as used in exampleEn (may be inflected), or null. */
    exampleAnswer: text('example_answer'),
    audioUrl: text('audio_url'),
    /** R2 object key ("flashcards/<uuid>.<ext>"), not a URL — see 0033_flashcard_word_images.sql. */
    imageKey: text('image_key'),
    createdAt: text('created_at'),
  },
  (t) => [
    index('idx_flashcard_words_topic').on(t.topicId),
    uniqueIndex('uq_flashcard_words_order').on(t.topicId, t.sortOrder),
  ],
);

/**
 * The global semantic topic set — ONE list for the whole deployment (migration 0046).
 *
 * Not to be confused with `flashcardTopics`, which is a playable DECK. This is a TAG on a word:
 * Food, Travel, Environment. Deliberately has no `tenantId` — not even the nullable two-tier kind
 * `flashcardTopics` uses — because "Food & Cooking" means the same thing at every school. That also
 * keeps it out of the tripwire's TENANT_TABLES, so reads here need no `own()`/`pool()` fence.
 *
 * Seeded from VOCAB_TOPICS in shared/logic/vocab-topics.ts, which stays the source of record;
 * test/vocab-topics.test.ts fails if the two drift.
 */
export const vocabTopics = sqliteTable('vocab_topics', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameVi: text('name_vi').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

/**
 * A word's tags. No `tenantId`: reached only through a word, whose deck is already fenced — the
 * same reasoning that leaves `flashcardWords` without one.
 *
 * `vocabTopicId`, not `topicId`: everywhere else in this schema `topicId` means a DECK, so a join
 * that confuses the two compiles, runs, and quietly returns nothing.
 */
export const vocabWordTopics = sqliteTable(
  'vocab_word_topics',
  {
    wordId: text('word_id')
      .notNull()
      .references(() => flashcardWords.id, { onDelete: 'cascade' }),
    vocabTopicId: text('vocab_topic_id')
      .notNull()
      .references(() => vocabTopics.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.wordId, t.vocabTopicId] }),
    index('idx_vocab_word_topics_topic').on(t.vocabTopicId),
  ],
);

export const flashcardResults = sqliteTable(
  'flashcard_results',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
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
    index('idx_flashcard_results_tenant_played').on(t.tenantId, t.playedAt),
  ],
);

/**
 * PvP vocabulary battles (F33/F34, see docs/superpowers/specs/2026-08-25-vocab-pvp-design.md).
 * One row per finished match — a join-by-code GameRoom battle or a tabletop face-off duel.
 * `code` is '1V1' for a face-off, since no room ever existed for it.
 */
export const pvpMatches = sqliteTable(
  'pvp_matches',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    code: text('code').notNull(),
    topicId: text('topic_id')
      .notNull()
      .references(() => flashcardTopics.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    playedAt: text('played_at').notNull(),
  },
  (t) => [index('idx_pvp_matches_tenant_played').on(t.tenantId, t.playedAt)],
);

/**
 * No `tenantId`: a player row is reachable only through its match, which is already fenced.
 * `rank` is the finishing order within the match (1 = winner), and is the primary key's second
 * half — a match cannot record two players at the same rank.
 */
export const pvpMatchPlayers = sqliteTable(
  'pvp_match_players',
  {
    matchId: text('match_id')
      .notNull()
      .references(() => pvpMatches.id, { onDelete: 'cascade' }),
    studentId: text('student_id').references(() => students.id, { onDelete: 'cascade' }),
    staffId: text('staff_id').references(() => staff.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    score: integer('score').notNull(),
    correct: integer('correct').notNull(),
    total: integer('total').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.rank] }),
    index('idx_pvp_match_players_student').on(t.studentId),
  ],
);

/**
 * One row per installed mobile device. No `tenantId`: rows are only ever reached through their
 * account, and `expoToken` is physically global — one device, one token, whatever school it
 * happens to be signed into.
 */
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
 * Per-account preferences — see migrations/0043_user_settings.sql.
 *
 * The per-user twin of `settings` above. Same JSON-blob-per-key shape, keyed on the account
 * too, so one teacher's calendar theme is theirs alone (feedback F-19). Reads fall back to the
 * `settings` row of the same key — that fallback is what let this ship without copying data.
 *
 * No `tenantId`: the account carries the school, and every read is already keyed on it.
 *
 * Declared here rather than next to `settings` because the FK callback must not run before
 * `accounts` exists.
 */
export const userSettings = sqliteTable(
  'user_settings',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.key] })],
);

/**
 * Zalo Bot channel — see migrations/0027_zalo.sql.
 *
 * One row per paired Zalo conversation, keyed on Zalo's own `chat_id`. Exactly one of
 * accountId / parentId / classId is set; the invariant lives in server/services/zalo.ts because
 * SQLite cannot state it. `parentId` points at `parents` rather than `accounts` on purpose: this
 * link predates the parent portal, back when a parent account genuinely had no session — a
 * parent CAN log in now (Profile is their whole app, and since login-methods, Zalo OTP too), but
 * `parentId` is also how a FAMILY reaches the bot before any account exists at all, which
 * `accountId` alone could never cover.
 *
 * `chatId` stays globally unique — it is Zalo's own id for a conversation, and there is one bot.
 * `tenantId` records which school paired it, which is how the webhook resolves a school from an
 * inbound message with no session attached.
 */
export const zaloChats = sqliteTable(
  'zalo_chats',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
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
    index('idx_zalo_chats_tenant').on(t.tenantId),
  ],
);

/**
 * Single-use, expiring pairing codes. The code is the credential — see the migration. Like
 * `invites.code` it stays globally unique, because it is typed by someone with no session.
 */
export const zaloPairCodes = sqliteTable(
  'zalo_pair_codes',
  {
    code: text('code').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references(() => parents.id, { onDelete: 'cascade' }),
    studentId: text('student_id').references(() => students.id, { onDelete: 'cascade' }),
    classId: text('class_id').references(() => classes.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
  },
  (t) => [
    index('idx_zalo_pair_codes_expires').on(t.expiresAt),
    index('idx_zalo_pair_codes_tenant').on(t.tenantId),
  ],
);

/**
 * What has already been pushed, so a repeating cron sweep does not repeat itself.
 *
 * Key: `{kind}:{subjectId}:{occurrenceDate}` — see migrations/0015_notifications.sql. Shared by
 * both delivery channels: Zalo keys carry a `zalo-` prefix so enabling the second channel does
 * not find every occurrence already marked done by the first.
 *
 * The school moved into the primary key rather than into the string, so the dedupe guarantee is
 * structural and existing keys keep their meaning — no digest re-sends on deploy.
 */
export const sentNotifications = sqliteTable(
  'sent_notifications',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    sentAt: text('sent_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.key] }),
    index('idx_sent_notifications_sent_at').on(t.sentAt),
  ],
);

/** No `tenantId`: every query is keyed on a student, whose id is a UUID. */
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
/**
 * Khối — ONE global list for the whole deployment, not a per-school managed enum (migration 0049).
 *
 * Deliberately has no `tenantId`, so it is absent from the tripwire's TENANT_TABLES and reads need no
 * `own()`/`pool()` fence. Khối 6-9 is a national concept, identical at every school, and the
 * vocabulary curriculum library keys curricula by it — a platform-library curriculum could not point
 * at one school's copy. Writes are platform-admin-only; a school Admin sees the list read-only on
 * /config. `classes`, `tests` and `questions` all reference it ON DELETE SET NULL.
 */
export const gradeLevels = sqliteTable('grade_levels', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** The second two-tier pool, with the same NULL-means-platform-library rule as flashcardTopics. */
export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id'),
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
  (t) => [index('idx_questions_tenant_grade_level').on(t.tenantId, t.gradeLevelId)],
);

export const tests = sqliteTable(
  'tests',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
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
  (t) => [index('idx_tests_class').on(t.classId), index('idx_tests_tenant').on(t.tenantId)],
);

/** No `tenantId`: reached only through a test or a question, both of which are scoped. */
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
    tenantId: text('tenant_id').notNull(),
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
    index('idx_test_attempts_tenant_status').on(t.tenantId, t.status),
  ],
);

/** No `tenantId`: reached only through an attempt, which is scoped. */
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
    tenantId: text('tenant_id').notNull(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    /** Per session. */
    priceVnd: integer('price_vnd').notNull(),
    /** YYYY-MM-DD; applies to months whose 1st is >= this date. */
    effectiveFrom: text('effective_from').notNull(),
    createdAt: text('created_at'),
  },
  (t) => [
    unique('uq_class_prices').on(t.classId, t.effectiveFrom),
    index('idx_class_prices_tenant').on(t.tenantId),
  ],
);

/**
 * No row for a month means that month is open — per school, now that the primary key is
 * composite. One school closing March must not close it for everyone.
 */
export const tuitionMonths = sqliteTable(
  'tuition_months',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** YYYY-MM */
    month: text('month').notNull(),
    /** open | closed */
    status: text('status').notNull().default('open'),
    /** UTC ISO */
    closedAt: text('closed_at'),
    closedBy: text('closed_by'),
    /** JSON snapshot of the billable-status setting used at close, for audit. */
    billableStatuses: text('billable_statuses'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.month] })],
);

export const tuitionLines = sqliteTable(
  'tuition_lines',
  {
    id: text('id').primaryKey(),
    /**
     * Half of the composite foreign key to `tuitionMonths` — the cascade on it is what discards
     * frozen lines when a month is reopened. Drizzle cannot express a composite FK in the column
     * builder, so it lives in the migration only.
     */
    tenantId: text('tenant_id').notNull(),
    month: text('month').notNull(),
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
    unique('uq_tuition_lines').on(t.tenantId, t.month, t.studentId, t.classId),
    index('idx_tuition_lines_student').on(t.studentId, t.month),
    index('idx_tuition_lines_tenant_month').on(t.tenantId, t.month),
  ],
);

/**
 * Payment and one-off adjustment for a student-month. Deliberately outside the close snapshot:
 * money is collected after the month is closed, so these stay editable either way.
 */
export const tuitionStudentMonths = sqliteTable(
  'tuition_student_months',
  {
    tenantId: text('tenant_id').notNull(),
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
  (t) => [
    primaryKey({ columns: [t.month, t.studentId] }),
    index('idx_tuition_student_months_tenant').on(t.tenantId, t.month),
  ],
);

/**
 * Vườn cây từ vựng (vocabulary garden) — see migrations/0026_garden.sql.
 *
 * One plant per student, school-wide. Wilt and stage drops are DERIVED from elapsed time by
 * `settlePlant` in shared/logic/garden.ts, fenced by `dropsTaken`. Readers settle in memory and
 * never write, which is what keeps the student's own view, the class garden and the notification
 * sweep from ever disagreeing.
 */
export const gardenPlants = sqliteTable(
  'garden_plants',
  {
    studentId: text('student_id')
      .primaryKey()
      .references(() => students.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull(),
    plantName: text('plant_name'),
    /** App palette key, same vocabulary as students.color. */
    potColor: text('pot_color').notNull().default('orange'),
    /** Species id from shared/garden-art.ts; 'classic' is the drawing that predates species. */
    species: text('species').notNull().default('classic'),
    /** Reserved for pets — dormant, see docs/superpowers/specs/2026-08-18-garden-species-design.md. */
    companion: text('companion'),
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
  },
  (t) => [index('idx_garden_plants_tenant').on(t.tenantId)],
);

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
    tenantId: text('tenant_id').notNull(),
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
    index('idx_garden_events_tenant_day').on(t.tenantId, t.vnDay),
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
    tenantId: text('tenant_id').notNull(),
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
    /**
     * Which slices of the deck this covers: a canonical CSV of 1-based ranges over
     * `flashcardWords.sortOrder`, e.g. '1-10,21-30'. NULL and '' both mean the whole deck — which is
     * what every row written before 0048 means, so nothing was backfilled and no open homework
     * changed meaning. Same NULL-means-everything shape as `modes` below.
     *
     * Ranges, not batch numbers: '2,4' only means "batch 2 and 4" while the batch size is ten,
     * whereas '11-20' is self-describing. Always unions of whole windows — that invariant is what
     * lets every count downstream be a grouped per-batch query instead of a per-word list.
     *
     * Batches narrow what the student is asked to STUDY, not which rounds COUNT: a result records a
     * score, not a word list, so completion logic is untouched by this column.
     */
    batches: text('batches'),
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
    index('idx_vocab_assignments_tenant_deadline').on(t.tenantId, t.deadline),
  ],
);

/**
 * Cooperative class tree: +1 point per qualifying play by any member, counted even when that
 * student's own plant was capped, already at fruit, or dead. Effort always counts for the class.
 */
export const classTrees = sqliteTable(
  'class_trees',
  {
    classId: text('class_id')
      .primaryKey()
      .references(() => classes.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull(),
    points: integer('points').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('idx_class_trees_tenant').on(t.tenantId)],
);

/**
 * Month-end album. Names and plant state are denormalized into `data` because the album is a
 * keepsake: it must survive students leaving, classes being renamed, and plants growing on.
 */
export const gardenSnapshots = sqliteTable(
  'garden_snapshots',
  {
    tenantId: text('tenant_id').notNull(),
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
  (t) => [
    primaryKey({ columns: [t.classId, t.month] }),
    index('idx_garden_snapshots_tenant').on(t.tenantId),
  ],
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
    tenantId: text('tenant_id').notNull(),
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
    index('idx_activity_tenant').on(t.tenantId, t.id),
  ],
);

/**
 * Check-in/check-out activity types — the managed enum kiosk cells are built from
 * (subjects pattern, plus an icon and a palette color so the cells stay visually
 * stable for the kids week after week). See migrations/0038_checkin.sql.
 */
export const checkinActivityTypes = sqliteTable(
  'checkin_activity_types',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** src/icons.tsx IconName. */
    icon: text('icon').notNull().default('star'),
    /** App palette key, same vocabulary as students.color. */
    color: text('color').notNull().default('orange'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [unique().on(t.tenantId, t.name)],
);

/**
 * One checklist cell of one occurrence — keyed (eventId, date) like sessionPreviews,
 * because a weekly class is a single events row. `phase` is 'checkin' (home activities,
 * authored at the END of the previous session) or 'checkout' (what was learned, written
 * during the session). Rows are id-stable and individually CRUDed — never
 * delete-then-insert — because checklistChecks reference them and a teacher fixing a
 * typo must not wipe the kids' taps.
 *
 * No `tenantId`: every read is keyed on an event occurrence, and the event is scoped.
 */
export const checklistItems = sqliteTable(
  'checklist_items',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    /** 'checkin' | 'checkout' */
    phase: text('phase').notNull(),
    /** 'custom' = teacher-authored; 'homework' | 'vocab' = seeded by the /checkin loader. */
    kind: text('kind').notNull().default('custom'),
    /** Null for free-text checkout lines; check-in cells always pick a managed type. */
    activityTypeId: text('activity_type_id').references(() => checkinActivityTypes.id, {
      onDelete: 'set null',
    }),
    /** Per-session detail, e.g. "10 từ vựng chủ đề Animals". */
    label: text('label').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: text('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: text('created_at'),
  },
  (t) => [
    index('idx_checklist_items_occ').on(t.eventId, t.date, t.phase),
    // One special square of each kind per occurrence+phase — the seeding race collapses on this.
    uniqueIndex('uq_checklist_items_special')
      .on(t.eventId, t.date, t.phase, t.kind)
      .where(sql`kind <> 'custom'`),
  ],
);

/**
 * A student's tap on a checklist cell. The composite PK IS the idempotency: a double
 * tap is an ON CONFLICT DO NOTHING no-op, unchecking is a DELETE. No status column —
 * presence of the row is the check.
 */
export const checklistChecks = sqliteTable(
  'checklist_checks',
  {
    itemId: text('item_id')
      .notNull()
      .references(() => checklistItems.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    /** UTC ISO. */
    checkedAt: text('checked_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.studentId] }),
    index('idx_checklist_checks_student').on(t.studentId),
  ],
);

/**
 * Per-student narrowing of a vocab assignment. ZERO rows = the whole class — the meaning every
 * assignment written before 0053 keeps. No `tenantId`: reached only through its assignment,
 * which is scoped (the checklist_checks fence-through-parent pattern).
 */
export const vocabAssignmentStudents = sqliteTable(
  'vocab_assignment_students',
  {
    assignmentId: text('assignment_id')
      .notNull()
      .references(() => vocabAssignments.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.assignmentId, t.studentId] })],
);

/**
 * Túi mù (mystery bag) ledger — append-only, the gardenEvents pattern. A bag is a
 * moment the kid already celebrated on the kiosk, so it is STORED (config flips or
 * later checklist edits never revoke it) while misses are derived at read time and
 * self-correct. No FK to events on purpose: deleting an event must not un-earn a bag.
 * refId = "<eventId>:<date>:<kind>" — the natural key that makes replays no-ops.
 *
 * No `tenantId`: every read is keyed on a student, or on a list of students already scoped.
 */
export const tuiMuEvents = sqliteTable(
  'tui_mu_events',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    /** Denormalized snapshot for the class board; the event may be gone later. */
    classId: text('class_id'),
    /** The SESSION's ICT date — month attribution, even for a tap after midnight. */
    vnDay: text('vn_day').notNull(),
    /** 'checkin' | 'checkout' (per_phase mode) | 'perfect' (perfect_day mode). */
    kind: text('kind').notNull(),
    refId: text('ref_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    unique('uq_tui_mu_ref').on(t.studentId, t.refId),
    index('idx_tui_mu_student_day').on(t.studentId, t.vnDay),
  ],
);

/**
 * "Đã tặng quà" — a monthly gift tier handed out. tierBags + label are snapshotted at
 * redemption so an admin editing the tier table later doesn't rewrite what a child
 * already received; the unique triple makes the redeem button double-click safe.
 */
export const giftRedemptions = sqliteTable(
  'gift_redemptions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    /** YYYY-MM. */
    month: text('month').notNull(),
    tierBags: integer('tier_bags').notNull(),
    label: text('label'),
    staffId: text('staff_id').references(() => staff.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    unique('uq_gift_redemptions').on(t.studentId, t.month, t.tierBags),
    index('idx_gift_redemptions_tenant_month').on(t.tenantId, t.month),
  ],
);

/**
 * Mascot logo catalogue (migration 0056). Deliberately has NO `tenant_id`: this is shared
 * reference art, identical for every school and never edited from the app, so it is read with
 * the raw handle rather than through TenantDb. See migrations/0056_logo_library.sql.
 */
export const logoLibrary = sqliteTable(
  'logo_library',
  {
    /** The 16-hex content hash from the source filename; collision-free across the corpus. */
    id: text('id').primaryKey(),
    /** R2 key under FILES, e.g. 'logos/a746787047a05c50-quokka-2.webp'. */
    storageKey: text('storage_key').notNull().unique(),
    /** Full descriptive slug, e.g. 'deer-alert-round-eyes-left'. */
    slug: text('slug').notNull(),
    /** Level 1 — one of the 12 buckets in scripts/logo-taxonomy.mjs. */
    category: text('category').notNull(),
    /** Level 2 — the subject head noun, e.g. 'cat', 'whale', 'moka-pot'. */
    subject: text('subject').notNull(),
    /** Nth drawing of the same subject; 1 when the filename carries no trailing number. */
    variant: integer('variant').notNull().default(1),
    /** Flat backdrop the art was composed on — renders as a placeholder before the image loads. */
    backgroundColor: text('background_color').notNull(),
    sourceWidth: integer('source_width').notNull(),
    sourceHeight: integer('source_height').notNull(),
  },
  (t) => [
    index('idx_logo_library_category_subject').on(t.category, t.subject),
    index('idx_logo_library_subject').on(t.subject),
  ],
);

/* ─────────────────────────────────────────────────────────────────────────────
 * Practice (Nhiệm vụ) — migration 0057.
 *
 * Teacher-planned daily self-study tasks, copied per student, with proof submissions and the
 * miss economy (excuses, monthly quota, escalating ×N badge). Distinct from the dead `homework`
 * tables of 0001/0007. Every table carries `tenantId` so test/tenant-scope.test.ts fences it
 * automatically; the rules that read these rows live in shared/logic/practice.ts.
 * ───────────────────────────────────────────────────────────────────────────── */

/** One row per class that opted in. `weekdays` is a comma list of ICT weekday numbers (0=Sun). */
export const practiceSettings = sqliteTable(
  'practice_settings',
  {
    classId: text('class_id')
      .primaryKey()
      .references(() => classes.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    weekdays: text('weekdays').notNull().default('1,2,3,4,5,6'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_practice_settings_tenant').on(t.tenantId)],
);

/** A per-date decision that beats the weekday mask: true = practice day, false = day off. */
export const practiceDayOverrides = sqliteTable(
  'practice_day_overrides',
  {
    tenantId: text('tenant_id').notNull(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    isPractice: integer('is_practice', { mode: 'boolean' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.classId, t.date] }),
    index('idx_practice_day_overrides_tenant').on(t.tenantId),
  ],
);

/** The class-level task as the teacher typed it. Copies are what students see. */
export const practiceTasks = sqliteTable(
  'practice_tasks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    title: text('title').notNull(),
    /** SET NULL, not CASCADE: deleting a library file must not delete the task. */
    materialId: text('material_id').references(() => materials.id, { onDelete: 'set null' }),
    url: text('url'),
    proofType: text('proof_type').notNull().default('either'),
    sortOrder: integer('sort_order').notNull().default(0),
    staffId: text('staff_id').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_practice_tasks_class_date').on(t.classId, t.date),
    index('idx_practice_tasks_tenant').on(t.tenantId),
  ],
);

/**
 * One row per (student, task), carrying the submission itself — one submission per copy, a
 * resubmit overwrites it. `taskId` is NULL for a task added for one student only, and becomes
 * NULL when the class task is deleted after this copy was already submitted.
 */
export const practiceStudentTasks = sqliteTable(
  'practice_student_tasks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    taskId: text('task_id').references(() => practiceTasks.id, { onDelete: 'set null' }),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    title: text('title').notNull(),
    materialId: text('material_id').references(() => materials.id, { onDelete: 'set null' }),
    url: text('url'),
    proofType: text('proof_type').notNull().default('either'),
    sortOrder: integer('sort_order').notNull().default(0),
    /** open | submitted | accepted | rejected | teacher_done */
    status: text('status').notNull().default('open'),
    submittedAt: text('submitted_at'),
    /** ICT HH:mm, self-reported by the student's timer. */
    timeFrom: text('time_from'),
    timeTo: text('time_to'),
    mediaKey: text('media_key'),
    mediaType: text('media_type'),
    note: text('note'),
    feedback: text('feedback'),
    rejectReason: text('reject_reason'),
    reviewedAt: text('reviewed_at'),
    reviewedBy: text('reviewed_by').references(() => staff.id, { onDelete: 'set null' }),
    recordedByTeacher: integer('recorded_by_teacher', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    index('idx_practice_student_tasks_student_date').on(t.studentId, t.date),
    index('idx_practice_student_tasks_class_date').on(t.classId, t.date),
    index('idx_practice_student_tasks_status').on(t.status, t.submittedAt),
    index('idx_practice_student_tasks_tenant').on(t.tenantId),
  ],
);

/** A request to be excused for one practice day. At most one per (class, student, date). */
export const practiceExcuses = sqliteTable(
  'practice_excuses',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    reason: text('reason').notNull(),
    /** pending | approved | rejected */
    status: text('status').notNull().default('pending'),
    /** 'student' | 'teacher' — a teacher-made one is always already approved. */
    requestedBy: text('requested_by').notNull(),
    requestedAt: text('requested_at').notNull(),
    decidedAt: text('decided_at'),
    decidedBy: text('decided_by').references(() => staff.id, { onDelete: 'set null' }),
  },
  (t) => [
    unique('uq_practice_excuses').on(t.classId, t.studentId, t.date),
    index('idx_practice_excuses_status').on(t.status, t.requestedAt),
    index('idx_practice_excuses_tenant').on(t.tenantId),
  ],
);

/**
 * One row per missed practice day, written only by the nightly finalize job (or flipped to
 * excused by a teacher afterwards). `multiplier` is the ×N this miss imposed on the next day.
 */
export const practiceMisses = sqliteTable(
  'practice_misses',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    excused: integer('excused', { mode: 'boolean' }).notNull().default(false),
    multiplier: integer('multiplier').notNull().default(0),
    behaviorRecordId: text('behavior_record_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    unique('uq_practice_misses').on(t.classId, t.studentId, t.date),
    index('idx_practice_misses_student').on(t.studentId, t.date),
    index('idx_practice_misses_tenant').on(t.tenantId),
  ],
);

/**
 * The escalation state per (class, student). `level` counts unexcused misses since the teacher
 * last cleared the warning; `pendingMultiplier`/`pendingForDate` are the ×N currently owed.
 */
export const practiceWarnings = sqliteTable(
  'practice_warnings',
  {
    tenantId: text('tenant_id').notNull(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    level: integer('level').notNull().default(0),
    pendingMultiplier: integer('pending_multiplier').notNull().default(0),
    pendingForDate: text('pending_for_date'),
    pendingFromMiss: text('pending_from_miss'),
    updatedAt: text('updated_at').notNull(),
    clearedAt: text('cleared_at'),
    clearedBy: text('cleared_by').references(() => staff.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ columns: [t.classId, t.studentId] }),
    index('idx_practice_warnings_tenant').on(t.tenantId),
  ],
);
