-- Login methods rework: additive columns only. NO table rebuild — a DROP TABLE fires FK actions
-- on D1 (0045's tenants rebuild is the cautionary precedent, not the template, for `accounts`).
-- `password_hash` stays NOT NULL; passwordless accounts store the sentinel '!' (crypto.ts
-- NO_PASSWORD), which verifyPassword can never match.
ALTER TABLE accounts ADD COLUMN phone_e164 TEXT;
ALTER TABLE accounts ADD COLUMN google_sub TEXT;
ALTER TABLE accounts ADD COLUMN email_verified_at TEXT;
CREATE INDEX idx_accounts_phone ON accounts(phone_e164);
CREATE UNIQUE INDEX idx_accounts_google_sub ON accounts(google_sub);

ALTER TABLE parents ADD COLUMN phone_e164 TEXT;
CREATE INDEX idx_parents_phone ON parents(phone_e164);

-- Best-effort backfill of common 10-digit "0xxxxxxxxx" VN formats; rows that don't parse this
-- way stay NULL and self-heal the next time the person's phone is edited (server/services/
-- people.ts mirrors phoneE164 on every write).
UPDATE parents SET phone_e164 = '+84' || substr(replace(replace(replace(phone,' ',''),'.',''),'-',''), 2)
 WHERE phone IS NOT NULL
   AND length(replace(replace(replace(phone,' ',''),'.',''),'-','')) = 10
   AND replace(replace(replace(phone,' ',''),'.',''),'-','') LIKE '0%';

UPDATE accounts SET phone_e164 = (SELECT p.phone_e164 FROM parents p WHERE p.id = accounts.parent_id)
 WHERE parent_id IS NOT NULL;

UPDATE accounts SET phone_e164 = (
   SELECT '+84' || substr(replace(replace(replace(s.phone,' ',''),'.',''),'-',''), 2)
   FROM staff s WHERE s.id = accounts.staff_id
     AND s.phone IS NOT NULL
     AND length(replace(replace(replace(s.phone,' ',''),'.',''),'-','')) = 10
     AND replace(replace(replace(s.phone,' ',''),'.',''),'-','') LIKE '0%')
 WHERE staff_id IS NOT NULL;

-- Zalo OTP login/recovery challenges. `id` salts `code_hash` (SHA-256(id || ':' || code)), so a
-- rainbow table would have to be rebuilt per-row rather than once for the whole table. `attempts`
-- is a hard DB-backed ceiling independent of the DO rate limiter, which fails open by design
-- (server/services/rate-limit.ts) — this is the real backstop against guessing a low-entropy code.
CREATE TABLE login_codes (
  id          TEXT PRIMARY KEY,
  phone_e164  TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  -- 'login' | 'set-password' — the second is the Zalo forgot-password path (Phase 4); a
  -- set-password challenge is never allowed to mint a session on its own.
  purpose     TEXT NOT NULL DEFAULT 'login',
  account_id  TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  -- JSON array of the zalo_chats.chat_id values the code was sent to, kept for audit only.
  chat_ids    TEXT NOT NULL DEFAULT '[]',
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  verified_at TEXT,
  consumed_at TEXT
);
CREATE INDEX idx_login_codes_phone ON login_codes(phone_e164);
CREATE INDEX idx_login_codes_expires ON login_codes(expires_at);
