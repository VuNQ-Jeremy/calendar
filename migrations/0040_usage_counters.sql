-- Monthly usage counters for metered external services (first: Azure Speech pronunciation
-- assessment, whose F0 tier allows 5 audio-hours per calendar month). One row per
-- (month, metric); writes are blind ON CONFLICT upserts from ctx.waitUntil, so the table has
-- no FKs and no timestamps — the month IS the time axis. `count` is calls; `quantity` is the
-- metric's own unit (audio seconds for speech, tokens for a future AI metric, and so on).
CREATE TABLE usage_counters (
  month TEXT NOT NULL,
  metric TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (month, metric)
);
