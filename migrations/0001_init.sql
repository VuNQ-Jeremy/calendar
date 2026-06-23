-- Mochi LMS — initial schema (Cloudflare D1 / SQLite)
--
-- Mirrors the data model the app currently keeps in localStorage (see
-- src/store.js). Many-to-many links (class rosters, parent↔student) live in
-- dedicated join tables; the Worker assembles them back into the nested arrays
-- the frontend expects (class.studentIds, student.classIds, etc.).

-- ---- Core entities ----------------------------------------------------------

CREATE TABLE staff (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  email TEXT,
  role  TEXT NOT NULL DEFAULT 'Teacher',
  color TEXT NOT NULL DEFAULT 'orange',
  phone TEXT
);

CREATE TABLE students (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  grade    TEXT,
  guardian TEXT,
  email    TEXT,
  color    TEXT NOT NULL DEFAULT 'blue'
);

CREATE TABLE parents (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  email    TEXT,
  phone    TEXT,
  color    TEXT NOT NULL DEFAULT 'green',
  relation TEXT
);

CREATE TABLE classes (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  subject TEXT,
  color   TEXT NOT NULL DEFAULT 'green',
  room    TEXT
);

-- ---- Class relations --------------------------------------------------------

CREATE TABLE class_schedule (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  day        INTEGER NOT NULL,          -- 0=Sun … 6=Sat
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL
);
CREATE INDEX idx_class_schedule_class ON class_schedule(class_id);

CREATE TABLE class_students (
  class_id   TEXT NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, student_id)
);
CREATE INDEX idx_class_students_student ON class_students(student_id);

CREATE TABLE parent_students (
  parent_id  TEXT NOT NULL REFERENCES parents(id)  ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (parent_id, student_id)
);
CREATE INDEX idx_parent_students_student ON parent_students(student_id);

-- ---- Calendar / coursework --------------------------------------------------

CREATE TABLE events (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  date       TEXT NOT NULL,             -- YYYY-MM-DD
  start_time TEXT,
  end_time   TEXT,
  color      TEXT,
  class_id   TEXT REFERENCES classes(id) ON DELETE SET NULL,
  location   TEXT,
  recurrence TEXT NOT NULL DEFAULT 'none'  -- none | daily | weekly
);
CREATE INDEX idx_events_date ON events(date);

CREATE TABLE homework (
  id       TEXT PRIMARY KEY,
  title    TEXT NOT NULL,
  class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
  due      TEXT,
  points   INTEGER,
  notes    TEXT,
  color    TEXT,
  done     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE materials (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  type      TEXT NOT NULL DEFAULT 'notes',  -- notes | worksheet | video | link
  class_id  TEXT REFERENCES classes(id) ON DELETE SET NULL,
  url       TEXT,
  file_name TEXT,
  favorite  INTEGER NOT NULL DEFAULT 0,
  added_at  TEXT
);

CREATE TABLE invites (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL,              -- Student | Staff | Parent
  name       TEXT,
  class_id   TEXT REFERENCES classes(id) ON DELETE SET NULL,
  created_at TEXT,
  used       INTEGER NOT NULL DEFAULT 0
);

-- ---- App settings (calendar theme, etc.) -----------------------------------

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                    -- JSON blob
);

-- ---- Authentication (tables ready; enforcement wired in a later step) -------

CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  staff_id      TEXT REFERENCES staff(id) ON DELETE SET NULL,
  created_at    TEXT
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_account ON sessions(account_id);
