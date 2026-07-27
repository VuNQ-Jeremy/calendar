-- Phase 6: push notification bookkeeping.
--
-- `push_tokens` already exists (0014_mobile.sql). This adds the idempotency ledger the cron
-- jobs need.
--
-- The class-reminder sweep runs every 15 minutes over a 30-minute look-ahead window, so it sees
-- the same occurrence two or three times in a row. Without a record of what has been sent, every
-- class produces two or three identical notifications — which is the fastest way to get an app's
-- notifications muted at the OS level, taking the ones that mattered with them.
--
-- The key is `{kind}:{subjectId}:{occurrenceDate}`, e.g. `class:ev_123:2026-07-28`, so a weekly
-- class notifies once per occurrence and not once ever.
CREATE TABLE IF NOT EXISTS sent_notifications (
  key TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);

-- Sweeping old rows is by `sent_at`; without this the cleanup is a full scan every night.
CREATE INDEX IF NOT EXISTS idx_sent_notifications_sent_at ON sent_notifications (sent_at);
