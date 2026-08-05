-- Monthly remark (nhận xét tháng): one teacher-written report per (student, month).
--
-- Four 1-5 ratings plus a free-text comment. The numbers shown alongside the remark — the
-- month's average score, how many tests, how many incidents — are computed live from
-- score_records / behavior_records and deliberately NOT stored here: a stored copy would
-- drift the moment a score is corrected, and a report that disagrees with the records screen
-- is worse than no report.
--
-- The UNIQUE pair is the identity of a report. Saving again for the same student and month is
-- an update, never a second report, and the service upserts on it.
CREATE TABLE monthly_remarks (
  id            TEXT PRIMARY KEY,
  student_id    TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  month         TEXT NOT NULL,              -- YYYY-MM
  attitude      INTEGER NOT NULL,           -- thái độ học tập, 1-5
  homework      INTEGER NOT NULL,           -- bài tập về nhà, 1-5
  participation INTEGER NOT NULL,           -- tham gia phát biểu, 1-5
  progress      INTEGER NOT NULL,           -- tiến bộ, 1-5
  comment       TEXT,                       -- nhận xét của giáo viên
  UNIQUE (student_id, month)
);
-- No index on student_id: it is the prefix of the UNIQUE pair, which SQLite can already use.
CREATE INDEX idx_monthly_remarks_month ON monthly_remarks(month);
