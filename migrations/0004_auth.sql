ALTER TABLE accounts ADD COLUMN student_id TEXT REFERENCES students(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD COLUMN parent_id  TEXT REFERENCES parents(id)  ON DELETE SET NULL;
ALTER TABLE invites  ADD COLUMN used_by    TEXT REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE invites  ADD COLUMN used_at    TEXT;

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);
