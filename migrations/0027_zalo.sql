-- Zalo Bot channel — a second delivery channel alongside Expo push.
--
-- Zalo is already how this school actually talks to parents; until now the app only rendered
-- share images that a teacher copied and pasted into a group by hand. The Zalo Bot Platform
-- (bot.zaloplatforms.com) is a Telegram-shaped HTTP API that needs no Official Account and no
-- business verification, and — the part that makes cron notifications possible — lets the bot
-- message any conversation that has paired with it, unprompted.
--
-- Everything hangs off ONE identifier: `chat_id`, Zalo's id for a conversation. The two tables
-- below are the map from a chat_id to somebody in this database, and the codes that build it.

-- One row per paired conversation. Exactly one of account_id / parent_id / class_id is set —
-- SQLite cannot express that cleanly, so the invariant is enforced in server/services/zalo.ts:
--
--   account_id  a staff member or student who paired their own 1:1 chat
--   parent_id   a parent. NOT an account: parent accounts cannot log in
--               (server/services/auth.ts, `userFromToken`), so a parent has no session to pair
--               from. A teacher generates the code and passes it on; the parent texts it to the
--               bot. This column is the only link a parent will ever have.
--   class_id    a group chat the bot was added to and someone linked with `/link <code>`.
--
-- chat_id is UNIQUE, and the service upserts on it. Re-pairing therefore MOVES a conversation to
-- its new owner instead of leaving a stale duplicate that would keep delivering someone else's
-- notifications — the same reasoning as push_tokens.expo_token in 0014_mobile.sql.
CREATE TABLE IF NOT EXISTS zalo_chats (
  id           TEXT PRIMARY KEY,
  chat_id      TEXT NOT NULL UNIQUE,
  -- 'user' | 'group', mirroring the webhook's chat.chat_type (PRIVATE | GROUP).
  kind         TEXT NOT NULL DEFAULT 'user',
  account_id   TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  parent_id    TEXT REFERENCES parents(id) ON DELETE CASCADE,
  class_id     TEXT REFERENCES classes(id) ON DELETE CASCADE,
  -- Whatever Zalo called the sender or the group. Display only: it is what makes the admin list
  -- readable, since a chat_id is an opaque hex string.
  display_name TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_zalo_chats_account ON zalo_chats (account_id);
CREATE INDEX IF NOT EXISTS idx_zalo_chats_parent ON zalo_chats (parent_id);
CREATE INDEX IF NOT EXISTS idx_zalo_chats_class ON zalo_chats (class_id);

-- Short-lived, single-use pairing codes. Modelled on `invites`, with two differences that matter:
-- they expire, and they are redeemed by messaging the bot rather than by filling in a form.
--
-- The code IS the credential — anyone holding it can attach their Zalo conversation to that
-- person's notifications — so it is crypto-random, unambiguous (no O/0/I/1), and short-lived.
CREATE TABLE IF NOT EXISTS zalo_pair_codes (
  code       TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES parents(id) ON DELETE CASCADE,
  class_id   TEXT REFERENCES classes(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES staff(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

-- Redemption sweeps expired rows as it goes; without this that is a full scan per message.
CREATE INDEX IF NOT EXISTS idx_zalo_pair_codes_expires ON zalo_pair_codes (expires_at);
