-- Tuition module: turn attendance into a monthly fee (học phí).
--
-- Per-session pricing per class, effective-dated so raising a price never reprices a month that
-- has already been billed. A month is computed live from attendance until an admin closes it,
-- which freezes the numbers into tuition_lines. Payments and adjustments sit outside that
-- snapshot because money is collected after the month is closed.
--
-- All amounts are integer VND. No floats anywhere in this module.

CREATE TABLE class_prices (
  id             TEXT PRIMARY KEY,
  class_id       TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  price_vnd      INTEGER NOT NULL,  -- per session
  effective_from TEXT NOT NULL,     -- YYYY-MM-DD; applies to months whose 1st is >= this date
  created_at     TEXT,
  UNIQUE (class_id, effective_from)
);

-- One row per month that has ever been closed. No row at all = the month is open.
CREATE TABLE tuition_months (
  month             TEXT PRIMARY KEY,              -- YYYY-MM
  status            TEXT NOT NULL DEFAULT 'open',  -- open | closed
  closed_at         TEXT,                          -- UTC ISO
  closed_by         TEXT,                          -- staff name, informational only
  billable_statuses TEXT                           -- JSON snapshot of the setting used at close
);

-- Frozen fee lines, written only by "close month".
-- class_id carries no foreign key and class_name is denormalized on purpose: this is a financial
-- record and must survive a class being renamed or deleted.
CREATE TABLE tuition_lines (
  id             TEXT PRIMARY KEY,
  month          TEXT NOT NULL REFERENCES tuition_months(month) ON DELETE CASCADE,
  student_id     TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id       TEXT NOT NULL,
  class_name     TEXT NOT NULL,
  sessions       INTEGER NOT NULL,               -- billable count
  status_counts  TEXT NOT NULL DEFAULT '{}',     -- JSON {"present":10,"late":1,...} for the slip
  unit_price_vnd INTEGER NOT NULL,
  amount_vnd     INTEGER NOT NULL,               -- sessions * unit_price_vnd
  UNIQUE (month, student_id, class_id)
);
CREATE INDEX idx_tuition_lines_student ON tuition_lines(student_id, month);

-- Payment + one-off adjustment, one upserted row per (month, student). Deliberately outside the
-- close snapshot so a closed month can still record who paid.
CREATE TABLE tuition_student_months (
  month           TEXT NOT NULL,
  student_id      TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  adjustment_vnd  INTEGER NOT NULL DEFAULT 0,  -- signed
  adjustment_note TEXT,
  paid_vnd        INTEGER NOT NULL DEFAULT 0,
  paid_at         TEXT,                        -- YYYY-MM-DD, last payment date
  payment_note    TEXT,
  PRIMARY KEY (month, student_id)
);

-- The month computation scans attendance by date range. The existing indexes are the
-- (event_id, date, student_id) primary key and (student_id, date) — neither serves a bare
-- date-range scan.
CREATE INDEX idx_attendance_date ON attendance_records(date);
