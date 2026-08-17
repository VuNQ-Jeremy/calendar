-- Multi-tenancy, step 1 of 1 on the schema side.
--
-- Every table that is ever read without already being fenced by a scoped parent id gets a
-- `tenant_id`, and every UNIQUE / PRIMARY KEY that silently assumed "one school" becomes
-- composite. All existing rows belong to the original school, `tnt_mochi_0001` — the literal
-- is mirrored in server/db/tenant.ts as PRIMARY_TENANT_ID and appears in exactly three places
-- (here, there, and the test/seed SQL).
--
-- Two shapes are used, deliberately:
--
--   * ALTER TABLE ... ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001'
--     SQLite allows a NOT NULL add when the default is a constant, which makes the backfill
--     free (existing rows read the default) and the statement O(1). The cost is that these
--     columns carry no REFERENCES clause — a FK would force a NULL default — so tenant
--     deletion is a code-level concern, and a future insert that forgets tenant_id lands in
--     the original school rather than failing. server/db/tenant.ts is what closes that: the
--     wrapper is the only sanctioned way to insert.
--
--   * Full table rebuild (create / copy / drop / rename) for the eleven tables whose
--     constraint itself is the blocker. An inline UNIQUE is a sqlite_autoindex and cannot be
--     dropped, and a PRIMARY KEY cannot be widened in place. These get the real
--     REFERENCES tenants(id) ON DELETE CASCADE for free.
--
-- Tables deliberately WITHOUT tenant_id are reached exclusively through a scoped parent whose
-- id is a UUID, so they cannot collide or leak across schools: password_resets, user_settings,
-- push_tokens, class_schedule (dormant), flashcard_words (via topic), flashcard_mastery (via
-- student), test_questions / test_answers (via test / attempt), checklist_items /
-- checklist_checks (via event), tui_mu_events (via student).
--
-- Kept globally unique on purpose: accounts.email (one account, one school), invites.code and
-- zalo_pair_codes.code (typed by an anonymous visitor — the code IS the school selector),
-- zalo_chats.chat_id and push_tokens.expo_token (physically global), feedback.ref (one GitHub
-- repo).

PRAGMA defer_foreign_keys = true;

-- ---------------------------------------------------------------------------
-- 1. The tenants table, and the original school.
-- ---------------------------------------------------------------------------

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  -- URL/analytics handle, generated from the name at signup. Internal only: there is no
  -- subdomain routing, a school is chosen by the account that logs in.
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- 'active' | 'suspended'. Suspension is enforced in userFromToken, so it kills live
  -- sessions as well as blocking login.
  status TEXT NOT NULL DEFAULT 'active',
  -- Reviewed by a platform admin on /platform. Informational in v1: nothing is gated on it
  -- until there is an email provider to verify against.
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  -- Escape hatch for per-school meta (plan, limits, per-tenant integration tokens) until any
  -- of it earns a column.
  settings_json TEXT
);

INSERT INTO tenants (id, slug, name, status, verified, created_at)
VALUES ('tnt_mochi_0001', 'mochi', 'Mochi', 'active', 1, datetime('now') || 'Z');

-- ---------------------------------------------------------------------------
-- 2. Plain column adds. Existing rows backfill via the default.
-- ---------------------------------------------------------------------------

-- People and org
ALTER TABLE staff ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE students ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE parents ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE classes ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE invites ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';

-- Junctions. These carry a denormalized tenant_id rather than joining to their parent because
-- the repo's read pattern is "fetch the whole junction, assemble in JS" (classes.list and
-- friends) — rewriting those scans as correlated subqueries would be a far larger diff than
-- one column the insert wrapper keeps honest.
ALTER TABLE class_students ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE parent_students ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE event_materials ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE class_materials ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';

-- Calendar and content
ALTER TABLE events ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE materials ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE session_previews ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';

-- Assessment and reporting
ALTER TABLE score_records ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE behavior_records ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE monthly_remarks ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE attendance_records ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE tests ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE test_attempts ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';

