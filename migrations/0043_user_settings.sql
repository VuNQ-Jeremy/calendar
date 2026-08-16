-- Per-account preferences — the per-user twin of the school-wide `settings` k/v table.
--
-- `settings` is keyed by a single string, so the calendar theme, the UI prefs and the
-- notification prefs were all school-wide: one teacher recolouring the calendar recoloured it
-- for everyone (feedback F-19, issue #17). This is the same get-and-set-a-JSON-blob shape,
-- keyed on the account as well as the key.
--
-- Reads fall back to the `settings` row of the same key, so the school's existing choices stay
-- everybody's starting point and no data has to be copied here.
--
-- FK/cascade copied from `push_tokens`: a deleted account takes its preferences with it. No
-- separate index on account_id — the composite PRIMARY KEY already gives SQLite an index with
-- account_id leading, which is the shape of every read the service issues.
CREATE TABLE user_settings (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (account_id, key)
);
