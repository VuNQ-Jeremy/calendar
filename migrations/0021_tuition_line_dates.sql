-- Tuition: remember WHICH sessions a frozen fee line was billed for, not just how many.
--
-- The Minimal slip prints a "Buổi học / Ngày học" table, the way the centre's paper receipts list
-- every session date. An open month reads those dates straight from attendance_records, but a closed
-- month reads its snapshot — so the snapshot has to carry them too, or a closed month (exactly the
-- month you send receipts for) could not render that slip.
--
-- Additive and defaulted: lines frozen before this migration keep an empty list, and the slip falls
-- back to showing the session count alone.

ALTER TABLE tuition_lines ADD COLUMN dates TEXT NOT NULL DEFAULT '[]'; -- JSON ["YYYY-MM-DD", ...]
