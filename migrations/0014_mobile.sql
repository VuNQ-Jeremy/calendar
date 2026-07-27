-- Expo push registration. One row per installed device.
-- expo_token is UNIQUE so re-installing, or switching accounts on the same handset,
-- MOVES the token rather than creating a duplicate row (see server/services/push.ts).
CREATE TABLE push_tokens (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expo_token   TEXT NOT NULL UNIQUE,
  platform     TEXT NOT NULL DEFAULT 'android',
  created_at   TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE INDEX idx_push_tokens_account ON push_tokens(account_id);

-- Idempotency key for flashcard results replayed from the mobile offline outbox.
--
-- Load-bearing: a flush that succeeds on the server but drops on the way back gets retried,
-- and without this the student's score would be counted twice. With it, the outbox can retry
-- blindly. Partial index so existing rows (and every web play) keep a NULL client_id.
ALTER TABLE flashcard_results ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX idx_flashcard_results_client_id
  ON flashcard_results(client_id) WHERE client_id IS NOT NULL;
