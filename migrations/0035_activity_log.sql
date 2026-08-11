-- Activity / audit log: one append-only row per mutation, page view, and auth event, across every
-- actor (staff/student/parent web sessions, the mobile JSON API, the daily crons, and Zalo). The
-- goal is to answer four questions without reading code: who did this, what did the record look
-- like before, is this account being attacked, and which screens actually get used.
--
-- Deliberately ONE table rather than several: the four purposes above share the same shape (who,
-- when, from where, what) closely enough that splitting them would just mean joining them back
-- together for the stream view. `id` is autoincrement (the one other precedent is
-- class_schedule.id) because a monotonic int is a cheap cursor for pagination and a cheap ORDER BY
-- for the retention purge — neither needs the row's UUID-per-domain-object convention.
--
-- No foreign keys on purpose: the log must outlive the people, sessions and records it describes,
-- so `account_id`/`actor_id`/`entity_id` are plain TEXT and `actor_name` is denormalized rather than
-- joined at read time.
--
-- Exactly four indexes — server/db/index.ts's D1_MAX_BOUND_PARAMS math (see audit.ts) treats each
-- index as its own row-write per insert, so adding a fifth is a real cost, not a free win.
CREATE TABLE activity_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Client-supplied time for beacon/mobile-outbox rows (never trusted for anything but display);
  -- equals recorded_at for everything captured server-side.
  occurred_at  TEXT NOT NULL,
  -- Server write time, ISO 8601 UTC. What every query and the retention purge sort/filter on.
  recorded_at  TEXT NOT NULL,
  source       TEXT NOT NULL, -- 'web' | 'api' | 'beacon' | 'cron' | 'zalo'
  actor_kind   TEXT NOT NULL, -- 'staff' | 'student' | 'parent' | 'system' | 'anon'
  actor_id     TEXT,          -- staff/student/parent row id — survives the account being deleted
  actor_name   TEXT,          -- denormalized display name, same reason
  account_id   TEXT,          -- accounts.id, no FK — sessions/security views key on this
  session_ref  TEXT,          -- first 16 hex chars of sessions.token (already a SHA-256 hash)
  ip           TEXT,          -- CF-Connecting-IP
  user_agent   TEXT,          -- truncated to 256 chars
  action       TEXT NOT NULL, -- create | update | delete | mutation | view | login | login_failed
                              -- | logout | password_change | password_reset | invite_redeem
  domain       TEXT,          -- shared/live.ts MutationDomain, nullable
  entity_type  TEXT,          -- lowercase singular: student, event, class, material, ...
  entity_id    TEXT,
  route        TEXT,          -- request pathname, or the beacon's reported path
  intent       TEXT,          -- form intent, or the HTTP method for API writes
  status       INTEGER,       -- HTTP status of the wrapping response
  before_json  TEXT,          -- redacted, size-capped snapshot — see audit.ts snapshotJson
  after_json   TEXT,
  meta_json    TEXT
);
CREATE INDEX idx_activity_entity  ON activity_log(entity_type, entity_id, id);
CREATE INDEX idx_activity_account ON activity_log(account_id, id);
CREATE INDEX idx_activity_action  ON activity_log(action, id);
CREATE INDEX idx_activity_time    ON activity_log(recorded_at);

-- Security-view columns. Nullable: rows from before this migration have neither, and the security
-- view must render that gracefully rather than treating it as suspicious.
ALTER TABLE sessions ADD COLUMN created_at TEXT;
ALTER TABLE sessions ADD COLUMN ip TEXT;
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
