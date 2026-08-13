-- Check-in / check-out kiosk + túi mù rewards.
--
-- Kids self-check a teacher-authored checklist on a classroom kiosk before class
-- (home activities) and before leaving (what was learned). Full completion earns
-- "túi mù" (mystery bags) toward tiered monthly gifts; incomplete check-ins are
-- counted as misses at READ time — only bags are stored, misses derive.

-- Managed enum (subjects pattern) plus icon + color for the kiosk cells.
CREATE TABLE checkin_activity_types (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  icon       TEXT NOT NULL DEFAULT 'star',
  color      TEXT NOT NULL DEFAULT 'orange',
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- One row per checklist cell, keyed per occurrence like session_previews.
-- Rows are id-stable and individually CRUDed (never delete-then-insert):
-- checklist_checks reference them, and a teacher fixing a typo must not wipe kids' taps.
CREATE TABLE checklist_items (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  date             TEXT NOT NULL,
  phase            TEXT NOT NULL,
  activity_type_id TEXT REFERENCES checkin_activity_types(id) ON DELETE SET NULL,
  label            TEXT NOT NULL DEFAULT '',
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_by       TEXT REFERENCES staff(id) ON DELETE SET NULL,
  created_at       TEXT
);
CREATE INDEX idx_checklist_items_occ ON checklist_items(event_id, date, phase);

-- A student's tap. The composite PK IS the idempotency: a double tap is an
-- ON CONFLICT DO NOTHING no-op; unchecking is a DELETE.
CREATE TABLE checklist_checks (
  item_id    TEXT NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (item_id, student_id)
);
CREATE INDEX idx_checklist_checks_student ON checklist_checks(student_id);

-- Túi mù ledger, append-only (garden_events pattern). No FK to events on purpose:
-- an earned bag is a moment the kid already celebrated, and deleting the event must
-- not silently revoke it. ref_id = "<eventId>:<date>:<kind>" is the natural
-- idempotency key that makes double taps and replays harmless.
CREATE TABLE tui_mu_events (
  id         TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id   TEXT,
  vn_day     TEXT NOT NULL,
  kind       TEXT NOT NULL,
  ref_id     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_tui_mu_ref ON tui_mu_events(student_id, ref_id);
CREATE INDEX idx_tui_mu_student_day ON tui_mu_events(student_id, vn_day);

-- Gift given. tier_bags + label are snapshotted at redemption so later tier edits
-- don't rewrite history. The unique triple makes the redeem button double-click safe.
CREATE TABLE gift_redemptions (
  id         TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  tier_bags  INTEGER NOT NULL,
  label      TEXT,
  staff_id   TEXT REFERENCES staff(id) ON DELETE SET NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_gift_redemptions ON gift_redemptions(student_id, month, tier_bags);
CREATE INDEX idx_gift_redemptions_month ON gift_redemptions(month);
