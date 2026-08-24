-- The vocabulary square is no longer tappable: its result is the derivation from the student's
-- own vocabulary work and nothing else, re-synced on every kiosk load.
--
-- `checklist_check_seeds` existed solely to make a MANUAL override stick against that
-- re-derivation (0053). With no override to protect, it is dead weight — and leaving it would
-- imply a stickiness the code no longer honours. It is a child table (its FKs point at
-- checklist_items and students), so dropping it fires no cascade onto anything.
DROP TABLE IF EXISTS checklist_check_seeds;