-- Vocabulary and garden
ALTER TABLE flashcard_results ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE vocab_assignments ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE garden_plants ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE garden_events ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE class_trees ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE garden_snapshots ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE gift_redemptions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';

-- Tuition
ALTER TABLE class_prices ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE tuition_student_months ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';

-- Ops and messaging
ALTER TABLE feedback ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE activity_log ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE zalo_chats ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE zalo_pair_codes ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';

-- ---------------------------------------------------------------------------
-- 3. Auth. accounts.tenant_id is the account's home school; sessions.active_tenant_id is the
--    platform-admin "entered another school" override, honored only for platform admins.
-- ---------------------------------------------------------------------------

ALTER TABLE accounts ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tnt_mochi_0001';
ALTER TABLE accounts ADD COLUMN is_platform_admin INTEGER NOT NULL DEFAULT 0;
UPDATE accounts SET is_platform_admin = 1 WHERE email IN ('dev@mochi.edu', 'admin@mochi.edu');

ALTER TABLE sessions ADD COLUMN active_tenant_id TEXT;

-- ---------------------------------------------------------------------------
-- 4. Two-tier content pools. NULL means the platform library: readable by every school,
--    writable only by a platform admin. Today's content is the original school's own, not
--    the library — promoting a topic or a question is a later, deliberate act.
-- ---------------------------------------------------------------------------

ALTER TABLE flashcard_topics ADD COLUMN tenant_id TEXT;
UPDATE flashcard_topics SET tenant_id = 'tnt_mochi_0001';

ALTER TABLE questions ADD COLUMN tenant_id TEXT;
UPDATE questions SET tenant_id = 'tnt_mochi_0001';

-- ---------------------------------------------------------------------------
-- 5. Rebuilds: the six managed enums. Their inline UNIQUE(name) is what stops two schools
--    from both having a subject called "Toán", and an autoindex cannot be dropped.
-- ---------------------------------------------------------------------------

CREATE TABLE subjects_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, name)
);
INSERT INTO subjects_new (id, tenant_id, name, active, sort_order)
  SELECT id, 'tnt_mochi_0001', name, active, sort_order FROM subjects;
DROP TABLE subjects;
ALTER TABLE subjects_new RENAME TO subjects;

CREATE TABLE class_levels_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, name)
);
INSERT INTO class_levels_new (id, tenant_id, name, active, sort_order)
  SELECT id, 'tnt_mochi_0001', name, active, sort_order FROM class_levels;
DROP TABLE class_levels;
ALTER TABLE class_levels_new RENAME TO class_levels;

CREATE TABLE grade_levels_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, name)
);
INSERT INTO grade_levels_new (id, tenant_id, name, active, sort_order)
  SELECT id, 'tnt_mochi_0001', name, active, sort_order FROM grade_levels;
DROP TABLE grade_levels;
ALTER TABLE grade_levels_new RENAME TO grade_levels;

CREATE TABLE assessment_types_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, name)
);
INSERT INTO assessment_types_new (id, tenant_id, name, active, sort_order)
  SELECT id, 'tnt_mochi_0001', name, active, sort_order FROM assessment_types;
DROP TABLE assessment_types;
ALTER TABLE assessment_types_new RENAME TO assessment_types;

CREATE TABLE remark_criteria_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, name)
);
INSERT INTO remark_criteria_new (id, tenant_id, name, active, sort_order)
  SELECT id, 'tnt_mochi_0001', name, active, sort_order FROM remark_criteria;
DROP TABLE remark_criteria;
ALTER TABLE remark_criteria_new RENAME TO remark_criteria;

CREATE TABLE checkin_activity_types_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'star',
  color TEXT NOT NULL DEFAULT 'orange',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, name)
);
INSERT INTO checkin_activity_types_new (id, tenant_id, name, icon, color, active, sort_order)
  SELECT id, 'tnt_mochi_0001', name, icon, color, active, sort_order FROM checkin_activity_types;
