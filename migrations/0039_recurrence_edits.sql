-- Google-Calendar-style edits of recurring events: "this event" / "this and following".
--
-- `until` — inclusive last ICT day (YYYY-MM-DD) the series generates occurrences, or NULL for
-- open-ended. Inclusive because the app compares bare ICT day strings everywhere, and a split
-- writes until = occurrence - 1 day, giving two touching, non-overlapping windows.
--
-- `exdates` — JSON array of ICT days ('["2026-08-14", ...]') excluded from the series: each
-- entry is an occurrence detached by an "edit this event only" or removed by a "delete this
-- event only". A column, not a table, so expandEvents (shared/logic/recurrence.ts) stays a pure
-- function over the row and the three consumers (web calendar, mobile agenda, reminder cron)
-- need no extra join.
--
-- Splitting a series ("this and following") caps the old row with `until` and inserts a new row
-- anchored at the edited occurrence — see updateFollowing in server/services/events.ts.
ALTER TABLE events ADD COLUMN until TEXT;
ALTER TABLE events ADD COLUMN exdates TEXT NOT NULL DEFAULT '[]';