DROP TABLE checkin_activity_types;
ALTER TABLE checkin_activity_types_new RENAME TO checkin_activity_types;

-- ---------------------------------------------------------------------------
-- 6. Rebuilds: the singleton key/value and ledger tables. Their PRIMARY KEY was the
--    single-school assumption made structural — one theme, one month-close, one usage
--    counter, one notification dedupe ledger for the whole deployment.
-- ---------------------------------------------------------------------------

CREATE TABLE settings_new (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
INSERT INTO settings_new (tenant_id, key, value)
  SELECT 'tnt_mochi_0001', key, value FROM settings;
DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;

CREATE TABLE usage_counters_new (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  metric TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, month, metric)
);
INSERT INTO usage_counters_new (tenant_id, month, metric, count, quantity)
  SELECT 'tnt_mochi_0001', month, metric, count, quantity FROM usage_counters;
DROP TABLE usage_counters;
ALTER TABLE usage_counters_new RENAME TO usage_counters;

-- The key format is unchanged, so no digest re-sends on deploy; the tenant moves into the
-- primary key instead of into the string.
CREATE TABLE sent_notifications_new (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
INSERT INTO sent_notifications_new (tenant_id, key, sent_at)
  SELECT 'tnt_mochi_0001', key, sent_at FROM sent_notifications;
DROP TABLE sent_notifications;
ALTER TABLE sent_notifications_new RENAME TO sent_notifications;
CREATE INDEX idx_sent_notifications_sent_at ON sent_notifications(sent_at);

-- ---------------------------------------------------------------------------
-- 7. Tuition. tuition_months is rebuilt and renamed FIRST so that tuition_lines' composite
--    foreign key resolves against a parent that already has the (tenant_id, month) key —
--    SQLite raises "foreign key mismatch" at insert time otherwise, and deferring does not
--    help because that is a schema error, not a constraint violation.
--
--    The cascade matters: reopening a month deletes its tuition_months row, and that is what
--    discards the frozen lines.
-- ---------------------------------------------------------------------------

CREATE TABLE tuition_months_new (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  closed_at TEXT,
  closed_by TEXT,
  billable_statuses TEXT,
  PRIMARY KEY (tenant_id, month)
);
INSERT INTO tuition_months_new (tenant_id, month, status, closed_at, closed_by, billable_statuses)
  SELECT 'tnt_mochi_0001', month, status, closed_at, closed_by, billable_statuses FROM tuition_months;
DROP TABLE tuition_months;
ALTER TABLE tuition_months_new RENAME TO tuition_months;

CREATE TABLE tuition_lines_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  month TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,
  class_name TEXT NOT NULL,
  sessions INTEGER NOT NULL,
  dates TEXT NOT NULL DEFAULT '[]',
  status_counts TEXT NOT NULL DEFAULT '{}',
  unit_price_vnd INTEGER NOT NULL,
  amount_vnd INTEGER NOT NULL,
  FOREIGN KEY (tenant_id, month) REFERENCES tuition_months(tenant_id, month) ON DELETE CASCADE,
  UNIQUE (tenant_id, month, student_id, class_id)
);
INSERT INTO tuition_lines_new (
  id, tenant_id, month, student_id, class_id, class_name, sessions, dates, status_counts,
  unit_price_vnd, amount_vnd
)
  SELECT id, 'tnt_mochi_0001', month, student_id, class_id, class_name, sessions, dates,
         status_counts, unit_price_vnd, amount_vnd
  FROM tuition_lines;
DROP TABLE tuition_lines;
ALTER TABLE tuition_lines_new RENAME TO tuition_lines;
CREATE INDEX idx_tuition_lines_student ON tuition_lines(student_id, month);
CREATE INDEX idx_tuition_lines_tenant_month ON tuition_lines(tenant_id, month);

-- ---------------------------------------------------------------------------
-- 8. feedback.ref is a named index rather than an inline constraint, so it needs no rebuild.
--    It stays GLOBALLY unique: a ref is the handle on an issue in one GitHub repo, and
--    "F-12" must mean one thing there. Only the listing is per-school.
-- ---------------------------------------------------------------------------

-- (idx_feedback_ref is left exactly as it is — recorded here so the omission reads as a
-- decision rather than an oversight.)

-- ---------------------------------------------------------------------------
-- 9. Indexes. A tenant-only index where the query is "everything in this school", and a
--    composite where an existing hot predicate follows — the composite supersedes the old
--    single-column index, which is dropped to keep write amplification flat.
-- ---------------------------------------------------------------------------

CREATE INDEX idx_staff_tenant ON staff(tenant_id);
CREATE INDEX idx_students_tenant ON students(tenant_id);
CREATE INDEX idx_parents_tenant ON parents(tenant_id);
CREATE INDEX idx_classes_tenant ON classes(tenant_id);
CREATE INDEX idx_materials_tenant ON materials(tenant_id);
CREATE INDEX idx_invites_tenant ON invites(tenant_id);
CREATE INDEX idx_accounts_tenant ON accounts(tenant_id);
CREATE INDEX idx_class_students_tenant ON class_students(tenant_id);
CREATE INDEX idx_parent_students_tenant ON parent_students(tenant_id);
CREATE INDEX idx_event_materials_tenant ON event_materials(tenant_id);
CREATE INDEX idx_class_materials_tenant ON class_materials(tenant_id);
CREATE INDEX idx_class_prices_tenant ON class_prices(tenant_id);
CREATE INDEX idx_class_trees_tenant ON class_trees(tenant_id);
CREATE INDEX idx_garden_plants_tenant ON garden_plants(tenant_id);
CREATE INDEX idx_flashcard_topics_tenant ON flashcard_topics(tenant_id);
CREATE INDEX idx_zalo_chats_tenant ON zalo_chats(tenant_id);
CREATE INDEX idx_zalo_pair_codes_tenant ON zalo_pair_codes(tenant_id);
CREATE INDEX idx_garden_snapshots_tenant ON garden_snapshots(tenant_id);

DROP INDEX idx_events_date;
CREATE INDEX idx_events_tenant_date ON events(tenant_id, date);

DROP INDEX idx_feedback_status;
CREATE INDEX idx_feedback_tenant_status ON feedback(tenant_id, status);

DROP INDEX idx_monthly_remarks_month;
CREATE INDEX idx_monthly_remarks_tenant_month ON monthly_remarks(tenant_id, month);

DROP INDEX idx_session_previews_date;
CREATE INDEX idx_session_previews_tenant_date ON session_previews(tenant_id, date);

DROP INDEX idx_gift_redemptions_month;
CREATE INDEX idx_gift_redemptions_tenant_month ON gift_redemptions(tenant_id, month);

DROP INDEX idx_questions_grade_level;
CREATE INDEX idx_questions_tenant_grade_level ON questions(tenant_id, grade_level_id);

CREATE INDEX idx_score_records_tenant_date ON score_records(tenant_id, date);
CREATE INDEX idx_behavior_records_tenant_date ON behavior_records(tenant_id, date);
CREATE INDEX idx_attendance_tenant_date ON attendance_records(tenant_id, date);
CREATE INDEX idx_flashcard_results_tenant_played ON flashcard_results(tenant_id, played_at);
CREATE INDEX idx_vocab_assignments_tenant_deadline ON vocab_assignments(tenant_id, deadline);
CREATE INDEX idx_garden_events_tenant_day ON garden_events(tenant_id, vn_day);
CREATE INDEX idx_test_attempts_tenant_status ON test_attempts(tenant_id, status);
CREATE INDEX idx_tests_tenant ON tests(tenant_id);
CREATE INDEX idx_tuition_student_months_tenant ON tuition_student_months(tenant_id, month);
CREATE INDEX idx_activity_tenant ON activity_log(tenant_id, id);
